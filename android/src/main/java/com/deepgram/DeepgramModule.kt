package com.deepgram

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioFocusRequest
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native module that records raw PCM audio and plays back base64 encoded
 * PCM chunks. Audio data recorded from the microphone is emitted to JS as the
 * `AudioChunk` event with base64-encoded PCM.
 */
class DeepgramModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "Deepgram"
    private const val TAG = "DeepgramModule"
    // Recording is locked to 16 kHz PCM16 mono — the JS side downsamples from
    // here to whatever Deepgram is configured for. Do NOT mix this with the
    // playback rate (which can vary, e.g. 24 kHz for Aura TTS).
    private const val RECORD_SAMPLE_RATE = 16000
    private const val DEFAULT_PLAYBACK_SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
    // Cap the streaming playback queue to prevent unbounded memory growth
    // when JS feeds audio faster than the device can play it. ~5 s of 24 kHz
    // PCM16 mono is roughly 240 KB — we allow a little more headroom.
    private const val MAX_QUEUED_PLAYBACK_BYTES = 1_500_000
  }

  private var playbackSampleRate: Int = DEFAULT_PLAYBACK_SAMPLE_RATE
  private var currentOutputChannels: Int = 1

  private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

  private val minRecordBufferSize: Int
    get() {
      val min = AudioRecord.getMinBufferSize(RECORD_SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
      if (min > 0) return min

      val fallback = maxOf((RECORD_SAMPLE_RATE / 5) * 2, 4096)
      Log.w(TAG, "Invalid AudioRecord min buffer ($min), using fallback=$fallback")
      return fallback
    }

  private val bufferSize: Int
    get() = minRecordBufferSize * 4

  @Volatile
  private var audioRecord: AudioRecord? = null
  private var recordingThread: Thread? = null
  @Volatile
  private var isRecording = false
  private var acousticEchoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var automaticGainControl: AutomaticGainControl? = null

  // When `enableVoiceProcessing=true`, we set the system into
  // MODE_IN_COMMUNICATION so the platform engages telephony-grade AEC.
  // We remember the prior mode so we can restore it on stop and not
  // strand the device in voice-call routing.
  private var voiceProcessingActive = false
  private var savedAudioMode: Int = AudioManager.MODE_NORMAL

  // TTS Streaming Playback
  private var audioTrack: AudioTrack? = null
  private val audioQueue = LinkedBlockingQueue<ByteArray>()
  @Volatile
  private var isPlaying = false
  private var playbackThread: Thread? = null
  private val playbackThreshold = 1024
  private val queuedBytes = AtomicInteger(0)

  // Audio focus
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var hasAudioFocus = false

  // ACTION_AUDIO_BECOMING_NOISY — fires when wired headset is unplugged or A2DP
  // disconnects. Without handling this, our AudioTrack would silently re-route
  // to the loudspeaker and surprise the user. Standard Android best practice.
  private var noisyReceiverRegistered = false
  private val becomingNoisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        Log.i(TAG, "AUDIO_BECOMING_NOISY — pausing playback")
        try { audioTrack?.pause() } catch (_: Exception) {}
      }
    }
  }

  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    when (focusChange) {
      AudioManager.AUDIOFOCUS_LOSS -> {
        // Permanent loss (e.g. another app took focus). Tear down so we don't
        // fight other audio packages and so we release the microphone.
        Log.i(TAG, "AUDIOFOCUS_LOSS — stopping Deepgram audio")
        hasAudioFocus = false
        try { stopStreamingPlayback(throwOnError = false) } catch (_: Exception) {}
        try { stopRecordingInternal(throwOnError = false) } catch (_: Exception) {}
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        // Transient loss (e.g. incoming call) — pause playback but keep state.
        Log.i(TAG, "AUDIOFOCUS_LOSS_TRANSIENT — pausing playback")
        try { audioTrack?.pause() } catch (_: Exception) {}
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        Log.i(TAG, "AUDIOFOCUS_GAIN — resuming playback if active")
        hasAudioFocus = true
        if (isPlaying) {
          try { audioTrack?.play() } catch (_: Exception) {}
        }
      }
    }
  }

  override fun getName() = NAME

  private fun outputChannelMask(): Int {
    return if (currentOutputChannels >= 2) {
      AudioFormat.CHANNEL_OUT_STEREO
    } else {
      AudioFormat.CHANNEL_OUT_MONO
    }
  }

  private fun minTrackBufferSize(channelMask: Int): Int {
    val min = AudioTrack.getMinBufferSize(playbackSampleRate, channelMask, AUDIO_FORMAT)
    if (min > 0) return min

    val bytesPerFrame = if (currentOutputChannels >= 2) 4 else 2
    val fallback = maxOf((playbackSampleRate / 5) * bytesPerFrame, 4096)
    Log.w(TAG, "Invalid AudioTrack min buffer ($min), using fallback=$fallback")
    return fallback
  }

  private fun startForegroundAudioService() {
    try {
      DeepgramAudioService.start(reactContext)
    } catch (e: Exception) {
      Log.w(TAG, "Unable to start foreground audio service", e)
    }
  }

  private fun stopForegroundAudioServiceIfInactive() {
    if (isRecording || isPlaying) return
    try {
      DeepgramAudioService.stop(reactContext)
    } catch (e: Exception) {
      Log.w(TAG, "Unable to stop foreground audio service", e)
    }
  }

  // -------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------

  @ReactMethod
  fun startRecording(options: ReadableMap?, promise: Promise) {
    if (isRecording) {
      promise.resolve(null)
      return
    }

    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "permission_denied",
        "RECORD_AUDIO permission has not been granted. Request it from JS before calling startRecording."
      )
      return
    }

    val enableVoiceProcessing = options?.let {
      it.hasKey("enableVoiceProcessing") && !it.isNull("enableVoiceProcessing") &&
        it.getBoolean("enableVoiceProcessing")
    } ?: false

    // Voice Agent / duplex usage: route capture through the telephony stack so
    // the platform's hardware AEC engages with the active playback signal as
    // its reference. VOICE_RECOGNITION explicitly disables AEC/NS/AGC and is
    // therefore the *wrong* source for full-duplex — it's only correct for
    // one-way ASR where you want the rawest possible signal.
    val audioSource = if (enableVoiceProcessing) {
      MediaRecorder.AudioSource.VOICE_COMMUNICATION
    } else {
      MediaRecorder.AudioSource.VOICE_RECOGNITION
    }

    if (enableVoiceProcessing) {
      applyVoiceCommunicationMode()
    }

    try {
      val recorder = AudioRecord.Builder()
        .setAudioSource(audioSource)
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AUDIO_FORMAT)
            .setSampleRate(RECORD_SAMPLE_RATE)
            .setChannelMask(CHANNEL_CONFIG)
            .build()
        )
        .setBufferSizeInBytes(bufferSize)
        .build()
      audioRecord = recorder

      if (recorder.state != AudioRecord.STATE_INITIALIZED) {
        recorder.release()
        audioRecord = null
        releaseAudioEffects()
        restoreAudioModeIfNeeded()
        promise.reject("init_failed", "AudioRecord initialization failed")
        return
      }

      enableAudioEffects(recorder)
      recorder.startRecording()
      isRecording = true
      startForegroundAudioService()

      startRecordingThread()
      promise.resolve(null)
    } catch (e: SecurityException) {
      Log.e(TAG, "startRecording security error", e)
      audioRecord?.release()
      audioRecord = null
      releaseAudioEffects()
      restoreAudioModeIfNeeded()
      promise.reject("permission_denied", e)
    } catch (e: Exception) {
      Log.e(TAG, "startRecording error", e)
      audioRecord?.release()
      audioRecord = null
      releaseAudioEffects()
      restoreAudioModeIfNeeded()
      promise.reject("start_error", e)
    }
  }

  private fun applyVoiceCommunicationMode() {
    if (voiceProcessingActive) return
    try {
      val manager = audioManager
        ?: (reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)
      if (manager == null) {
        Log.w(TAG, "applyVoiceCommunicationMode: AudioManager unavailable")
        return
      }
      audioManager = manager
      savedAudioMode = manager.mode
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
      voiceProcessingActive = true
      Log.i(TAG, "Switched audio mode to IN_COMMUNICATION (was $savedAudioMode) for AEC")
    } catch (e: Exception) {
      Log.w(TAG, "applyVoiceCommunicationMode failed", e)
    }
  }

  private fun restoreAudioModeIfNeeded() {
    if (!voiceProcessingActive) return
    try {
      val manager = audioManager
        ?: (reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)
      manager?.mode = savedAudioMode
      Log.i(TAG, "Restored audio mode to $savedAudioMode")
    } catch (e: Exception) {
      Log.w(TAG, "restoreAudioModeIfNeeded failed", e)
    } finally {
      voiceProcessingActive = false
    }
  }

  private fun stopRecordingInternal(throwOnError: Boolean = true) {
    isRecording = false
    recordingThread?.let { thread ->
      thread.interrupt()
      try {
        thread.join(500)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    recordingThread = null

    try {
      audioRecord?.stop()
    } catch (e: Exception) {
      Log.w(TAG, "stopRecordingInternal: error stopping AudioRecord", e)
      if (throwOnError) throw e
    }

    try {
      audioRecord?.release()
    } catch (e: Exception) {
      Log.w(TAG, "stopRecordingInternal: error releasing AudioRecord", e)
      if (throwOnError) throw e
    }

    audioRecord = null
    releaseAudioEffects()
    restoreAudioModeIfNeeded()
    stopForegroundAudioServiceIfInactive()
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      stopRecordingInternal()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopRecording error", e)
      promise.reject("stop_error", e)
    }
  }

  private fun enableAudioEffects(recorder: AudioRecord) {
    val sessionId = recorder.audioSessionId
    if (sessionId == AudioRecord.ERROR || sessionId == AudioRecord.ERROR_BAD_VALUE) {
      return
    }

    releaseAudioEffects()

    if (AcousticEchoCanceler.isAvailable()) {
      try {
        acousticEchoCanceler = AcousticEchoCanceler.create(sessionId)?.apply {
          enabled = true
        }
      } catch (e: Exception) {
        Log.w(TAG, "Unable to enable AcousticEchoCanceler", e)
      }
    }

    if (NoiseSuppressor.isAvailable()) {
      try {
        noiseSuppressor = NoiseSuppressor.create(sessionId)?.apply {
          enabled = true
        }
      } catch (e: Exception) {
        Log.w(TAG, "Unable to enable NoiseSuppressor", e)
      }
    }

    if (AutomaticGainControl.isAvailable()) {
      try {
        automaticGainControl = AutomaticGainControl.create(sessionId)?.apply {
          enabled = true
        }
      } catch (e: Exception) {
        Log.w(TAG, "Unable to enable AutomaticGainControl", e)
      }
    }
  }

  private fun releaseAudioEffects() {
    try {
      acousticEchoCanceler?.release()
    } catch (e: Exception) {
      Log.w(TAG, "Error releasing AcousticEchoCanceler", e)
    } finally {
      acousticEchoCanceler = null
    }

    try {
      noiseSuppressor?.release()
    } catch (e: Exception) {
      Log.w(TAG, "Error releasing NoiseSuppressor", e)
    } finally {
      noiseSuppressor = null
    }

    try {
      automaticGainControl?.release()
    } catch (e: Exception) {
      Log.w(TAG, "Error releasing AutomaticGainControl", e)
    } finally {
      automaticGainControl = null
    }
  }

  private fun startRecordingThread() {
    recordingThread = Thread({
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
        val buffer = ByteArray(bufferSize)
        while (isRecording) {
          val recorder = audioRecord ?: break
          val read = recorder.read(buffer, 0, buffer.size)
          if (read > 0) {
            sendAudioChunk(buffer, read)
          } else if (read < 0) {
            // ERROR_INVALID_OPERATION / ERROR_BAD_VALUE / ERROR_DEAD_OBJECT —
            // bail rather than spin in a tight loop.
            Log.w(TAG, "AudioRecord.read returned $read — stopping thread")
            break
          }
        }
      } catch (e: Exception) {
        Log.e(TAG, "recording thread error", e)
      }
    }, "Deepgram-Recording")
    recordingThread?.start()
  }

  /**
   * Emit audio data to JS as base64-encoded PCM (matches iOS format).
   * This is far more efficient than sending individual byte values.
   */
  private fun sendAudioChunk(data: ByteArray, length: Int) {
    if (!reactContext.hasActiveReactInstance()) return
    val b64 = Base64.encodeToString(data, 0, length, Base64.NO_WRAP)
    val map = WritableNativeMap()
    map.putString("b64", b64)
    map.putInt("sampleRate", RECORD_SAMPLE_RATE)
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("AudioChunk", map)
    } catch (e: Exception) {
      // Catalyst tearing down or JS bundle not ready — drop silently.
      Log.w(TAG, "sendAudioChunk emit failed", e)
    }
  }

  // -------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------

  private fun ensureAudioTrack() {
    if (audioTrack != null) return

    val channelMask = outputChannelMask()
    val minBuf = minTrackBufferSize(channelMask)

    audioTrack = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AUDIO_FORMAT)
          .setSampleRate(playbackSampleRate)
          .setChannelMask(channelMask)
          .build()
      )
      .setBufferSizeInBytes(maxOf(minBuf, bufferSize))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private fun requestAudioFocus(): Boolean {
    if (hasAudioFocus) return true
    try {
      val manager = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE) as? AudioManager
        ?: return false
      audioManager = manager

      // Use AUDIOFOCUS_GAIN_TRANSIENT so other audio apps (Spotify, podcasts,
      // navigation, etc.) pause/duck and then automatically resume when we
      // abandon focus. AUDIOFOCUS_GAIN would permanently stop them.
      val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .setOnAudioFocusChangeListener(audioFocusListener, mainHandler)
          .setWillPauseWhenDucked(true)
          .build()
        audioFocusRequest = request
        manager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        manager.requestAudioFocus(
          audioFocusListener,
          AudioManager.STREAM_VOICE_CALL,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        )
      }

      hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!hasAudioFocus) {
        Log.w(TAG, "Audio focus request not granted (result=$result)")
      }
      return hasAudioFocus
    } catch (e: Exception) {
      Log.w(TAG, "requestAudioFocus error", e)
      hasAudioFocus = false
      return false
    }
  }

  private fun abandonAudioFocus() {
    if (!hasAudioFocus) return
    try {
      val manager = audioManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        manager.abandonAudioFocus(audioFocusListener)
      }
    } catch (e: Exception) {
      Log.w(TAG, "abandonAudioFocus error", e)
    } finally {
      hasAudioFocus = false
      audioFocusRequest = null
    }
  }

  @ReactMethod
  fun startAudio(promise: Promise) {
    try {
      requestAudioFocus()
      ensureAudioTrack()
      audioTrack?.play()
      isPlaying = true
      startForegroundAudioService()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "startAudio error", e)
      promise.reject("audio_start_error", e)
    }
  }

  private fun stopAudioInternal(throwOnError: Boolean = true) {
    try {
      audioTrack?.stop()
    } catch (e: Exception) {
      Log.w(TAG, "stopAudioInternal: error stopping AudioTrack", e)
      if (throwOnError) throw e
    }

    try {
      audioTrack?.release()
    } catch (e: Exception) {
      Log.w(TAG, "stopAudioInternal: error releasing AudioTrack", e)
      if (throwOnError) throw e
    }

    audioTrack = null
    isPlaying = false
    abandonAudioFocus()
    stopForegroundAudioServiceIfInactive()
  }

  @ReactMethod
  fun stopAudio(promise: Promise) {
    try {
      stopAudioInternal()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopAudio error", e)
      promise.reject("audio_stop_error", e)
    }
  }

  // -------------------------------------------------------------------
  // TTS Streaming Audio Player
  // Uses a proper queue instead of O(n²) array concatenation.
  // -------------------------------------------------------------------

  @ReactMethod
  fun startPlayer(sampleRate: Int, channels: Int) {
    stopStreamingPlayback()
    playbackSampleRate = if (sampleRate > 0) sampleRate else DEFAULT_PLAYBACK_SAMPLE_RATE
    currentOutputChannels = if (channels >= 2) 2 else 1
    audioQueue.clear()
    queuedBytes.set(0)
    isPlaying = false
  }

  @ReactMethod
  fun setAudioConfig(sampleRate: Int, channels: Int) {
    startPlayer(sampleRate, channels)
  }

  @ReactMethod
  fun feedAudio(base64Audio: String) {
    try {
      val audioData = Base64.decode(base64Audio, Base64.DEFAULT)
      if (audioData.isEmpty()) return

      // Bound the queue to prevent unbounded memory growth if JS is producing
      // audio faster than the device can play it. Drop the oldest chunk first
      // (so we always favor newer audio) when at the limit.
      while (queuedBytes.get() + audioData.size > MAX_QUEUED_PLAYBACK_BYTES) {
        val dropped = audioQueue.poll() ?: break
        queuedBytes.addAndGet(-dropped.size)
        Log.w(TAG, "feedAudio: dropping ${dropped.size} bytes — playback queue full")
      }

      audioQueue.offer(audioData)
      queuedBytes.addAndGet(audioData.size)

      // Start playback when we have enough buffered data
      if (!isPlaying && queuedBytes.get() >= playbackThreshold) {
        startStreamingPlayback()
      }
    } catch (e: Exception) {
      Log.e(TAG, "feedAudio error", e)
    }
  }

  @ReactMethod
  fun interruptAudio() {
    try {
      stopStreamingPlayback(throwOnError = false)
    } catch (e: Exception) {
      Log.w(TAG, "interruptAudio error", e)
    }
  }

  private fun startStreamingPlayback() {
    if (isPlaying) return

    isPlaying = true
    registerNoisyReceiver()
    playbackThread = Thread({
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
        requestAudioFocus()
        startForegroundAudioService()
        ensureAudioTrack()
        audioTrack?.play()

        while (isPlaying) {
          // Block until data is available (up to 100ms), avoids busy-wait
          val chunk = audioQueue.poll(100, java.util.concurrent.TimeUnit.MILLISECONDS)
            ?: continue

          queuedBytes.addAndGet(-chunk.size)
          val written = audioTrack?.write(chunk, 0, chunk.size) ?: 0
          if (written < 0) {
            Log.e(TAG, "AudioTrack write error: $written")
            break
          }
        }
      } catch (e: InterruptedException) {
        // Normal shutdown
      } catch (e: Exception) {
        Log.e(TAG, "Streaming playback error", e)
      } finally {
        isPlaying = false
        stopForegroundAudioServiceIfInactive()
      }
    }, "Deepgram-Playback")

    playbackThread?.start()
  }

  private fun stopStreamingPlayback(throwOnError: Boolean = true) {
    isPlaying = false
    playbackThread?.let { thread ->
      thread.interrupt()
      try {
        thread.join(500)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    playbackThread = null

    try {
      stopAudioInternal(throwOnError)
    } catch (e: Exception) {
      if (throwOnError) throw e else Log.w(TAG, "stopStreamingPlayback: error stopping audio", e)
    } finally {
      audioQueue.clear()
      queuedBytes.set(0)
      unregisterNoisyReceiver()
      stopForegroundAudioServiceIfInactive()
    }
  }

  @ReactMethod
  fun stopPlayer(promise: Promise?) {
    try {
      stopStreamingPlayback()
      promise?.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopPlayer error", e)
      promise?.reject("stop_player_error", e)
    }
  }

  override fun invalidate() {
    try {
      stopRecordingInternal(false)
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping recording on invalidate", e)
    }

    try {
      stopStreamingPlayback(false)
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping playback on invalidate", e)
    }

    abandonAudioFocus()
    unregisterNoisyReceiver()
    super.invalidate()
  }

  private fun registerNoisyReceiver() {
    if (noisyReceiverRegistered) return
    try {
      val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        reactContext.registerReceiver(
          becomingNoisyReceiver,
          filter,
          Context.RECEIVER_NOT_EXPORTED
        )
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        reactContext.registerReceiver(becomingNoisyReceiver, filter)
      }
      noisyReceiverRegistered = true
    } catch (e: Exception) {
      Log.w(TAG, "registerNoisyReceiver failed", e)
    }
  }

  private fun unregisterNoisyReceiver() {
    if (!noisyReceiverRegistered) return
    try {
      reactContext.unregisterReceiver(becomingNoisyReceiver)
    } catch (e: Exception) {
      Log.w(TAG, "unregisterNoisyReceiver failed", e)
    } finally {
      noisyReceiverRegistered = false
    }
  }

  // -------------------------------------------------------------------
  // One-shot playback (for HTTP synthesis)
  // -------------------------------------------------------------------

  @ReactMethod
  fun playAudioChunk(chunk: String, promise: Promise) {
    try {
      val audioData = Base64.decode(chunk, Base64.DEFAULT)
      if (audioData.isEmpty()) {
        promise.reject("invalid_data", "Failed to decode audio data")
        return
      }

      requestAudioFocus()
      startForegroundAudioService()

      val channelMask = outputChannelMask()
      val minBuf = minTrackBufferSize(channelMask)

      val tempAudioTrack = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AUDIO_FORMAT)
            .setSampleRate(playbackSampleRate)
            .setChannelMask(channelMask)
            .build()
        )
        .setBufferSizeInBytes(maxOf(minBuf, audioData.size))
        .setTransferMode(AudioTrack.MODE_STATIC)
        .build()

      tempAudioTrack.write(audioData, 0, audioData.size)

      // Use notification marker to know when playback finishes,
      // then resolve the promise (instead of polling with Thread.sleep).
      val bytesPerFrame = if (currentOutputChannels >= 2) 4 else 2 // PCM16 mono/stereo
      val frameCount = audioData.size / bytesPerFrame
      tempAudioTrack.notificationMarkerPosition = frameCount
      val listener = object : AudioTrack.OnPlaybackPositionUpdateListener {
        override fun onMarkerReached(track: AudioTrack?) {
          try {
            track?.stop()
            track?.release()
          } catch (e: Exception) {
            Log.w(TAG, "playAudioChunk cleanup error", e)
          }
          abandonAudioFocus()
          stopForegroundAudioServiceIfInactive()
          promise.resolve(null)
        }

        override fun onPeriodicNotification(track: AudioTrack?) {}
      }

      // minSdk is 24, the Handler-aware overload is always available.
      tempAudioTrack.setPlaybackPositionUpdateListener(listener, mainHandler)

      tempAudioTrack.play()
    } catch (e: Exception) {
      Log.e(TAG, "playAudioChunk error", e)
      abandonAudioFocus()
      stopForegroundAudioServiceIfInactive()
      promise.reject("playback_error", e.message)
    }
  }
}
