# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 3.0.0

### Breaking

- **New Architecture only.** The native module is now a TurboModule generated
  from `src/NativeDeepgram.ts` (iOS `NativeDeepgramSpec`, Android
  `NativeDeepgramSpec`); the legacy bridge is no longer supported.
- **Minimum versions:** React 19, React Native 0.80 (needed for
  `CodegenTypes.EventEmitter` in the spec).
- **ESM-only build.** The CommonJS output (`lib/commonjs`) is gone; the package
  ships `lib/module` plus types and a `react-native-deepgram-source` export
  condition.
- **Unified native events.** The per-platform `DeepgramAudioPCM`/`AudioChunk`,
  `DeepgramAudioLevel`/`AudioLevel`, `DeepgramRouteChange` and
  `DeepgramInterruption` device events are replaced by typed TurboModule
  emitters (`Deepgram.onAudioPCM`, `onAudioLevel`, `onAudioRouteChange`,
  `onAudioInterruption`). `addAudioRouteChangeListener` and
  `addInterruptionListener` keep working unchanged.
- The separate iOS `MicPermission` native module is removed; use
  `Deepgram.requestRecordPermission()`.
- `Deepgram.stopPlayer()` now returns a `Promise<void>`.
- Removed the deprecated `diarize` boolean from `DeepgramLiveListenOptions`
  and `DeepgramPrerecordedOptions` (Deepgram deprecated it, and requests that
  set both are rejected). Use `diarizeModel: 'latest'`.
- Text-to-speech: removed the deprecated top-level
  `UseDeepgramTextToSpeechOptions` shortcuts (`model`, `encoding`,
  `sampleRate`, `bitRate`, `speed`, `tag`, `container`, `format`, `callback`,
  `callbackMethod`, `mipOptOut`); use `options.http` / `options.stream`. Also
  removed `http.format`, the `DeepgramTextToSpeechEncoding` alias and the
  legacy `{ type: 'Text' }` stream message (send `Speak`).
- `DeepgramTextToSpeechStreamFlushedMessage.sequence_id` is optional (Flux
  sends `speech_id` instead).
- Voice Agent: removed the deprecated `agent.language` setting type (use
  `agent.listen.provider.language`; Deepgram voices take the language from
  the model name). `createAgentSettings({ language })` now sets the listen
  provider language. `injectAgentMessage`'s second argument is typed as
  `DeepgramVoiceAgentInjectBehavior` (or an options object).

### Added

- **Speech-to-text `configure()`** updates keyterms and numerals (Nova-3 and
  Flux) or Flux end-of-turn thresholds and language hints mid-stream, and
  **`forceEndTurn()`** closes a Flux turn on demand.
- `onTurnInfo` (every Flux `TurnInfo`, including `StartOfTurn`,
  `EagerEndOfTurn` and `TurnResumed`) and `onMessage` (every live JSON
  message, e.g. `ConfigureSuccess` / `Warning`) callbacks, plus the
  `DeepgramFluxTurnInfo`, `DeepgramLiveConfigureOptions` and
  `DeepgramListenServerMessage` types.
- Flux streams forward `numerals` and `redact`; `languageHint` now also works
  for Nova-3 multilingual (`language: 'multi'`), live and pre-recorded.
- `nova-3-pharma` model and the `aggressive_numbers` redaction type.
- **Flux TTS.** `flux-*` voices stream from `/v2/speak` and synthesize via
  the v2 REST endpoint. New `interrupt({ playbackOffsetMs })` (stops local
  playback, cancels the turn and drops in-flight audio) and
  `configureStream({ speed })`, `expressivity` and stream `tag` options, and
  `onSpeechStarted` / `onSpeechMetadata` / `onSpeechInterrupted` /
  `onStreamMessage` callbacks. On Flux `clearStream()` interrupts and
  `sendText()` keeps whitespace so streamed LLM tokens join correctly.
- Model types list the Flux TTS English voices (any `flux-*` voice is
  accepted) and the Aura-2 German, French, Dutch, Italian, Japanese and new
  Spanish voices.
- **Voice Agent:** `forceEndTurn()`, `updateThinkLive()`, dynamic and
  `'interrupt'` agent-message injection, and `onLatencyReport`,
  `onFunctionCallCancelled`, `onFrustrationDetected`, `onThinkLiveUpdated`
  and `onCustomFromThinkProvider` callbacks. Settings types cover listen
  providers v1/v2 (`language`), speak providers (`version`, `speed`,
  `expressivity`, fallback arrays), `think_live`, function `defer_until_eot`,
  think `reasoning_mode` / `version`, `thought_signature`, the new
  `ConversationText` language fields, and `agent` as a stored agent
  configuration id (kept as-is across `Update*` calls and reconnects).
- `createAgentSettings` gains `speakModel` and builds Flux-correct providers
  (`version: 'v2'`, no `smart_format`) for `flux-*` models.

### Changed

- Toolchain: Yarn 4, TypeScript 6, Jest 30, react-native-builder-bob 0.44,
  Turbo 2, release-it 21, lefthook 2 (pre-commit hooks re-enabled).
- Android `build.gradle` follows the current library template (AGP/Kotlin come
  from the app; `compileSdk` 36).
- Example app on Expo SDK 58 / React Native 0.88, using the library
  template's monorepo Metro/Babel setup (no more `postinstall` symlink),
  the new `expo-file-system` API and `react-native-safe-area-context`.
- CI builds the example app for Android and iOS.
- The speech-to-text, text-to-speech and Voice Agent hooks share one
  socket/reconnect, KeepAlive, session-stats and PCM pipeline (`src/internal`)
  instead of three copies; the hooks shrank from 1067/748/1551 to
  570/415/698 lines.
- `UseDeepgramVoiceAgentProps` / `UseDeepgramVoiceAgentReturn` are now part of
  the exported types.

### Fixed

- `Deepgram.stopRecording()` resolves `null` on both platforms when no file
  was recorded (iOS previously resolved `undefined`).
- Stopping/disconnecting while the auth token is still resolving no longer
  opens a socket afterwards (all streaming hooks); events from superseded
  connections are ignored.
- `startListening()` / `startStreaming()` close a still-running session first
  instead of leaking it, and stop the recorder if the session was stopped
  while it was starting.
- Voice Agent: muting during an interruption no longer runs two KeepAlive
  timers; `disconnect()` reports `connectionState: 'disconnected'` right away;
  `agent.speak` provider arrays are no longer turned into objects when
  settings are copied.
- Speech-to-text: an error status is no longer overwritten with `idle` when the
  socket closes afterwards; socket construction failures reach `onError`.
- `stats.bytesSent` counts the exact decoded frame size; odd-length PCM frames
  no longer throw; typed-array views passed to `sendMedia` / audio playback
  respect their byte offset.
- Native build warnings (unused iOS simulator variables, Android
  `Notification.Builder` deprecation).

## [2.4.0] - 2026-07-08

### Added

- **Caption export helpers.** New `toSRT()` and `toWebVTT()` exports that
  convert a Deepgram pre-recorded transcription response (word timings, or
  utterances when `utterances=true`) into SubRip / WebVTT subtitle text.
  Cue segmentation is tunable via `CaptionOptions` (`lineLength`, `lineCount`,
  `speakerLabels` for diarized `Speaker N:` prefixes). Pure functions — no
  network or native calls.
- **Speaker-attributed transcripts.** New `toSpeakerSegments()` export that
  folds a diarized (`diarize=true`) response into ordered
  `SpeakerSegment { speaker, text, start, end, confidence }` chunks, merging
  consecutive words from the same speaker. Returns `[]` for non-diarized
  responses instead of throwing.
- **Session telemetry.** `useDeepgramSpeechToText` and `useDeepgramVoiceAgent`
  now expose a `getStats()` method returning a `SessionStats` snapshot
  (`bytesSent`, `bytesReceived`, `framesDropped`, `reconnects`,
  `connectedAtMs`, `firstResultMs`). An opt-in `trackStats` prop additionally
  enables a reactive `stats` return value, throttled to at most one update per
  second so it never floods renders.
- **Voice Agent barge-in.** Opt-in `bargeIn` prop on `useDeepgramVoiceAgent`
  flushes the native playback queue when the server reports
  `UserStartedSpeaking` while agent audio is playing, so the agent audibly
  stops when the user talks over it. Fires the new `onBargeIn` callback only
  when a flush actually happened; never flushes while muted, and the streaming
  player resumes seamlessly on the agent's next turn. Reliable barge-in
  depends on hardware echo cancellation — test on a physical device.

All additions are backwards compatible and opt-in; no breaking changes.

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
- **iOS privacy manifest.** The pod now ships a `PrivacyInfo.xcprivacy`
  declaring audio-data collection (App Functionality, not linked to identity,
  no tracking) and its required-reason API usage
  (`NSProcessInfo.systemUptime`, reason `35F9.1`), bundled via the podspec's
  `resource_bundles` so Xcode's privacy-report aggregation picks it up
  automatically.
- **Customizable foreground-service notification (Android).** The keep-alive
  notification can now be branded via the Expo plugin's new
  `androidNotification` option (`title`, `text`, `channelName`, `icon`) or
  `com.deepgram.notification.*` `<meta-data>` manifest entries on bare React
  Native. Defaults are now sane without configuration: the title falls back to
  the app's label, the small icon to the app's launcher icon, and tapping the
  notification opens the app.
- **Audio interruption events.** New `addInterruptionListener()` export (plus
  an `onInterruption` callback on the speech-to-text, voice-agent, and
  text-to-speech hooks) surfaces system audio interruptions to JS via the new
  shared `DeepgramInterruption` native event: `began` (phone call / audio-focus
  loss), `ended` (with the system's `shouldResume` hint), and `stopped`
  (Android permanent focus loss tore the session down). Exposes the
  `DeepgramInterruptionEvent` type.
- **Interruption-proof live sessions.** While a phone call, Siri, or another
  app holds the audio hardware, the STT and Voice Agent hooks now keep the
  Deepgram socket warm with `KeepAlive` frames (previously the idle socket was
  closed server-side after ~10 s with `NET-0001` and the session died with a
  reconnect error), resume streaming when the interruption ends, and end
  gracefully — `onEnd`/`onClose` instead of an error — when Android tears the
  session down on permanent focus loss. On iOS, capture/playback now also
  recovers when the system never posts an interruption-ended notification
  (common with Siri): the module re-runs its retrying resume when the app
  becomes active again and ignores stale “was suspended” interruption
  notifications.

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
