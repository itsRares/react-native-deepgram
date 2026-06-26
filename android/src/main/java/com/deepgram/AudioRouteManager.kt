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

  /**
   * Enumerate the output devices currently available for routing. On API 31+
   * each connected Bluetooth headset is listed individually (with the system
   * [AudioDeviceInfo.id] as a stable id), so a UI can present and pick between
   * several of them by name. On older releases we report the coarse
   * speaker/earpiece options plus whichever wired/Bluetooth category is
   * connected (multiple Bluetooth devices can't be distinguished pre-31).
   */
  fun availableDevices(): List<RouteDevice> {
    val manager = audioManager
      ?: return listOf(RouteDevice(ROUTE_SPEAKER, "Speaker", ROUTE_SPEAKER, true))

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      availableDevicesApi31(manager)
    } else {
      availableDevicesLegacy(manager)
    }
  }

  /**
   * Route audio to a specific device. On API 31+ [id] is an
   * [AudioDeviceInfo.id]; otherwise it is a coarse route keyword (the same
   * values [setRoute] accepts). Throws [IllegalArgumentException] for an
   * unknown id and [IllegalStateException] when AudioManager is unavailable.
   */
  fun selectDevice(id: String) {
    val manager = audioManager
      ?: throw IllegalStateException("AudioManager is unavailable")

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val target = manager.availableCommunicationDevices.firstOrNull {
        it.id.toString() == id
      }
      if (target != null) {
        requestedRoute = displayTypeFor(target.type) ?: requestedRoute
        if (!manager.setCommunicationDevice(target)) {
          Log.w(TAG, "setCommunicationDevice(id=$id) returned false")
        }
        onRouteChange(currentRoute())
        return
      }
    }

    // Legacy build, or a coarse route keyword passed straight through.
    setRoute(id)
  }

  @androidx.annotation.RequiresApi(Build.VERSION_CODES.S)
  private fun availableDevicesApi31(manager: AudioManager): List<RouteDevice> {
    val selectedId = manager.communicationDevice?.id
    val seen = HashSet<Int>()
    val result = ArrayList<RouteDevice>()
    for (device in manager.availableCommunicationDevices) {
      val type = displayTypeFor(device.type) ?: continue
      if (!seen.add(device.id)) continue
      result.add(
        RouteDevice(
          id = device.id.toString(),
          name = deviceName(device),
          type = type,
          selected = selectedId != null && device.id == selectedId,
        )
      )
    }

    // Guarantee a speaker entry so the picker is never empty.
    if (result.none { it.type == ROUTE_SPEAKER }) {
      result.add(0, RouteDevice(ROUTE_SPEAKER, "Speaker", ROUTE_SPEAKER, false))
    }

    // When the system hasn't pinned a communication device yet, reflect the
    // current route so exactly one entry is marked selected.
    if (result.none { it.selected }) {
      val active = currentRoute()
      val idx = result.indexOfFirst { it.type == active }
        .let { if (it >= 0) it else result.indexOfFirst { d -> d.type == ROUTE_SPEAKER } }
      if (idx >= 0) result[idx] = result[idx].copy(selected = true)
    }
    return result
  }

  private fun availableDevicesLegacy(manager: AudioManager): List<RouteDevice> {
    val active = currentRoute()
    val result = ArrayList<RouteDevice>()
    result.add(RouteDevice(ROUTE_SPEAKER, "Speaker", ROUTE_SPEAKER, active == ROUTE_SPEAKER))
    result.add(RouteDevice(ROUTE_EARPIECE, "Earpiece", ROUTE_EARPIECE, active == ROUTE_EARPIECE))

    var hasWired = false
    var hasBluetooth = false
    for (device in manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
      when (device.type) {
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE -> hasWired = true
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> hasBluetooth = true
      }
    }
    if (hasWired) {
      result.add(RouteDevice(ROUTE_WIRED, "Wired headset", ROUTE_WIRED, active == ROUTE_WIRED))
    }
    if (hasBluetooth) {
      result.add(RouteDevice(ROUTE_BLUETOOTH, "Bluetooth", ROUTE_BLUETOOTH, active == ROUTE_BLUETOOTH))
    }
    return result
  }

  /** Human-readable label for a device, with friendly built-in names. */
  private fun deviceName(device: AudioDeviceInfo): String = when (device.type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Earpiece"
    else -> device.productName?.toString()?.trim()?.takeIf { it.isNotEmpty() }
      ?: defaultNameForType(device.type)
  }

  private fun defaultNameForType(type: Int): String = when (displayTypeFor(type)) {
    ROUTE_BLUETOOTH -> "Bluetooth"
    ROUTE_WIRED -> "Wired headset"
    ROUTE_EARPIECE -> "Earpiece"
    else -> "Speaker"
  }

  /**
   * Strict device-type mapper for enumeration: returns null for types we don't
   * surface as selectable outputs (unlike [mapDeviceType], which defaults to
   * speaker for the coarse `currentRoute()` read).
   */
  private fun displayTypeFor(type: Int): String? = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> ROUTE_SPEAKER
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> ROUTE_EARPIECE
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_BLE_HEADSET -> ROUTE_BLUETOOTH
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE -> ROUTE_WIRED
    else -> null
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

/**
 * A single selectable output device surfaced to JS. [id] is an
 * [AudioDeviceInfo.id] on API 31+ and a coarse route keyword on older releases;
 * pass it back to [AudioRouteManager.selectDevice].
 */
internal data class RouteDevice(
  val id: String,
  val name: String,
  val type: String,
  val selected: Boolean,
)
