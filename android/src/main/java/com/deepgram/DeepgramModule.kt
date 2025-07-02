package com.deepgram

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Native module that records raw PCM audio and plays back base64 encoded
 * PCM chunks. Audio data recorded from the microphone is emitted to JS as the
 * `AudioChunk` event.
 */
class DeepgramModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "Deepgram"
    private const val TAG = "DeepgramModule"
    private const val SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
  }

  private val minBufferSize: Int =
    AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
  private var bufferSize: Int = minBufferSize * 4

  private var audioRecord: AudioRecord? = null
  private var recordingThread: Thread? = null
  private var isRecording = false

  private var audioTrack: AudioTrack? = null

  override fun getName() = NAME

  // -------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------

  @ReactMethod
  fun startRecording(promise: Promise) {
    if (isRecording) {
      promise.resolve(null)
      return
    }

    try {
      audioRecord = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        CHANNEL_CONFIG,
        AUDIO_FORMAT,
        bufferSize
      )

      if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
        promise.reject("init_failed", "AudioRecord initialization failed")
        return
      }

      audioRecord?.startRecording()
      isRecording = true

      startRecordingThread()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "startRecording error", e)
      promise.reject("start_error", e)
    }
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      isRecording = false
      recordingThread?.interrupt()
      recordingThread = null
      audioRecord?.stop()
      audioRecord?.release()
      audioRecord = null
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopRecording error", e)
      promise.reject("stop_error", e)
    }
  }

  private fun startRecordingThread() {
    recordingThread = Thread {
      try {
        val buffer = ByteArray(bufferSize)
        while (isRecording && audioRecord != null) {
          val read = audioRecord!!.read(buffer, 0, buffer.size)
          if (read > 0) {
            sendAudioChunk(buffer.copyOf(read))
          }
        }
      } catch (e: Exception) {
        Log.e(TAG, "recording thread error", e)
      }
    }
    recordingThread?.start()
  }

  private fun sendAudioChunk(byteArray: ByteArray) {
    val map = WritableNativeMap()
    val array = WritableNativeArray()
    for (b in byteArray) {
      array.pushInt(b.toInt())
    }
    map.putArray("data", array)
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("AudioChunk", map)
  }

  // -------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------

  private fun ensureAudioTrack() {
    if (audioTrack != null) return

    val channelMask = AudioFormat.CHANNEL_OUT_MONO
    val minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, channelMask, AUDIO_FORMAT)

    audioTrack = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AUDIO_FORMAT)
          .setSampleRate(SAMPLE_RATE)
          .setChannelMask(channelMask)
          .build()
      )
      .setBufferSizeInBytes(minBuf)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  @ReactMethod
  fun startAudio(promise: Promise) {
    try {
      ensureAudioTrack()
      audioTrack?.play()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "startAudio error", e)
      promise.reject("audio_start_error", e)
    }
  }

  @ReactMethod
  fun stopAudio(promise: Promise) {
    try {
      audioTrack?.stop()
      audioTrack?.release()
      audioTrack = null
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopAudio error", e)
      promise.reject("audio_stop_error", e)
    }
  }

  @ReactMethod
  fun playAudioChunk(chunk: String, promise: Promise) {
    try {
      ensureAudioTrack()
      val audioData = Base64.decode(chunk, Base64.DEFAULT)
      audioTrack?.write(audioData, 0, audioData.size)
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "playAudioChunk error", e)
      promise.reject("play_error", e)
    }
  }
}
