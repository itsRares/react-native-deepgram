package com.deepgram

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.util.Base64
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * TTS audio output. Supports two modes:
 *   - Streaming ([startPlayer] / [feedAudio]): base64 PCM chunks are queued and
 *     drained on a dedicated thread through a `MODE_STREAM` AudioTrack.
 *   - One-shot ([playAudioChunk]): a single buffer is played through a
 *     `MODE_STATIC` AudioTrack and the caller is notified on completion.
 *
 * Audio focus is delegated to [focusManager]; foreground-service coordination
 * is delegated to the owner via the two callbacks.
 */
internal class AudioPlayer(
  private val context: Context,
  private val mainHandler: Handler,
  private val focusManager: AudioFocusManager,
  private val onForegroundServiceRequest: () -> Unit,
  private val onForegroundServiceRelease: () -> Unit,
) {
  @Volatile
  var isActive: Boolean = false
    private set

  private var playbackSampleRate: Int = DEFAULT_PLAYBACK_SAMPLE_RATE
  private var currentOutputChannels: Int = 1

  private var audioTrack: AudioTrack? = null
  private val audioQueue = LinkedBlockingQueue<ByteArray>()
  private var playbackThread: Thread? = null
  private val playbackThreshold = 1024
  private val queuedBytes = AtomicInteger(0)

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

  // The streaming AudioTrack is sized to at least 4x the microphone min-buffer.
  // Preserved verbatim from the original single-class implementation to keep
  // latency / under-run characteristics identical across releases.
  private val streamingBufferFloor: Int
    get() {
      val recMin = AudioRecord.getMinBufferSize(
        RECORD_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AUDIO_FORMAT
      )
      val base = if (recMin > 0) recMin else maxOf((RECORD_SAMPLE_RATE / 5) * 2, 4096)
      return base * 4
    }

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
      .setBufferSizeInBytes(maxOf(minBuf, streamingBufferFloor))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  // -------------------------------------------------------------------
  // Simple play/stop (kept for API compatibility)
  // -------------------------------------------------------------------

  fun startAudio() {
    focusManager.requestFocus()
    ensureAudioTrack()
    audioTrack?.play()
    isActive = true
    onForegroundServiceRequest()
  }

  fun stopAudio() {
    stopAudioInternal(throwOnError = true)
  }

  private fun stopAudioInternal(throwOnError: Boolean) {
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
    isActive = false
    focusManager.abandonFocus()
    onForegroundServiceRelease()
  }

  // -------------------------------------------------------------------
  // Streaming player. Uses a proper queue instead of O(n²) concatenation.
  // -------------------------------------------------------------------

  fun startPlayer(sampleRate: Int, channels: Int) {
    stopStreamingPlayback()
    playbackSampleRate = if (sampleRate > 0) sampleRate else DEFAULT_PLAYBACK_SAMPLE_RATE
    currentOutputChannels = if (channels >= 2) 2 else 1
    audioQueue.clear()
    queuedBytes.set(0)
    isActive = false
  }

  fun setAudioConfig(sampleRate: Int, channels: Int) {
    startPlayer(sampleRate, channels)
  }

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
      if (!isActive && queuedBytes.get() >= playbackThreshold) {
        startStreamingPlayback()
      }
    } catch (e: Exception) {
      Log.e(TAG, "feedAudio error", e)
    }
  }

  fun interruptAudio() {
    try {
      stopStreamingPlayback(throwOnError = false)
    } catch (e: Exception) {
      Log.w(TAG, "interruptAudio error", e)
    }
  }

  private fun startStreamingPlayback() {
    if (isActive) return

    isActive = true
    registerNoisyReceiver()
    playbackThread = Thread({
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
        focusManager.requestFocus()
        onForegroundServiceRequest()
        ensureAudioTrack()
        audioTrack?.play()

        while (isActive) {
          // Block until data is available (up to 100ms), avoids busy-wait
          val chunk = audioQueue.poll(100, TimeUnit.MILLISECONDS)
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
        isActive = false
        onForegroundServiceRelease()
      }
    }, "Deepgram-Playback")

    playbackThread?.start()
  }

  fun stopStreamingPlayback(throwOnError: Boolean = true) {
    isActive = false
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
      onForegroundServiceRelease()
    }
  }

  // -------------------------------------------------------------------
  // Focus transitions (driven by the owning module)
  // -------------------------------------------------------------------

  /** Pause output on a transient focus loss without discarding state. */
  fun pauseForFocusLoss() {
    try { audioTrack?.pause() } catch (_: Exception) {}
  }

  /** Resume output after regaining focus, if playback is still active. */
  fun resumeForFocusGain() {
    if (isActive) {
      try { audioTrack?.play() } catch (_: Exception) {}
    }
  }

  // -------------------------------------------------------------------
  // One-shot playback (for HTTP synthesis)
  // -------------------------------------------------------------------

  fun playAudioChunk(
    base64: String,
    onSuccess: () -> Unit,
    onError: (code: String, message: String?) -> Unit,
  ) {
    try {
      val audioData = Base64.decode(base64, Base64.DEFAULT)
      if (audioData.isEmpty()) {
        onError("invalid_data", "Failed to decode audio data")
        return
      }

      focusManager.requestFocus()
      onForegroundServiceRequest()

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
      // then notify the caller (instead of polling with Thread.sleep).
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
          focusManager.abandonFocus()
          onForegroundServiceRelease()
          onSuccess()
        }

        override fun onPeriodicNotification(track: AudioTrack?) {}
      }

      // minSdk is 24, the Handler-aware overload is always available.
      tempAudioTrack.setPlaybackPositionUpdateListener(listener, mainHandler)

      tempAudioTrack.play()
    } catch (e: Exception) {
      Log.e(TAG, "playAudioChunk error", e)
      focusManager.abandonFocus()
      onForegroundServiceRelease()
      onError("playback_error", e.message)
    }
  }

  /** Tear down all playback resources (called from the module's invalidate). */
  fun release() {
    try {
      stopStreamingPlayback(throwOnError = false)
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping playback on release", e)
    }
    unregisterNoisyReceiver()
  }

  private fun registerNoisyReceiver() {
    if (noisyReceiverRegistered) return
    try {
      val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(
          becomingNoisyReceiver,
          filter,
          Context.RECEIVER_NOT_EXPORTED
        )
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(becomingNoisyReceiver, filter)
      }
      noisyReceiverRegistered = true
    } catch (e: Exception) {
      Log.w(TAG, "registerNoisyReceiver failed", e)
    }
  }

  private fun unregisterNoisyReceiver() {
    if (!noisyReceiverRegistered) return
    try {
      context.unregisterReceiver(becomingNoisyReceiver)
    } catch (e: Exception) {
      Log.w(TAG, "unregisterNoisyReceiver failed", e)
    } finally {
      noisyReceiverRegistered = false
    }
  }

  companion object {
    private const val TAG = "DeepgramPlayer"

    private const val DEFAULT_PLAYBACK_SAMPLE_RATE = 16000
    private const val RECORD_SAMPLE_RATE = 16000
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

    // Cap the streaming playback queue to prevent unbounded memory growth when
    // JS feeds audio faster than the device can play it. ~5 s of 24 kHz PCM16
    // mono is roughly 240 KB — we allow a little more headroom.
    private const val MAX_QUEUED_PLAYBACK_BYTES = 1_500_000
  }
}
