package com.deepgram

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

class DeepgramAudioService : Service() {
  companion object {
    private const val TAG = "DeepgramAudioService"
    private const val CHANNEL_ID = "deepgram_audio_channel"
    private const val CHANNEL_NAME = "Deepgram Audio"
    private const val NOTIFICATION_ID = 43123
    private const val EXTRA_WITH_MICROPHONE = "with_microphone"

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

    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW
    )
    channel.description = "Keeps Deepgram audio capture and playback active"
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Deepgram Audio Active")
      .setContentText("Recording or playback is running")
      .setSmallIcon(android.R.drawable.stat_sys_speakerphone)
      .setOngoing(true)
      .build()
  }
}
