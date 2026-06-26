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
import java.util.Collections
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
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
  // `streamingActive` drives the streaming playback loop and its teardown.
  // The simple play/stop path is tracked independently via `simpleActive`, and
  // one-shot playbacks via `oneShotPlaybacks`, so none of the three paths can
  // tear down another's AudioTrack or shared focus/foreground-service state.
  @Volatile
  private var streamingActive: Boolean = false

  // The simple "prepare for playback" path (mirrors iOS `startAudio`, which only
  // activates the audio session). It owns no AudioTrack — it just keeps audio
  // focus + the foreground service alive until `stopAudio` is called.
  @Volatile
  private var simpleActive: Boolean = false

  private val oneShotPlaybacks =
    Collections.synchronizedSet(mutableSetOf<OneShotPlayback>())

  /** True while streaming, simple, or any one-shot playback is running. */
  val isActive: Boolean
    get() = streamingActive || simpleActive || oneShotPlaybacks.isNotEmpty()

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
    // Mirror iOS `startAudio`: only prepare the session for playback (request
    // focus + keep-alive service). Do NOT create/play the streaming AudioTrack
    // here — the streaming player owns that track, and sharing it would let a
    // later `stopAudio`/`startPlayer` tear down the other path's playback.
    focusManager.requestFocus()
    simpleActive = true
    onForegroundServiceRequest()
  }

  fun stopAudio() {
    // Mirror iOS `stopAudio` -> `stopPlayer`: end the simple session and stop
    // any streaming playback, then release shared resources once nothing is
    // left active.
    simpleActive = false
    stopStreamingPlayback(throwOnError = true)
  }

  private fun releaseStreamingTrack(throwOnError: Boolean) {
    try {
      audioTrack?.stop()
    } catch (e: Exception) {
      Log.w(TAG, "releaseStreamingTrack: error stopping AudioTrack", e)
      if (throwOnError) throw e
    }

    try {
      audioTrack?.release()
    } catch (e: Exception) {
      Log.w(TAG, "releaseStreamingTrack: error releasing AudioTrack", e)
      if (throwOnError) throw e
    }

    audioTrack = null
    streamingActive = false
    releaseSharedResourcesIfIdle()
  }

  /**
   * Abandon audio focus and release the foreground service only when none of
   * the streaming, simple, or one-shot playback paths remain active, so a
   * finishing path cannot tear down shared resources still in use by another.
   */
  private fun releaseSharedResourcesIfIdle() {
    if (isActive) return
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
    streamingActive = false
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
      if (!streamingActive && queuedBytes.get() >= playbackThreshold) {
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
    if (streamingActive) return

    streamingActive = true
    registerNoisyReceiver()
    playbackThread = Thread({
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
        focusManager.requestFocus()
        onForegroundServiceRequest()
        ensureAudioTrack()
        audioTrack?.play()

        while (streamingActive) {
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
        streamingActive = false
        releaseSharedResourcesIfIdle()
      }
    }, "Deepgram-Playback")

    playbackThread?.start()
  }

  fun stopStreamingPlayback(throwOnError: Boolean = true) {
    streamingActive = false
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
      releaseStreamingTrack(throwOnError)
    } catch (e: Exception) {
      if (throwOnError) throw e else Log.w(TAG, "stopStreamingPlayback: error stopping audio", e)
    } finally {
      audioQueue.clear()
      queuedBytes.set(0)
      unregisterNoisyReceiver()
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
    if (streamingActive) {
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
    val audioData = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (e: Exception) {
      Log.e(TAG, "playAudioChunk decode error", e)
      onError("invalid_data", "Failed to decode audio data")
      return
    }

    if (audioData.isEmpty()) {
      onError("invalid_data", "Failed to decode audio data")
      return
    }

    // Reject malformed / oversized PCM before building the AudioTrack. A
    // sub-frame buffer would make frameCount (and notificationMarkerPosition)
    // 0, so onMarkerReached would never fire — the promise would hang forever
    // while leaking audio focus + the foreground service. The upper bound
    // mirrors the streaming queue cap.
    val bytesPerFrame = if (currentOutputChannels >= 2) 4 else 2 // PCM16 mono/stereo
    if (audioData.size < bytesPerFrame || audioData.size % bytesPerFrame != 0) {
      onError("invalid_data", "Audio data must contain whole PCM16 frames")
      return
    }
    if (audioData.size > MAX_QUEUED_PLAYBACK_BYTES) {
      onError("invalid_data", "Audio data exceeds the maximum one-shot size")
      return
    }

    focusManager.requestFocus()
    onForegroundServiceRequest()

    var playback: OneShotPlayback? = null
    try {
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

      // Use a notification marker to know when playback finishes (instead of
      // polling with Thread.sleep). Track the one-shot so it contributes to
      // isActive and can be torn down on focus loss / invalidate.
      val frameCount = audioData.size / bytesPerFrame
      tempAudioTrack.notificationMarkerPosition = frameCount

      val created = OneShotPlayback(tempAudioTrack, onSuccess, onError)
      playback = created
      oneShotPlaybacks.add(created)

      // minSdk is 24, the Handler-aware overload is always available.
      tempAudioTrack.setPlaybackPositionUpdateListener(
        object : AudioTrack.OnPlaybackPositionUpdateListener {
          override fun onMarkerReached(track: AudioTrack?) = created.complete()
          override fun onPeriodicNotification(track: AudioTrack?) {}
        },
        mainHandler,
      )

      tempAudioTrack.play()
    } catch (e: Exception) {
      Log.e(TAG, "playAudioChunk error", e)
      val created = playback
      if (created != null) {
        created.fail("playback_error", e.message)
      } else {
        releaseSharedResourcesIfIdle()
        onError("playback_error", e.message)
      }
    }
  }

  /**
   * A single MODE_STATIC one-shot playback. Guarantees the JS promise settles
   * exactly once (via [complete] or [fail]), tears the AudioTrack down, and
   * releases the shared focus / foreground service only when nothing else is
   * still playing.
   */
  private inner class OneShotPlayback(
    private val track: AudioTrack,
    private val onSuccess: () -> Unit,
    private val onError: (code: String, message: String?) -> Unit,
  ) {
    private val settled = AtomicBoolean(false)

    fun complete() {
      if (!settled.compareAndSet(false, true)) return
      teardown()
      onSuccess()
    }

    fun fail(code: String, message: String?) {
      if (!settled.compareAndSet(false, true)) return
      teardown()
      onError(code, message)
    }

    private fun teardown() {
      try {
        track.stop()
        track.release()
      } catch (e: Exception) {
        Log.w(TAG, "playAudioChunk cleanup error", e)
      }
      oneShotPlaybacks.remove(this)
      releaseSharedResourcesIfIdle()
    }
  }

  /** Stop every in-flight one-shot playback, rejecting their pending promises. */
  fun stopOneShotPlayback() {
    val pending = synchronized(oneShotPlaybacks) { oneShotPlaybacks.toList() }
    pending.forEach { it.fail("playback_error", "Playback interrupted") }
  }

  /** Tear down all playback resources (called from the module's invalidate). */
  fun release() {
    simpleActive = false
    try {
      stopStreamingPlayback(throwOnError = false)
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping playback on release", e)
    }
    stopOneShotPlayback()
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
