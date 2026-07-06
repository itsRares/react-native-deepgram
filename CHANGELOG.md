# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-07-06

### Added

- **Audio output routing.** New `setAudioRoute()`, `getAudioRoute()`, and
  `addAudioRouteChangeListener()` exports for steering playback between the
  loudspeaker, earpiece, and Bluetooth headsets, plus observing route changes
  made outside the app (Control Center, plugging in headphones, …). Requestable
  routes are `'speaker' | 'earpiece' | 'bluetooth' | 'auto'`; the active route
  additionally reports `'wired'`. Routing is best-effort: the OS keeps the
  final say (a wired headset always wins), `bluetooth` engages once a headset
  is actually connected (the request is remembered and applied when one
  appears), and external switches are adopted — surfaced via the
  `DeepgramRouteChange` event — rather than fought. During echo-cancelled
  (`enableVoiceProcessing`) sessions Bluetooth is opt-in, since HFP's loopback
  defeats hardware AEC. Backed by a new `AudioRouteManager` on Android and an
  extended audio-session layer on iOS. Exposes `DeepgramAudioRoute` /
  `DeepgramActiveAudioRoute` types and an `AudioRouteSubscription` handle.
- **Example app.** The Voice Agent screen now includes an audio-route picker
  demonstrating the new routing API.

### Changed

- **Android foreground-service permissions are now opt-in.** The library
  manifest no longer force-merges `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MICROPHONE`, or `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and
  the bundled `DeepgramAudioService` no longer hardcodes
  `android:foregroundServiceType`. Google Play requires every app that declares
  a foreground-service type to justify it (with a demo video) in the Play
  Console — apps that don't use background audio couldn't. Now only apps that
  opt in carry the declarations:
  - **Expo** — the config plugin adds the permissions **and** the service's
    `foregroundServiceType="microphone|mediaPlayback"` when `backgroundAudio`
    is enabled (still the default).
  - **Bare React Native** — apps that keep audio alive in the background must
    add the permissions and a `<service>` override to their own
    `AndroidManifest.xml`; see the README's "Background audio" section.
    **Action required** if you relied on the previously auto-merged entries.
  - At runtime the module checks which permissions the host app actually
    declared: without them the keep-alive service is skipped gracefully
    (foreground audio is unaffected), and on Android 14+ the microphone
    service type is only advertised when `FOREGROUND_SERVICE_MICROPHONE` is
    declared, so playback-only apps degrade cleanly instead of crashing.
- The library manifest now ships `MODIFY_AUDIO_SETTINGS` (and legacy
  `BLUETOOTH`, API ≤ 30) — normal, non-reviewed permissions needed by the new
  audio-routing API.

### Fixed

- **Expo plugin `backgroundAudio: false` now actually works on Android.**
  Previously the option skipped adding the foreground-service permissions, but
  manifest merging pulled them in from the library manifest anyway, so every
  app still shipped them.

## [2.2.0] - 2026-06-25

### Added

- **Recording to file.** `useDeepgramSpeechToText` now supports `recordToFile`
  option to persist microphone audio to a WAV file while simultaneously streaming
  to Deepgram. The resulting `file://` URI is delivered via `onRecordingComplete`
  callback and `recordingUri` state property once `stopListening` completes.
  Recording format is uncompressed WAV (16 kHz PCM16 mono), mirroring the audio
  streamed to Deepgram.
- **Audio-level metering.** Added microphone audio-level (RMS amplitude 0..1)
  support via `metering` configuration in `useDeepgramSpeechToText`. When enabled,
  the native module emits normalized audio levels at configurable intervals,
  surfaced through `audioLevel` state and `onAudioLevel` callback. Useful for
  implementing visual feedback like waveforms or voice activity indicators.
- **Auto-reconnect for live streaming.** Introduced `DeepgramReconnectOptions` for
  automatic reconnection on unexpected socket close in Speech-to-Text and Voice
  Agent. Configure max retries, initial/max backoff delays via `reconnect` prop.
  Includes `onReconnecting` and `onReconnected` callbacks for monitoring reconnect
  attempts.
- **Pause/resume streaming.** `useDeepgramSpeechToText` now exposes `pause()` and
  `resume()` methods to temporarily stop forwarding microphone frames without
  tearing down the WebSocket. Sends `Finalize` once (v1) to flush buffered audio
  and starts periodic `KeepAlive` to maintain the connection during pause. State
  tracked via `isPaused` property when `trackState` is enabled.
- **Mute/unmute for Voice Agent.** `useDeepgramVoiceAgent` now supports
  `setMuted(boolean)` to control microphone input while maintaining an active
  session. Keep-alive messages are sent while muted to prevent timeout.
- **Text-to-Speech `synthesizeToBytes` method.** Added method to fetch synthesized
  audio as raw bytes (`ArrayBuffer`) with MIME type without automatically playing
  it, enabling audio caching/persistence. Results are cached in-memory (LRU) keyed
  by text + format to avoid duplicate network requests for identical prompts.
  Accepts optional per-call `options` to override HTTP format.
- **Token-based authentication.** Introduced global `__DEEPGRAM_GET_TOKEN__`
  function alongside existing `__DEEPGRAM_API_KEY__` for dynamic token
  provisioning. The SDK automatically caches tokens with TTL-aware refresh and
  deduplicates concurrent token requests. New `clearCachedAuthToken()` helper
  forces fresh token retrieval. See `src/helpers/auth.ts`.
- **Audio device enumeration and selection.** Added `getAudioDevices()` and
  `selectAudioDevice(deviceId)` methods for managing audio output devices,
  including Bluetooth headsets and built-in options. Event listeners notify of
  audio device changes. Requires Bluetooth permissions on Android 12+.
  _(Note: audio route management methods were later removed in a refactor.)_
- **Structured error handling.** Introduced `DeepgramError` class with typed
  `DeepgramErrorCode` for consistent error handling across all hooks. Native
  rejections now use stable error codes (`permission_denied`, `init_failed`,
  `start_error`, `stop_error`, `audio_start_error`, `audio_stop_error`,
  `stop_player_error`, `invalid_data`, `playback_error`) so consumers can branch
  programmatically instead of string-matching messages.
- **Configuration overrides.** New `configure()` function accepts `baseUrl`,
  `websocketUrl`, and `agentUrl` overrides for custom endpoints or proxying.
  Hooks dynamically resolve URLs based on configuration.
- **Live `measurements` option.** `DeepgramLiveListenOptions` now supports the
  `measurements` flag, mirroring the existing prerecorded option. When enabled it
  is serialized into the live/streaming query (`measurements=true`) for both the
  v1 and v2 (Flux) realtime paths, converting spoken measurements into
  abbreviated forms during live transcription.
- **iOS audio session management.** Comprehensive audio session lifecycle
  management including activation, deactivation, configuration for recording and
  playback, handling for audio route changes, media services resets, and audio
  interruptions. Enhanced playback with AVAudioPlayerNode for TTS and Voice Agent
  with echo cancellation support when voice processing is enabled.

### Fixed

- **Packaging — stop leaking the example app / self-referential symlink to
  consumers.** The `postinstall` script unconditionally created
  `example/node_modules/react-native-deepgram -> ../..`, a self-referential
  symlink. Because npm always omits `node_modules` from tarballs, this symlink
  reached consumers via the dependency's own `postinstall` running on install,
  causing `patch-package` — and any tool that walks the package directory
  recursively — to follow it infinitely and crash with `ENAMETOOLONG`. The
  script is now guarded to run only during local development of this repo (when
  the example app is present) and is a no-op when installed as a dependency. An
  `.npmignore` backstop was added alongside the existing `files` allowlist so the
  example app can never be published.
- **iOS — crash-safe audio session deactivation.** `deactivateAudioSession` now
  returns early when the session was never configured, wraps `setActive:NO` in a
  `@try/@catch`, and downgrades expected deactivation failures (competing audio
  routes from expo-av, CallKit, or Bluetooth changes) from an error to a warning,
  preventing noisy logs and potential exceptions during route transitions.

[2.2.0]: https://github.com/itsRares/react-native-deepgram/compare/v2.1.0...v2.2.0
