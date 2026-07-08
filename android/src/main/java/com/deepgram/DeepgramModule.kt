package com.deepgram

import android.Manifest
import android.content.pm.PackageManager
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

/**
 * React Native bridge for Deepgram audio.
 *
 * This class is intentionally thin: it owns the JS-facing `@ReactMethod`
 * surface, the foreground-service lifecycle, and audio-focus arbitration, and
 * delegates the actual audio work to three focused collaborators:
 *
 *   - [AudioRecorder]     microphone capture (emitted to JS as the `AudioChunk` event)
 *   - [AudioPlayer]       TTS streaming + one-shot playback
 *   - [AudioFocusManager] system audio-focus arbitration
 *
 * Microphone audio is emitted to JS as the `AudioChunk` event with
 * base64-encoded 16 kHz PCM16.
 */
class DeepgramModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), AudioFocusManager.Listener {

  private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

  private val focusManager = AudioFocusManager(reactContext, mainHandler, this)

  private val recorder = AudioRecorder(
    context = reactContext,
    onAudioChunk = { data, length -> sendAudioChunk(data, length) },
    onForegroundServiceRequest = { startForegroundAudioService() },
    onForegroundServiceRelease = { stopForegroundAudioServiceIfInactive() },
    onAudioLevel = { level -> sendAudioLevel(level) },
  )

  private val player = AudioPlayer(
    context = reactContext,
    mainHandler = mainHandler,
    focusManager = focusManager,
    onForegroundServiceRequest = { startForegroundAudioService() },
    onForegroundServiceRelease = { stopForegroundAudioServiceIfInactive() },
  )

  private val routeManager = AudioRouteManager(
    context = reactContext,
    mainHandler = mainHandler,
    onRouteChange = { route -> sendRouteChange(route) },
  )

  /** True between a transient focus-loss `began` and the matching `ended`. */
  @Volatile
  private var interruptionActive = false

  init {
    // Observe output-route changes (headset plug/unplug, Bluetooth
    // connect/disconnect) for the module's lifetime so `DeepgramRouteChange`
    // fires even while idle.
    routeManager.start()
  }

  override fun getName() = NAME

  // -------------------------------------------------------------------
  // Audio focus (AudioFocusManager.Listener)
  // -------------------------------------------------------------------

  override fun onFocusLostPermanently() {
    // Permanent loss (e.g. another app took focus). Tear down so we don't fight
    // other audio packages and so we release the microphone. Order matches the
    // original: stop playback first, then recording.
    try { player.stopStreamingPlayback(throwOnError = false) } catch (_: Exception) {}
    try { player.stopOneShotPlayback() } catch (_: Exception) {}
    try { recorder.stop(throwOnError = false) } catch (_: Exception) {}
    interruptionActive = false
    sendInterruption { map ->
      map.putString("type", "stopped")
      map.putString("reason", "focusLossPermanent")
    }
  }

  override fun onFocusLostTransiently() {
    // Transient loss (e.g. incoming call) — pause playback but keep state.
    player.pauseForFocusLoss()
    if (!interruptionActive) {
      interruptionActive = true
      sendInterruption { map ->
        map.putString("type", "began")
        map.putString("reason", "focusLoss")
      }
    }
  }

  override fun onFocusGained() {
    player.resumeForFocusGain()
    if (interruptionActive) {
      interruptionActive = false
      sendInterruption { map ->
        map.putString("type", "ended")
        map.putBoolean("shouldResume", true)
      }
    }
  }

  // -------------------------------------------------------------------
  // Foreground service coordination
  //
  // The keep-alive foreground service is shared by recording and playback: it
  // is (re)started whenever either becomes active and stopped only once BOTH
  // are inactive. It advertises the microphone type only while capturing.
  // -------------------------------------------------------------------

  private fun startForegroundAudioService() {
    try {
      DeepgramAudioService.start(reactContext, withMicrophone = recorder.isActive)
    } catch (e: Exception) {
      Log.w(TAG, "Unable to start foreground audio service", e)
    }
  }

  private fun stopForegroundAudioServiceIfInactive() {
    if (recorder.isActive || player.isActive) return
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
    if (recorder.isActive) {
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

    val recordToFilePath = resolveRecordToFilePath(options)

    try {
      recorder.start(enableVoiceProcessing, recordToFilePath)
      promise.resolve(null)
    } catch (e: SecurityException) {
      promise.reject("permission_denied", e)
    } catch (e: AudioRecorder.InitializationException) {
      promise.reject("init_failed", e.message)
    } catch (e: Exception) {
      promise.reject("start_error", e)
    }
  }

  /**
   * Resolve the WAV destination for a record-to-file session, or null when the
   * caller did not request one. A caller-supplied `path` wins; otherwise we
   * generate an app-specific cache path so the result is a shareable file URI.
   */
  private fun resolveRecordToFilePath(options: ReadableMap?): String? {
    val rtf = options?.takeIf { it.hasKey("recordToFile") && !it.isNull("recordToFile") }
      ?.getMap("recordToFile")
      ?: return null

    val enabled = rtf.hasKey("enabled") && !rtf.isNull("enabled") && rtf.getBoolean("enabled")
    if (!enabled) return null

    val custom = if (rtf.hasKey("path") && !rtf.isNull("path")) rtf.getString("path") else null
    if (!custom.isNullOrEmpty()) return custom

    return java.io.File(
      reactContext.cacheDir,
      "deepgram-recording-${System.currentTimeMillis()}.wav"
    ).absolutePath
  }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    try {
      recorder.stop()
      val uri = recorder.lastRecordingUri
      if (uri != null) {
        val map = WritableNativeMap()
        map.putString("recordingUri", uri)
        promise.resolve(map)
      } else {
        promise.resolve(null)
      }
    } catch (e: Exception) {
      Log.e(TAG, "stopRecording error", e)
      promise.reject("stop_error", e)
    }
  }

  // -------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------

  @ReactMethod
  fun startAudio(promise: Promise) {
    try {
      player.startAudio()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "startAudio error", e)
      promise.reject("audio_start_error", e)
    }
  }

  @ReactMethod
  fun stopAudio(promise: Promise) {
    try {
      player.stopAudio()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopAudio error", e)
      promise.reject("audio_stop_error", e)
    }
  }

  @ReactMethod
  fun startPlayer(sampleRate: Int, channels: Int) {
    player.startPlayer(sampleRate, channels)
  }

  @ReactMethod
  fun setAudioConfig(sampleRate: Int, channels: Int) {
    player.setAudioConfig(sampleRate, channels)
  }

  @ReactMethod
  fun setMeteringEnabled(enabled: Boolean, intervalMs: Double) {
    recorder.setMetering(enabled, intervalMs.toLong())
  }

  @ReactMethod
  fun feedAudio(base64Audio: String) {
    player.feedAudio(base64Audio)
  }

  @ReactMethod
  fun interruptAudio() {
    player.interruptAudio()
  }

  @ReactMethod
  fun stopPlayer(promise: Promise?) {
    try {
      player.stopStreamingPlayback()
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
    player.playAudioChunk(
      chunk,
      onSuccess = { promise.resolve(null) },
      onError = { code, message -> promise.reject(code, message) },
    )
  }

  // -------------------------------------------------------------------
  // Audio output routing
  // -------------------------------------------------------------------

  @ReactMethod
  fun setAudioRoute(route: String, promise: Promise) {
    try {
      routeManager.setRoute(route)
      promise.resolve(null)
    } catch (e: IllegalArgumentException) {
      Log.e(TAG, "setAudioRoute invalid route", e)
      promise.reject("invalid_data", e)
    } catch (e: Exception) {
      Log.e(TAG, "setAudioRoute error", e)
      promise.reject("playback_error", e)
    }
  }

  @ReactMethod
  fun getAudioRoute(promise: Promise) {
    try {
      promise.resolve(routeManager.currentRoute())
    } catch (e: Exception) {
      Log.e(TAG, "getAudioRoute error", e)
      promise.reject("playback_error", e)
    }
  }

  override fun invalidate() {
    try {
      recorder.stop(false)
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping recording on invalidate", e)
    }

    try {
      player.release()
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping playback on invalidate", e)
    }

    routeManager.stop()
    focusManager.abandonFocus()
    super.invalidate()
  }

  /**
   * Emit microphone audio to JS as base64-encoded PCM (matches the iOS
   * `DeepgramAudioPCM` payload shape). Far more efficient than sending
   * individual byte values.
   */
  private fun sendAudioChunk(data: ByteArray, length: Int) {
    if (!reactContext.hasActiveReactInstance()) return
    val b64 = Base64.encodeToString(data, 0, length, Base64.NO_WRAP)
    val map = WritableNativeMap()
    map.putString("b64", b64)
    map.putInt("sampleRate", AudioRecorder.RECORD_SAMPLE_RATE)
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("AudioChunk", map)
    } catch (e: Exception) {
      // Catalyst tearing down or JS bundle not ready — drop silently.
      Log.w(TAG, "sendAudioChunk emit failed", e)
    }
  }

  /**
   * Emit a microphone audio level (normalized RMS, 0..1) to JS as the
   * `AudioLevel` event (matches the iOS `DeepgramAudioLevel` payload shape).
   */
  private fun sendAudioLevel(level: Double) {
    if (!reactContext.hasActiveReactInstance()) return
    val map = WritableNativeMap()
    map.putDouble("level", level)
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("AudioLevel", map)
    } catch (e: Exception) {
      // Catalyst tearing down or JS bundle not ready — drop silently.
      Log.w(TAG, "sendAudioLevel emit failed", e)
    }
  }

  /**
   * Emit the active output route to JS as the `DeepgramRouteChange` event
   * (shared event name with iOS; payload `{ route }`).
   */
  private fun sendRouteChange(route: String) {
    if (!reactContext.hasActiveReactInstance()) return
    val map = WritableNativeMap()
    map.putString("route", route)
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("DeepgramRouteChange", map)
    } catch (e: Exception) {
      // Catalyst tearing down or JS bundle not ready — drop silently.
      Log.w(TAG, "sendRouteChange emit failed", e)
    }
  }

  /**
   * Emit an audio-focus interruption to JS as the `DeepgramInterruption`
   * event (shared event name with iOS). Observability only — the focus
   * callbacks above already pause/resume/tear down the audio pipeline.
   */
  private fun sendInterruption(populate: (WritableNativeMap) -> Unit) {
    if (!reactContext.hasActiveReactInstance()) return
    val map = WritableNativeMap()
    populate(map)
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("DeepgramInterruption", map)
    } catch (e: Exception) {
      // Catalyst tearing down or JS bundle not ready — drop silently.
      Log.w(TAG, "sendInterruption emit failed", e)
    }
  }

  companion object {
    const val NAME = "Deepgram"
    private const val TAG = "DeepgramModule"
  }
}
