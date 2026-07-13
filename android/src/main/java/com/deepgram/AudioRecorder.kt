package com.deepgram

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Microphone capture. Records PCM16 mono at the session capture rate (16 kHz
 * by default; 24/48 kHz supported) and streams the raw bytes back to the owner
 * via [onAudioChunk]; the JS side downsamples to whatever Deepgram is
 * configured for.
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

  /**
   * Sample rate (Hz) of the active (or most recent) capture session. May
   * differ from the requested rate when the device rejects it and capture
   * falls back to [RECORD_SAMPLE_RATE]; the module tags every `AudioChunk`
   * event with this value so JS always knows the true rate.
   */
  @Volatile
  var currentSampleRate: Int = RECORD_SAMPLE_RATE
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

  // Record-to-file. When [start] is given a destination path the recording loop
  // tees the same PCM it streams to JS into a WAV file; the RIFF/`data` sizes
  // are patched into the header on stop. Writes happen on the recording thread
  // (single producer) and finalization runs after it joins, so no lock needed.
  @Volatile
  private var fileOutput: RandomAccessFile? = null
  private var fileDataBytes: Long = 0L
  private var recordFilePath: String? = null

  /** `file://` URI of the most recently completed record-to-file session. */
  @Volatile
  var lastRecordingUri: String? = null
    private set

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
      val min = AudioRecord.getMinBufferSize(currentSampleRate, CHANNEL_CONFIG, AUDIO_FORMAT)
      if (min > 0) return min

      val fallback = maxOf((currentSampleRate / 5) * 2, 4096)
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
   *
   * [sampleRate] is the requested capture rate. Only 44.1 kHz is universally
   * guaranteed by Android, so if the device rejects the requested rate
   * (`getMinBufferSize` error, `Builder.build()` throwing, or a failed init)
   * capture falls back to [RECORD_SAMPLE_RATE] with a warning instead of
   * failing the session; the rate in effect is exposed as [currentSampleRate].
   */
  fun start(
    enableVoiceProcessing: Boolean,
    recordToFilePath: String? = null,
    sampleRate: Int = RECORD_SAMPLE_RATE,
  ) {
    lastRecordingUri = null

    currentSampleRate = if (
      sampleRate == RECORD_SAMPLE_RATE ||
      AudioRecord.getMinBufferSize(sampleRate, CHANNEL_CONFIG, AUDIO_FORMAT) > 0
    ) {
      sampleRate
    } else {
      Log.w(TAG, "Sample rate $sampleRate Hz unsupported; falling back to $RECORD_SAMPLE_RATE Hz")
      RECORD_SAMPLE_RATE
    }

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
      // `AudioRecord.Builder.build()` throws UnsupportedOperationException and
      // a fresh recorder can report a failed init when the device cannot
      // capture at the requested rate — retry once at the guaranteed-safe
      // 16 kHz before giving up so an exotic rate never kills the session.
      var recorder = try {
        buildAudioRecord(audioSource)
      } catch (e: UnsupportedOperationException) {
        if (currentSampleRate == RECORD_SAMPLE_RATE) throw e
        Log.w(TAG, "AudioRecord rejected $currentSampleRate Hz; falling back to $RECORD_SAMPLE_RATE Hz", e)
        currentSampleRate = RECORD_SAMPLE_RATE
        buildAudioRecord(audioSource)
      }

      if (recorder.state != AudioRecord.STATE_INITIALIZED &&
        currentSampleRate != RECORD_SAMPLE_RATE
      ) {
        Log.w(TAG, "AudioRecord init failed at $currentSampleRate Hz; falling back to $RECORD_SAMPLE_RATE Hz")
        recorder.release()
        currentSampleRate = RECORD_SAMPLE_RATE
        recorder = buildAudioRecord(audioSource)
      }
      audioRecord = recorder

      if (recorder.state != AudioRecord.STATE_INITIALIZED) {
        recorder.release()
        audioRecord = null
        releaseAudioEffects()
        restoreAudioModeIfNeeded()
        throw InitializationException("AudioRecord initialization failed")
      }

      // Open the WAV target before we start capturing so a file-system failure
      // aborts the whole start (mapped to "start_error") instead of silently
      // dropping the recording.
      if (recordToFilePath != null) {
        openRecordingFile(recordToFilePath)
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
      discardRecordingFile()
      throw e
    } catch (e: InitializationException) {
      throw e
    } catch (e: Exception) {
      Log.e(TAG, "startRecording error", e)
      audioRecord?.release()
      audioRecord = null
      releaseAudioEffects()
      restoreAudioModeIfNeeded()
      discardRecordingFile()
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

    // The recording thread has joined, so no writer can race the finalize.
    val finalizedUri = finalizeRecordingFile()
    if (finalizedUri != null) {
      lastRecordingUri = finalizedUri
    }

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
            writeRecordingFile(buffer, read)
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

  /**
   * Open [path] (with or without a `file://` scheme) and write a placeholder
   * WAV header. Throws if the file cannot be created so [start] can surface the
   * failure as "start_error".
   */
  private fun openRecordingFile(path: String) {
    val clean = if (path.startsWith("file://")) {
      Uri.parse(path).path ?: path.removePrefix("file://")
    } else {
      path
    }
    val file = File(clean)
    file.parentFile?.let { if (!it.exists()) it.mkdirs() }

    val raf = RandomAccessFile(file, "rw")
    try {
      raf.setLength(0)
      raf.write(buildWavHeader(0))
    } catch (e: Exception) {
      try { raf.close() } catch (_: Exception) {}
      throw e
    }
    fileOutput = raf
    fileDataBytes = 0L
    recordFilePath = file.absolutePath
    Log.i(TAG, "record-to-file: writing to ${file.absolutePath}")
  }

  /** Append captured PCM to the open WAV file. Stops teeing on a write error. */
  private fun writeRecordingFile(buffer: ByteArray, length: Int) {
    val out = fileOutput ?: return
    try {
      out.write(buffer, 0, length)
      fileDataBytes += length
    } catch (e: Exception) {
      Log.w(TAG, "record-to-file write failed", e)
      discardRecordingFile()
    }
  }

  /**
   * Patch the RIFF/`data` sizes into the header, close the file and return its
   * `file://` URI. Returns null when no record-to-file session was active.
   */
  private fun finalizeRecordingFile(): String? {
    val out = fileOutput ?: return null
    val path = recordFilePath
    val dataBytes = fileDataBytes
    fileOutput = null
    fileDataBytes = 0L
    recordFilePath = null

    try {
      out.seek(4)
      out.write(intToLittleEndian((36 + dataBytes).toInt()))
      out.seek(40)
      out.write(intToLittleEndian(dataBytes.toInt()))
      out.close()
    } catch (e: Exception) {
      Log.w(TAG, "record-to-file finalize failed", e)
      try { out.close() } catch (_: Exception) {}
    }

    return path?.let { Uri.fromFile(File(it)).toString() }
  }

  /** Close and delete any partially written file without producing a URI. */
  private fun discardRecordingFile() {
    val out = fileOutput
    val path = recordFilePath
    fileOutput = null
    fileDataBytes = 0L
    recordFilePath = null

    if (out != null) {
      try { out.close() } catch (_: Exception) {}
    }
    if (path != null) {
      try { File(path).delete() } catch (_: Exception) {}
    }
  }

  private fun buildWavHeader(dataBytes: Int): ByteArray {
    val channels = 1
    val bitsPerSample = 16
    val byteRate = currentSampleRate * channels * bitsPerSample / 8
    val blockAlign = channels * bitsPerSample / 8

    return ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray(Charsets.US_ASCII))
      putInt(36 + dataBytes)
      put("WAVE".toByteArray(Charsets.US_ASCII))
      put("fmt ".toByteArray(Charsets.US_ASCII))
      putInt(16) // PCM fmt chunk size
      putShort(1) // PCM
      putShort(channels.toShort())
      putInt(currentSampleRate)
      putInt(byteRate)
      putShort(blockAlign.toShort())
      putShort(bitsPerSample.toShort())
      put("data".toByteArray(Charsets.US_ASCII))
      putInt(dataBytes)
    }.array()
  }

  private fun buildAudioRecord(audioSource: Int): AudioRecord =
    AudioRecord.Builder()
      .setAudioSource(audioSource)
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AUDIO_FORMAT)
          .setSampleRate(currentSampleRate)
          .setChannelMask(CHANNEL_CONFIG)
          .build()
      )
      .setBufferSizeInBytes(bufferSize)
      .build()

  private fun intToLittleEndian(value: Int): ByteArray =
    ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array()

  companion object {
    private const val TAG = "DeepgramRecorder"

    // Default (and fallback) capture rate. Exposed so the module can default
    // the rate when JS does not request one.
    const val RECORD_SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
  }
}
