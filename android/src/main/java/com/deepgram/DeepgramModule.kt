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
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeMap

/**
 * TurboModule for Deepgram audio (implements the codegen'd [NativeDeepgramSpec]).
 *
 * This class is intentionally thin: it owns the JS-facing spec methods, the
 * foreground-service lifecycle, and audio-focus arbitration, and delegates the
 * actual audio work to focused collaborators:
 *
 *   - [AudioRecorder]     microphone capture (emitted to JS as `onAudioPCM`)
 *   - [AudioPlayer]       TTS streaming + one-shot playback
 *   - [AudioFocusManager] system audio-focus arbitration
 *   - [AudioRouteManager] output routing (emitted as `onAudioRouteChange`)
 */
class DeepgramModule(private val reactContext: ReactApplicationContext) :
  NativeDeepgramSpec(reactContext), AudioFocusManager.Listener {

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
    // connect/disconnect) for the module's lifetime so `onAudioRouteChange`
    // fires even while idle.
    routeManager.start()
  }

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

  /** Reports the current grant; prompting is done from JS via PermissionsAndroid. */
  override fun requestRecordPermission(promise: Promise) {
    promise.resolve(
      ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
    )
  }

  override fun startRecording(options: ReadableMap, promise: Promise) {
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

    val enableVoiceProcessing = options.hasKey("enableVoiceProcessing") &&
      !options.isNull("enableVoiceProcessing") &&
      options.getBoolean("enableVoiceProcessing")

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
  private fun resolveRecordToFilePath(options: ReadableMap): String? {
    val rtf = options.takeIf { it.hasKey("recordToFile") && !it.isNull("recordToFile") }
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

  override fun stopRecording(promise: Promise) {
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

  override fun startAudio(promise: Promise) {
    try {
      player.startAudio()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "startAudio error", e)
      promise.reject("audio_start_error", e)
    }
  }

  override fun stopAudio(promise: Promise) {
    try {
      player.stopAudio()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopAudio error", e)
      promise.reject("audio_stop_error", e)
    }
  }

  override fun startPlayer(sampleRate: Double, channels: Double) {
    player.startPlayer(sampleRate.toInt(), channels.toInt())
  }

  override fun setAudioConfig(sampleRate: Double, channels: Double) {
    player.setAudioConfig(sampleRate.toInt(), channels.toInt())
  }

  override fun setMeteringEnabled(enabled: Boolean, intervalMs: Double) {
    recorder.setMetering(enabled, intervalMs.toLong())
  }

  override fun feedAudio(base64Chunk: String) {
    player.feedAudio(base64Chunk)
  }

  override fun interruptAudio() {
    player.interruptAudio()
  }

  override fun stopPlayer(promise: Promise) {
    try {
      player.stopStreamingPlayback()
      promise.resolve(null)
    } catch (e: Exception) {
      Log.e(TAG, "stopPlayer error", e)
      promise.reject("stop_player_error", e)
    }
  }

  // -------------------------------------------------------------------
  // One-shot playback (for HTTP synthesis)
  // -------------------------------------------------------------------

  override fun playAudioChunk(base64Chunk: String, promise: Promise) {
    player.playAudioChunk(
      base64Chunk,
      onSuccess = { promise.resolve(null) },
      onError = { code, message -> promise.reject(code, message) },
    )
  }

  // -------------------------------------------------------------------
  // Audio output routing
  // -------------------------------------------------------------------

  override fun setAudioRoute(route: String, promise: Promise) {
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

  override fun getAudioRoute(promise: Promise) {
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

  /** Emit microphone audio to JS as base64-encoded PCM16 (`onAudioPCM`). */
  private fun sendAudioChunk(data: ByteArray, length: Int) {
    if (!reactContext.hasActiveReactInstance()) return
    val b64 = Base64.encodeToString(data, 0, length, Base64.NO_WRAP)
    val map = WritableNativeMap()
    map.putString("b64", b64)
    map.putInt("sampleRate", AudioRecorder.RECORD_SAMPLE_RATE)
    emitSafely("onAudioPCM") { emitOnAudioPCM(map) }
  }

  /** Emit a microphone audio level (normalized RMS, 0..1) as `onAudioLevel`. */
  private fun sendAudioLevel(level: Double) {
    if (!reactContext.hasActiveReactInstance()) return
    val map = WritableNativeMap()
    map.putDouble("level", level)
    emitSafely("onAudioLevel") { emitOnAudioLevel(map) }
  }

  /** Emit the active output route (`{ route }`) as `onAudioRouteChange`. */
  private fun sendRouteChange(route: String) {
    if (!reactContext.hasActiveReactInstance()) return
    val map = WritableNativeMap()
    map.putString("route", route)
    emitSafely("onAudioRouteChange") { emitOnAudioRouteChange(map) }
  }

  /**
   * Emit an audio-focus interruption as `onAudioInterruption`. Observability
   * only — the focus callbacks above already pause/resume/tear down the audio
   * pipeline.
   */
  private fun sendInterruption(populate: (WritableNativeMap) -> Unit) {
    if (!reactContext.hasActiveReactInstance()) return
    val map = WritableNativeMap()
    populate(map)
    emitSafely("onAudioInterruption") { emitOnAudioInterruption(map) }
  }

  private inline fun emitSafely(event: String, emit: () -> Unit) {
    try {
      emit()
    } catch (e: Exception) {
      // React instance tearing down or JS bundle not ready — drop silently.
      Log.w(TAG, "$event emit failed", e)
    }
  }

  companion object {
    const val NAME = NativeDeepgramSpec.NAME
    private const val TAG = "DeepgramModule"
  }
}
