# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-06-25

### Added

- **Live `measurements` option.** `DeepgramLiveListenOptions` now supports the
  `measurements` flag, mirroring the existing prerecorded option. When enabled it
  is serialized into the live/streaming query (`measurements=true`) for both the
  v1 and v2 (Flux) realtime paths, converting spoken measurements into
  abbreviated forms during live transcription.

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
