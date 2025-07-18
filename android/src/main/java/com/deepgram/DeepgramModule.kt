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
    private const val DEFAULT_SAMPLE_RATE = 16000
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
  }

  private var currentSampleRate: Int = DEFAULT_SAMPLE_RATE
  private val minBufferSize: Int
    get() = AudioRecord.getMinBufferSize(currentSampleRate, CHANNEL_CONFIG, AUDIO_FORMAT)
  private val bufferSize: Int
    get() = minBufferSize * 4

  private var audioRecord: AudioRecord? = null
  private var recordingThread: Thread? = null
  private var isRecording = false

  // Enhanced TTS Playback Properties
  private var audioTrack: AudioTrack? = null
  private var audioBuffer: ByteArray = ByteArray(0)
  private var isPlaying = false
  private var playbackThread: Thread? = null
  private val bufferLock = Any()
  private val playbackThreshold = 1000 // Wait for at least 1KB before starting playback

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
        currentSampleRate,
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
    val minBuf = AudioTrack.getMinBufferSize(currentSampleRate, channelMask, AUDIO_FORMAT)

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
          .setSampleRate(currentSampleRate)
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



  // -------------------------------------------------------------------
  // Enhanced TTS Streaming Audio Player (matches iOS functionality)
  // -------------------------------------------------------------------

  @ReactMethod
  fun startPlayer(sampleRate: Int, channels: Int) {
    stopStreamingPlayback()
    
    currentSampleRate = sampleRate
    synchronized(bufferLock) {
      audioBuffer = ByteArray(0)
    }
    isPlaying = false
    
    Log.d(TAG, "Audio player initialized: ${sampleRate}Hz, ${channels} channels")
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
      
      Log.d(TAG, "Feeding ${audioData.size} bytes of audio for streaming")
      
      // Add audio data to buffer
      synchronized(bufferLock) {
        audioBuffer = audioBuffer + audioData
      }
      
      // Start playback if we have enough data and aren't already playing
      if (!isPlaying && audioBuffer.size >= playbackThreshold) {
        startStreamingPlayback()
      }
      
    } catch (e: Exception) {
      Log.e(TAG, "feedAudio error", e)
    }
  }

  private fun startStreamingPlayback() {
    if (isPlaying) return
    
    isPlaying = true
    playbackThread = Thread {
      try {
        ensureAudioTrack()
        audioTrack?.play()
        
        while (isPlaying) {
          var dataToPlay = ByteArray(0)
          var shouldContinue = true
          
          synchronized(bufferLock) {
            if (audioBuffer.isEmpty()) {
              // No more data, stop playing
              shouldContinue = false
            } else {
              // Take all available data
              dataToPlay = audioBuffer
              audioBuffer = ByteArray(0)
            }
          }
          
          if (!shouldContinue) {
            break
          }
          
          if (dataToPlay.isNotEmpty()) {
            Log.d(TAG, "Playing accumulated audio: ${dataToPlay.size} bytes")
            val written = audioTrack?.write(dataToPlay, 0, dataToPlay.size) ?: 0
            
            if (written < 0) {
              Log.e(TAG, "AudioTrack write error: $written")
              break
            }
          } else {
            // Small delay to prevent busy waiting
            Thread.sleep(10)
          }
        }
        
      } catch (e: Exception) {
        Log.e(TAG, "Streaming playback error", e)
      } finally {
        isPlaying = false
        Log.d(TAG, "Streaming playback finished")
      }
    }
    
    playbackThread?.start()
  }

  private fun stopStreamingPlayback() {
    isPlaying = false
    playbackThread?.interrupt()
    playbackThread = null
    
    audioTrack?.stop()
    audioTrack?.release()
    audioTrack = null
    
    synchronized(bufferLock) {
      audioBuffer = ByteArray(0)
    }
  }

  @ReactMethod
  fun stopPlayer(promise: Promise?) {
    try {
      stopStreamingPlayback()
      Log.d(TAG, "Audio player stopped and cleaned up")
      promise?.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopPlayer error", e)
      promise?.reject("stop_player_error", e)
    }
  }

  // -------------------------------------------------------------------
  // One-shot playback (for HTTP synthesis)
  // -------------------------------------------------------------------

  @ReactMethod
  fun playAudioChunk(chunk: String, promise: Promise) {
    try {
      Log.d(TAG, "Playing single audio chunk")
      
      val audioData = Base64.decode(chunk, Base64.DEFAULT)
      if (audioData.isEmpty()) {
        promise.reject("invalid_data", "Failed to decode audio data")
        return
      }
      
      // For one-shot playback, create a temporary AudioTrack
      val channelMask = AudioFormat.CHANNEL_OUT_MONO
      val minBuf = AudioTrack.getMinBufferSize(currentSampleRate, channelMask, AUDIO_FORMAT)
      
      val tempAudioTrack = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AUDIO_FORMAT)
            .setSampleRate(currentSampleRate)
            .setChannelMask(channelMask)
            .build()
        )
        .setBufferSizeInBytes(maxOf(minBuf, audioData.size))
        .setTransferMode(AudioTrack.MODE_STATIC)
        .build()
      
      tempAudioTrack.write(audioData, 0, audioData.size)
      tempAudioTrack.play()
      
      // Clean up after playback completes
      Thread {
        try {
          // Wait for playback to complete
          while (tempAudioTrack.playState == AudioTrack.PLAYSTATE_PLAYING) {
            Thread.sleep(50)
          }
        } finally {
          tempAudioTrack.stop()
          tempAudioTrack.release()
        }
      }.start()
      
      promise.resolve(null)
      
    } catch (e: Exception) {
      Log.e(TAG, "playAudioChunk error", e)
      promise.reject("playback_error", e.message)
    }
  }
}
