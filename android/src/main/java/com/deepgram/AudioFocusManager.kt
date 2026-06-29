package com.deepgram

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.util.Log

/**
 * Owns system audio-focus arbitration for the Deepgram module.
 *
 * Focus is requested with `AUDIOFOCUS_GAIN_TRANSIENT` so other audio apps
 * (Spotify, podcasts, navigation, etc.) pause/duck and then automatically
 * resume when we abandon focus. Focus-change events are forwarded to the owner
 * through [Listener] so it can stop/pause the right audio components.
 */
internal class AudioFocusManager(
  private val context: Context,
  private val handler: Handler,
  private val listener: Listener,
) {
  /** Routes system focus transitions back to the owning module. */
  interface Listener {
    /** Permanent loss (another app took focus): tear everything down. */
    fun onFocusLostPermanently()

    /** Transient loss (e.g. incoming call): pause playback but keep state. */
    fun onFocusLostTransiently()

    /** Focus regained: resume playback if it was active. */
    fun onFocusGained()
  }

  @Volatile
  var hasFocus: Boolean = false
    private set

  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null

  private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    when (focusChange) {
      AudioManager.AUDIOFOCUS_LOSS -> {
        Log.i(TAG, "AUDIOFOCUS_LOSS — stopping Deepgram audio")
        hasFocus = false
        listener.onFocusLostPermanently()
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
        Log.i(TAG, "AUDIOFOCUS_LOSS_TRANSIENT — pausing playback")
        listener.onFocusLostTransiently()
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        Log.i(TAG, "AUDIOFOCUS_GAIN — resuming playback if active")
        hasFocus = true
        listener.onFocusGained()
      }
    }
  }

  fun requestFocus(): Boolean {
    if (hasFocus) return true
    try {
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: return false
      audioManager = manager

      val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .setOnAudioFocusChangeListener(focusChangeListener, handler)
          .setWillPauseWhenDucked(true)
          .build()
        audioFocusRequest = request
        manager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        manager.requestAudioFocus(
          focusChangeListener,
          AudioManager.STREAM_VOICE_CALL,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        )
      }

      hasFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!hasFocus) {
        Log.w(TAG, "Audio focus request not granted (result=$result)")
      }
      return hasFocus
    } catch (e: Exception) {
      Log.w(TAG, "requestAudioFocus error", e)
      hasFocus = false
      return false
    }
  }

  fun abandonFocus() {
    if (!hasFocus) return
    try {
      val manager = audioManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        manager.abandonAudioFocus(focusChangeListener)
      }
    } catch (e: Exception) {
      Log.w(TAG, "abandonAudioFocus error", e)
    } finally {
      hasFocus = false
      audioFocusRequest = null
    }
  }

  companion object {
    private const val TAG = "DeepgramFocus"
  }
}
