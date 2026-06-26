package com.deepgram

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.util.Log

/**
 * Microphone capture. Records 16 kHz PCM16 mono and streams the raw bytes back
 * to the owner via [onAudioChunk]; the JS side downsamples to whatever Deepgram
 * is configured for.
 *
 * Two capture profiles are supported:
 *   - STT-only (`enableVoiceProcessing = false`): `VOICE_RECOGNITION`, which
 *     gives the rawest possible signal (platform AEC/NS/AGC disabled).
 *   - Voice Agent / duplex (`enableVoiceProcessing = true`): `VOICE_COMMUNICATION`
 *     plus `MODE_IN_COMMUNICATION` so the platform's telephony-grade AEC engages
 *     against the active playback signal as its reference.
 */
internal class AudioRecorder(
  private val context: Context,
  private val onAudioChunk: (ByteArray, Int) -> Unit,
  private val onForegroundServiceRequest: () -> Unit,
  private val onForegroundServiceRelease: () -> Unit,
  private val onAudioLevel: (Double) -> Unit = {},
) {
  /** Thrown when AudioRecord fails to initialize (mapped to "init_failed"). */
  class InitializationException(message: String) : Exception(message)

  @Volatile
  var isActive: Boolean = false
    private set

  @Volatile
  private var audioRecord: AudioRecord? = null
  private var recordingThread: Thread? = null

  // Microphone metering (audio-level events). Purely additive — when
  // [meteringEnabled] is true the recording loop computes a normalized RMS
  // amplitude (0..1) over the same PCM that feeds transcription and forwards it
  // via [onAudioLevel], throttled to [meteringIntervalMs].
  @Volatile
  private var meteringEnabled: Boolean = false

  @Volatile
  private var meteringIntervalMs: Long = 100L
  private var lastMeterEmit: Long = 0L

  private var acousticEchoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var automaticGainControl: AutomaticGainControl? = null

  // When `enableVoiceProcessing = true`, we set the system into
  // MODE_IN_COMMUNICATION so the platform engages telephony-grade AEC. We
  // remember the prior mode so we can restore it on stop and not strand the
  // device in voice-call routing.
  private var voiceProcessingActive = false
  private var savedAudioMode: Int = AudioManager.MODE_NORMAL
  private var audioManager: AudioManager? = null

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

  /**
   * Start capturing. On failure the recorder is left fully cleaned up and the
   * exception is propagated: [InitializationException] for a failed
   * `AudioRecord` init, `SecurityException` for a missing permission, or the
   * original exception otherwise.
   */
  fun start(enableVoiceProcessing: Boolean) {
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
        throw InitializationException("AudioRecord initialization failed")
      }

      enableAudioEffects(recorder)
      recorder.startRecording()
      isActive = true
      onForegroundServiceRequest()

      startRecordingThread()
    } catch (e: SecurityException) {
      Log.e(TAG, "startRecording security error", e)
      audioRecord?.release()
      audioRecord = null
      releaseAudioEffects()
      restoreAudioModeIfNeeded()
      throw e
    } catch (e: InitializationException) {
      throw e
    } catch (e: Exception) {
      Log.e(TAG, "startRecording error", e)
      audioRecord?.release()
      audioRecord = null
      releaseAudioEffects()
      restoreAudioModeIfNeeded()
      throw e
    }
  }

  fun stop(throwOnError: Boolean = true) {
    isActive = false
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
      Log.w(TAG, "stop: error stopping AudioRecord", e)
      if (throwOnError) throw e
    }

    try {
      audioRecord?.release()
    } catch (e: Exception) {
      Log.w(TAG, "stop: error releasing AudioRecord", e)
      if (throwOnError) throw e
    }

    audioRecord = null
    releaseAudioEffects()
    restoreAudioModeIfNeeded()
    onForegroundServiceRelease()
  }

  /**
   * Enable / disable microphone audio-level metering. When enabled the
   * recording loop emits a normalized RMS amplitude (0..1) via [onAudioLevel]
   * at most once per [intervalMs] (clamped to a sane minimum). Safe to call
   * before or during recording.
   */
  fun setMetering(enabled: Boolean, intervalMs: Long) {
    meteringEnabled = enabled
    meteringIntervalMs = if (intervalMs > 0) intervalMs else 100L
    lastMeterEmit = 0L
  }

  private fun applyVoiceCommunicationMode() {
    if (voiceProcessingActive) return
    try {
      val manager = audioManager
        ?: (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)
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
        ?: (context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)
      manager?.mode = savedAudioMode
      Log.i(TAG, "Restored audio mode to $savedAudioMode")
    } catch (e: Exception) {
      Log.w(TAG, "restoreAudioModeIfNeeded failed", e)
    } finally {
      voiceProcessingActive = false
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
        while (isActive) {
          val recorder = audioRecord ?: break
          val read = recorder.read(buffer, 0, buffer.size)
          if (read > 0) {
            onAudioChunk(buffer, read)
            emitAudioLevelIfNeeded(buffer, read)
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
   * Compute a normalized RMS amplitude (0..1) over a PCM16 little-endian buffer
   * and forward it via [onAudioLevel], throttled to [meteringIntervalMs]. No-op
   * unless metering is enabled.
   */
  private fun emitAudioLevelIfNeeded(buffer: ByteArray, length: Int) {
    if (!meteringEnabled || length < 2) return

    val now = System.currentTimeMillis()
    if (lastMeterEmit != 0L && now - lastMeterEmit < meteringIntervalMs) return
    lastMeterEmit = now

    var sumSquares = 0.0
    var sampleCount = 0
    var i = 0
    while (i + 1 < length) {
      val lo = buffer[i].toInt() and 0xFF
      val hi = buffer[i + 1].toInt() // signed high byte → sign-extends sample
      val sample = (hi shl 8) or lo
      val norm = sample / 32768.0
      sumSquares += norm * norm
      sampleCount++
      i += 2
    }
    if (sampleCount == 0) return

    val rms = Math.sqrt(sumSquares / sampleCount)
    onAudioLevel(if (rms > 1.0) 1.0 else rms)
  }

  companion object {
    private const val TAG = "DeepgramRecorder"

    // Recording is locked to 16 kHz PCM16 mono — exposed so the module can tag
    // the `AudioChunk` event it emits to JS with the matching sample rate.
    const val RECORD_SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
  }
}
