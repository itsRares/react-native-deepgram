package com.deepgram

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

class DeepgramAudioService : Service() {
  companion object {
    private const val TAG = "DeepgramAudioService"
    private const val CHANNEL_ID = "deepgram_audio_channel"
    private const val NOTIFICATION_ID = 43123
    private const val EXTRA_WITH_MICROPHONE = "with_microphone"

    // Optional <meta-data> keys (merged manifest) for customizing the
    // keep-alive notification. Set by the Expo plugin's `androidNotification`
    // option, or manually by bare RN apps.
    private const val META_TITLE = "com.deepgram.notification.TITLE"
    private const val META_TEXT = "com.deepgram.notification.TEXT"
    private const val META_CHANNEL_NAME = "com.deepgram.notification.CHANNEL_NAME"
    private const val META_ICON = "com.deepgram.notification.ICON"

    private const val PERMISSION_FGS = "android.permission.FOREGROUND_SERVICE"
    private const val PERMISSION_FGS_MICROPHONE =
      "android.permission.FOREGROUND_SERVICE_MICROPHONE"
    private const val PERMISSION_FGS_MEDIA_PLAYBACK =
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"

    /**
     * True when [permission] is declared (`<uses-permission>`) in the host
     * app's merged manifest. The FGS permissions are install-time permissions,
     * so a declared permission is a granted one.
     */
    internal fun isPermissionDeclared(context: Context, permission: String): Boolean {
      return try {
        val info = context.packageManager.getPackageInfo(
          context.packageName,
          android.content.pm.PackageManager.GET_PERMISSIONS
        )
        info.requestedPermissions?.contains(permission) == true
      } catch (e: Exception) {
        Log.w(TAG, "Unable to read declared permissions", e)
        false
      }
    }

    /**
     * The keep-alive service is opt-in: apps that don't need background audio
     * don't declare the FOREGROUND_SERVICE* permissions (so they never have to
     * justify them in the Play Console). When they're absent we skip the
     * service entirely — audio keeps working while the app is foregrounded.
     */
    private fun canStartForegroundService(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return true
      if (!isPermissionDeclared(context, PERMISSION_FGS)) return false
      if (Build.VERSION.SDK_INT >= 34 &&
        !isPermissionDeclared(context, PERMISSION_FGS_MEDIA_PLAYBACK)
      ) {
        return false
      }
      return true
    }

    fun start(context: Context, withMicrophone: Boolean) {
      if (!canStartForegroundService(context)) {
        Log.i(
          TAG,
          "Foreground-service permissions not declared; skipping keep-alive " +
            "service (audio continues while the app is in the foreground). " +
            "Enable background audio via the Expo plugin or manifest additions " +
            "if you need it."
        )
        return
      }
      val intent = Intent(context, DeepgramAudioService::class.java)
      intent.putExtra(EXTRA_WITH_MICROPHONE, withMicrophone)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, DeepgramAudioService::class.java)
      context.stopService(intent)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannelIfNeeded()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val withMicrophone = intent?.getBooleanExtra(EXTRA_WITH_MICROPHONE, false) ?: false
    val notification = buildNotification()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Always allow media playback; only advertise the microphone type when
        // we are actually capturing. Declaring FOREGROUND_SERVICE_TYPE_MICROPHONE
        // for a playback-only session throws a SecurityException on Android 14+
        // when the RECORD_AUDIO permission has not been granted. On Android 14+
        // the type also requires the FOREGROUND_SERVICE_MICROPHONE permission,
        // which is opt-in — degrade to playback-only when it's absent.
        var serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (withMicrophone &&
          (Build.VERSION.SDK_INT < 34 ||
            isPermissionDeclared(this, PERMISSION_FGS_MICROPHONE))
        ) {
          serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        startForeground(NOTIFICATION_ID, notification, serviceType)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // e.g. a missing-permission or background-start restriction. Don't crash
      // the host app over the keep-alive notification — just bail out cleanly.
      Log.w(TAG, "startForeground failed", e)
      stopSelf()
      return START_NOT_STICKY
    }

    return START_STICKY
  }

  private fun createNotificationChannelIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return

    // setName on an existing channel is an allowed rename, so a config change
    // takes effect without reinstalling.
    val channel = NotificationChannel(
      CHANNEL_ID,
      notificationMeta(META_CHANNEL_NAME) ?: notificationTitle(),
      NotificationManager.IMPORTANCE_LOW
    )
    channel.description = "Keeps audio capture and playback active"
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }

    builder
      .setContentTitle(notificationTitle())
      .setContentText(notificationMeta(META_TEXT) ?: "Audio is running")
      .setSmallIcon(notificationIcon())
      .setOngoing(true)

    contentIntent()?.let { builder.setContentIntent(it) }

    return builder.build()
  }

  /** Custom title from meta-data, falling back to the host app's label. */
  private fun notificationTitle(): String {
    notificationMeta(META_TITLE)?.let { return it }
    return try {
      packageManager.getApplicationLabel(applicationInfo).toString()
    } catch (_: Exception) {
      "Audio active"
    }
  }

  /**
   * Custom small icon: a drawable/mipmap resource named by META_ICON, else the
   * app's launcher icon, else the previous system speakerphone icon. Never
   * throws — a bad icon name must not take down the keep-alive service.
   */
  private fun notificationIcon(): Int {
    notificationMeta(META_ICON)?.let { name ->
      for (type in arrayOf("drawable", "mipmap")) {
        @Suppress("DiscouragedApi")
        val id = resources.getIdentifier(name, type, packageName)
        if (id != 0) return id
      }
      Log.w(TAG, "Notification icon resource '$name' not found; falling back")
    }
    if (applicationInfo.icon != 0) return applicationInfo.icon
    return android.R.drawable.stat_sys_speakerphone
  }

  /** Tap-to-open: launch intent for the host app, when it has one. */
  private fun contentIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.setPackage(null)
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * Read a notification meta-data value from the merged manifest's
   * `<application>` element. Supports both literal strings (`android:value`)
   * and string resources (`android:resource`) for localization.
   */
  private fun notificationMeta(key: String): String? {
    return try {
      val info = packageManager.getApplicationInfo(
        packageName,
        PackageManager.GET_META_DATA
      )
      val meta = info.metaData ?: return null
      val resId = meta.getInt(key, 0)
      if (resId != 0) return getString(resId)
      meta.getString(key)?.takeIf { it.isNotBlank() }
    } catch (e: Exception) {
      Log.w(TAG, "Unable to read notification meta-data '$key'", e)
      null
    }
  }
}
