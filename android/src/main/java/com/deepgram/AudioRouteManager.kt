package com.deepgram

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.util.Log

/**
 * Owns audio output-route selection for the Deepgram module (speaker /
 * earpiece / Bluetooth) and forwards system route changes (headphone
 * plug/unplug, Bluetooth connect/disconnect) back to the module so they can be
 * surfaced to JS as the `DeepgramRouteChange` event.
 *
 * Routing is best-effort and device-dependent. On API 31+ we use the modern
 * [AudioManager.setCommunicationDevice] API; on older releases we fall back to
 * the legacy `setSpeakerphoneOn` / `startBluetoothSco` switches.
 */
internal class AudioRouteManager(
  context: Context,
  private val mainHandler: Handler,
  private val onRouteChange: (String) -> Unit,
) {
  private val audioManager: AudioManager? =
    context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  private var deviceCallback: AudioDeviceCallback? = null

  @Volatile
  private var requestedRoute: String = ROUTE_AUTO

  /** Begin observing route changes. Idempotent. */
  fun start() {
    val manager = audioManager ?: return
    if (deviceCallback != null) return
    val callback = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
        onRouteChange(currentRoute())
      }

      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
        onRouteChange(currentRoute())
      }
    }
    try {
      manager.registerAudioDeviceCallback(callback, mainHandler)
      deviceCallback = callback
    } catch (e: Exception) {
      Log.w(TAG, "registerAudioDeviceCallback failed", e)
    }
  }

  /** Stop observing route changes. Idempotent. */
  fun stop() {
    val manager = audioManager ?: return
    deviceCallback?.let {
      try {
        manager.unregisterAudioDeviceCallback(it)
      } catch (e: Exception) {
        Log.w(TAG, "unregisterAudioDeviceCallback failed", e)
      }
    }
    deviceCallback = null
  }

  /**
   * Apply a preferred route. Throws [IllegalStateException] when the platform
   * AudioManager is unavailable so the caller can reject the promise.
   */
  fun setRoute(route: String) {
    require(
      route == ROUTE_SPEAKER ||
        route == ROUTE_EARPIECE ||
        route == ROUTE_BLUETOOTH ||
        route == ROUTE_AUTO
    ) {
      "Unknown audio route '$route'"
    }
    val manager = audioManager
      ?: throw IllegalStateException("AudioManager is unavailable")
    requestedRoute = route
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      applyRouteApi31(manager, route)
    } else {
      applyRouteLegacy(manager, route)
    }
    onRouteChange(currentRoute())
  }

  /** Resolve the route the system is currently using. */
  fun currentRoute(): String {
    val manager = audioManager ?: return ROUTE_SPEAKER

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      manager.communicationDevice?.let { return mapDeviceType(it.type) }
    }

    // A wired/USB output that is physically connected wins over the built-in
    // speaker/earpiece regardless of our request.
    val outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    for (device in outputs) {
      when (device.type) {
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE -> return ROUTE_WIRED
      }
    }

    @Suppress("DEPRECATION")
    if (manager.isBluetoothScoOn) return ROUTE_BLUETOOTH

    @Suppress("DEPRECATION")
    if (manager.isSpeakerphoneOn) return ROUTE_SPEAKER

    return if (requestedRoute == ROUTE_EARPIECE) ROUTE_EARPIECE else ROUTE_SPEAKER
  }

  private fun applyRouteApi31(manager: AudioManager, route: String) {
    when (route) {
      ROUTE_SPEAKER ->
        selectCommunicationDevice(manager, intArrayOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
      ROUTE_EARPIECE ->
        selectCommunicationDevice(manager, intArrayOf(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE))
      ROUTE_BLUETOOTH ->
        selectCommunicationDevice(
          manager,
          intArrayOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
          ),
        )
      else -> manager.clearCommunicationDevice()
    }
  }

  private fun selectCommunicationDevice(manager: AudioManager, types: IntArray) {
    val device = manager.availableCommunicationDevices.firstOrNull { it.type in types }
    if (device != null) {
      if (!manager.setCommunicationDevice(device)) {
        Log.w(TAG, "setCommunicationDevice(type=${device.type}) returned false")
      }
    } else {
      // Requested device isn't connected — fall back to the system default.
      manager.clearCommunicationDevice()
    }
  }

  @Suppress("DEPRECATION")
  private fun applyRouteLegacy(manager: AudioManager, route: String) {
    when (route) {
      ROUTE_SPEAKER -> {
        stopSco(manager)
        manager.isSpeakerphoneOn = true
      }
      ROUTE_EARPIECE -> {
        stopSco(manager)
        manager.isSpeakerphoneOn = false
      }
      ROUTE_BLUETOOTH -> {
        manager.isSpeakerphoneOn = false
        try {
          manager.startBluetoothSco()
          manager.isBluetoothScoOn = true
        } catch (e: Exception) {
          Log.w(TAG, "startBluetoothSco failed", e)
        }
      }
      else -> {
        stopSco(manager)
        manager.isSpeakerphoneOn = false
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun stopSco(manager: AudioManager) {
    try {
      if (manager.isBluetoothScoOn) {
        manager.isBluetoothScoOn = false
        manager.stopBluetoothSco()
      }
    } catch (e: Exception) {
      Log.w(TAG, "stopBluetoothSco failed", e)
    }
  }

  private fun mapDeviceType(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> ROUTE_SPEAKER
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> ROUTE_EARPIECE
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLE_HEADSET -> ROUTE_BLUETOOTH
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE -> ROUTE_WIRED
    else -> ROUTE_SPEAKER
  }

  companion object {
    private const val TAG = "DeepgramRoute"
    const val ROUTE_SPEAKER = "speaker"
    const val ROUTE_EARPIECE = "earpiece"
    const val ROUTE_BLUETOOTH = "bluetooth"
    const val ROUTE_WIRED = "wired"
    const val ROUTE_AUTO = "auto"
  }
}
