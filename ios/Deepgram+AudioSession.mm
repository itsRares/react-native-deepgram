#import "Deepgram+AudioSession.h"
#import "Deepgram+Private.h"
#import "Deepgram+Recording.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>

/**
 * Audio-session lifecycle for the Deepgram module: activation/deactivation, the
 * category fallback ladder (which is highly sensitive to OSStatus -50), and the
 * route-change / interruption / media-services-reset notification handlers.
 */
@implementation Deepgram (AudioSession)

- (BOOL)activateAudioSession:(NSError **)outError {
  DGLogDebug(@"[Deepgram] activateAudioSession: begin (configured=%@)",
             self.audioSessionConfigured ? @"YES" : @"NO");
  __block BOOL success = YES;
  __block NSError *activationError = nil;

  DGLogDebug(@"[Deepgram] activateAudioSession: configuring on current queue");
  success = [self configureAudioSessionIfNeeded:&activationError];

  if (!success && activationError) {
    DGLogError(@"[Deepgram] Failed to activate audio session: %@",
               activationError.localizedDescription ?: activationError);
  } else {
    DGLogDebug(@"[Deepgram] activateAudioSession: success=%@",
               success ? @"YES" : @"NO");
  }

  if (success) {
    // Session is ours again — clear a stale interruption flag (Apple doesn't
    // guarantee an Ended notification for apps that were suspended).
    self.sessionInterrupted = NO;
  }

  if (outError) {
    *outError = activationError;
  }

  return success;
}

- (void)deactivateAudioSession {
  DGLogDebug(@"[Deepgram] deactivateAudioSession: begin");
  if (!self.audioSessionConfigured) {
    DGLogDebug(@"[Deepgram] deactivateAudioSession: skipped (not configured)");
    return;
  }

  NSError *error = nil;
  // Use NotifyOthersOnDeactivation so other audio sessions (expo-av, etc.)
  // know they can resume.
  BOOL success = NO;
  @try {
    success = [[AVAudioSession sharedInstance]
                  setActive:NO
                withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                      error:&error];
  }
  @catch (NSException *e) {
    DGLogWarn(@"[Deepgram] deactivateAudioSession threw exception: %@",
              e.reason ?: e);
    self.audioSessionConfigured = NO;
    return;
  }

  if (!success && error) {
    // Deactivation can legitimately fail during competing audio-route
    // transitions; treat as a warning rather than an error.
    DGLogWarn(@"[Deepgram] Failed to deactivate audio session: %@",
              error.localizedDescription ?: error);
  }
  self.audioSessionConfigured = NO;
}

- (BOOL)configureAudioSessionIfNeeded:(NSError **)outError
{
  BOOL needsMic = _recordState.isRunning || self.audioQueueCaptureRequested ||
                  self.engineCaptureActive || self.voiceProcessingRequested;
  AVAudioSession *session = [AVAudioSession sharedInstance];

  if (self.audioSessionConfigured) {
    BOOL isCurrentlyPlayAndRecord = [session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord];
    if (isCurrentlyPlayAndRecord == needsMic) {
      DGLogDebug(@"[Deepgram] configureAudioSessionIfNeeded: already configured correctly, ensuring active");
      NSError *activeError = nil;
      BOOL success = [[AVAudioSession sharedInstance] setActive:YES error:&activeError];
      if (success && !activeError) {
        return YES;
      }
    }
  }

  DGLogDebug(@"[Deepgram] configureAudioSessionIfNeeded: configuring (needsMic=%@)", needsMic ? @"YES" : @"NO");
  return [self configureAudioSession:outError];
}

- (BOOL)configureAudioSession:(NSError **)outError {
  BOOL needsMic = _recordState.isRunning || self.audioQueueCaptureRequested ||
                  self.engineCaptureActive || self.voiceProcessingRequested;
  return [self configureAudioSessionForRecording:needsMic error:outError];
}

/**
 * Bluetooth HFP input option: iOS 17 renamed `AllowBluetooth` to
 * `AllowBluetoothHFP`; fall back to the legacy symbol on older toolchains.
 */
- (AVAudioSessionCategoryOptions)bluetoothHFPOption {
#if defined(__IPHONE_17_0) && (__IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_17_0)
  if (@available(iOS 17.0, *)) {
    return AVAudioSessionCategoryOptionAllowBluetoothHFP;
  }
#endif
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return AVAudioSessionCategoryOptionAllowBluetooth;
#pragma clang diagnostic pop
}

/**
 * Apply one category/mode/options tuple and activate the session. On failure
 * populates `outError` so the caller can fall back to a simpler configuration.
 */
- (BOOL)applyAudioSessionCategory:(AVAudioSessionCategory)category
                             mode:(NSString *)mode
                          options:(AVAudioSessionCategoryOptions)options
                            error:(NSError **)outError {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  DGLogDebug(@"[Deepgram] configureAudioSession: setCategory %@ mode %@ "
             @"options 0x%lx",
             category, mode, (unsigned long)options);

  if (![session setCategory:category
                       mode:mode
                    options:options
                      error:&error] ||
      error) {
    DGLogError(@"[Deepgram] configureAudioSession: category failed error=%@",
               error.localizedDescription ?: error);
    if (outError) {
      *outError = error;
    }
    return NO;
  }

  NSError *activeError = nil;
  if (![session setActive:YES error:&activeError]) {
    DGLogError(@"[Deepgram] configureAudioSession: setActive failed error=%@",
               activeError.localizedDescription ?: activeError);
    if (outError) {
      *outError = activeError;
    }
    return NO;
  }

  return YES;
}

/**
 * Configure the audio session, attempting configurations from most- to
 * least-capable so audio still works instead of hard-failing.
 *
 * Ordering rules — violations fail setCategory with OSStatus -50, leaving the
 * session half-configured and failing a later AudioQueueStart:
 *   1. Never mix `DefaultToSpeaker` with `AllowBluetoothA2DP`/`AllowAirPlay`
 *      in a recording configuration (A2DP/AirPlay are output-only; BT input
 *      uses HFP).
 *   2. Try `MixWithOthers` first (coexist with expo-av etc.), then degrade to
 *      exclusive access — Mix can block input acquisition on some routes.
 *
 * VoiceChat mode (hardware AEC / VPIO) only when echo cancellation is needed
 * and only on a device — VPIO on the Simulator guarantees a -50.
 */
- (BOOL)configureAudioSessionForRecording:(BOOL)needsMicrophone
                                    error:(NSError **)outError {
  DGLogDebug(@"[Deepgram] configureAudioSession: begin (mic=%@)",
             needsMicrophone ? @"YES" : @"NO");

  const AVAudioSessionCategoryOptions mixOption =
      AVAudioSessionCategoryOptionMixWithOthers;

  // Route shapes the option set: `bluetooth` adds HFP to the VoiceChat
  // attempts (not added by default — HFP auto-routes onto a connected headset
  // while VPIO's AEC is tuned for built-in hardware; echo guard).
  // `speaker`/`earpiece` drop HFP; `earpiece`/`bluetooth` also drop
  // DefaultToSpeaker (the receiver is unreachable with it set).
  NSString *route = self.requestedAudioRoute;
  BOOL routeWantsBluetooth = [route isEqualToString:@"bluetooth"];
  BOOL routeBlocksBluetooth =
      [route isEqualToString:@"speaker"] || [route isEqualToString:@"earpiece"];

  // Build an ordered list of attempts, best first.
  NSMutableArray<NSDictionary *> *attempts = [NSMutableArray array];

  if (needsMicrophone) {
    BOOL needsAEC = self.engineCaptureActive || self.voiceProcessingRequested ||
                    self.isPlaying;

    // Input-safe options for PlayAndRecord. DefaultToSpeaker + HFP are valid
    // here; A2DP/AirPlay are intentionally excluded (see rule 1 above).
    AVAudioSessionCategoryOptions recordOptions = 0;
    if (route == nil || [route isEqualToString:@"speaker"]) {
      recordOptions |= AVAudioSessionCategoryOptionDefaultToSpeaker;
    }
    if (!routeBlocksBluetooth) {
      recordOptions |= [self bluetoothHFPOption];
    }

#if !TARGET_OS_SIMULATOR
    // Preferred: hardware AEC via VoiceChat (device only). DefaultToSpeaker
    // must NOT be combined with VoiceChat (-50 on some iOS versions); only
    // MixWithOthers/HFP layer safely, with the bare attempts as -50 fallbacks.
    if (needsAEC) {
      if (routeWantsBluetooth) {
        [attempts addObject:@{
          @"category" : AVAudioSessionCategoryPlayAndRecord,
          @"mode" : AVAudioSessionModeVoiceChat,
          @"options" : @(mixOption | [self bluetoothHFPOption]),
        }];
        [attempts addObject:@{
          @"category" : AVAudioSessionCategoryPlayAndRecord,
          @"mode" : AVAudioSessionModeVoiceChat,
          @"options" : @([self bluetoothHFPOption]),
        }];
      }
      [attempts addObject:@{
        @"category" : AVAudioSessionCategoryPlayAndRecord,
        @"mode" : AVAudioSessionModeVoiceChat,
        @"options" : @(mixOption),
      }];
      [attempts addObject:@{
        @"category" : AVAudioSessionCategoryPlayAndRecord,
        @"mode" : AVAudioSessionModeVoiceChat,
        @"options" : @(0),
      }];
    }
#endif

    // PlayAndRecord without VoiceChat (no hardware AEC). Try with MixWithOthers
    // first to coexist with other packages, then exclusively.
    [attempts addObject:@{
      @"category" : AVAudioSessionCategoryPlayAndRecord,
      @"mode" : AVAudioSessionModeDefault,
      @"options" : @(recordOptions | mixOption),
    }];
    [attempts addObject:@{
      @"category" : AVAudioSessionCategoryPlayAndRecord,
      @"mode" : AVAudioSessionModeDefault,
      @"options" : @(recordOptions),
    }];

    // Last resort: bare PlayAndRecord with no options. Always valid.
    [attempts addObject:@{
      @"category" : AVAudioSessionCategoryPlayAndRecord,
      @"mode" : AVAudioSessionModeDefault,
      @"options" : @(0),
    }];
  } else {
    // Playback already supports AirPlay and A2DP routes; the explicit route
    // options are for PlayAndRecord and can be rejected with OSStatus -50.
    AVAudioSessionCategoryOptions playbackOptions = mixOption;
    [attempts addObject:@{
      @"category" : AVAudioSessionCategoryPlayback,
      @"mode" : AVAudioSessionModeDefault,
      @"options" : @(playbackOptions),
    }];

    // Last resort: bare Playback with no options.
    [attempts addObject:@{
      @"category" : AVAudioSessionCategoryPlayback,
      @"mode" : AVAudioSessionModeDefault,
      @"options" : @(0),
    }];
  }

  NSError *lastError = nil;
  NSUInteger attemptIndex = 0;
  for (NSDictionary *attempt in attempts) {
    attemptIndex++;
    NSError *attemptError = nil;
    BOOL success = [self
        applyAudioSessionCategory:attempt[@"category"]
                             mode:attempt[@"mode"]
                          options:(AVAudioSessionCategoryOptions)
                                      [attempt[@"options"] unsignedIntegerValue]
                            error:&attemptError];
    if (success) {
      if (attemptIndex > 1) {
        DGLogDebug(@"[Deepgram] configureAudioSession: succeeded on fallback "
                   @"attempt %lu/%lu",
                   (unsigned long)attemptIndex, (unsigned long)attempts.count);
      }
      self.audioSessionConfigured = YES;
      // Category (re)configuration resets overrides/preferred input — apply
      // the requested route exactly once, here (sub-calls are no-op guarded,
      // so this cannot trigger route-change feedback loops).
      [self applyRequestedRouteToSession];
      DGLogDebug(@"[Deepgram] configureAudioSession: success");
      return YES;
    }
    lastError = attemptError;
    DGLogDebug(@"[Deepgram] configureAudioSession: attempt %lu/%lu failed, "
               @"trying next configuration",
               (unsigned long)attemptIndex, (unsigned long)attempts.count);
  }

  DGLogError(@"[Deepgram] configureAudioSession: all %lu configurations failed; "
             @"last error=%@",
             (unsigned long)attempts.count,
             lastError.localizedDescription ?: lastError);
  if (outError) {
    *outError = lastError;
  }
  self.audioSessionConfigured = NO;
  return NO;
}

- (void)maybeDeactivateAudioSession {
  DGLogDebug(@"[Deepgram] maybeDeactivateAudioSession: running=%@ playing=%@ "
             @"engineCapture=%@",
             _recordState.isRunning ? @"YES" : @"NO",
             self.isPlaying ? @"YES" : @"NO",
             self.engineCaptureActive ? @"YES" : @"NO");
  if (!_recordState.isRunning && !self.isPlaying && !self.engineCaptureActive) {
    DGLogDebug(@"[Deepgram] maybeDeactivateAudioSession: deactivating");
    [self deactivateAudioSession];
  }
}

// MARK: - Audio output routing

/**
 * Map the session's current primary output port to the coarse route keyword
 * surfaced to JS (`speaker` / `earpiece` / `bluetooth` / `wired`).
 */
- (NSString *)currentAudioRouteString {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionPortDescription *output =
      session.currentRoute.outputs.firstObject;
  if (!output) {
    // No active output yet — report the route the session would use.
    return @"speaker";
  }
  AVAudioSessionPort portType = output.portType;
  if ([portType isEqualToString:AVAudioSessionPortBuiltInSpeaker]) {
    return @"speaker";
  }
  if ([portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) {
    return @"earpiece";
  }
  if ([portType isEqualToString:AVAudioSessionPortBluetoothHFP] ||
      [portType isEqualToString:AVAudioSessionPortBluetoothA2DP] ||
      [portType isEqualToString:AVAudioSessionPortBluetoothLE]) {
    return @"bluetooth";
  }
  // Headphones / USB / HDMI / car audio / line-out — wired-style outputs the
  // OS routes to automatically.
  return @"wired";
}

- (void)emitRouteChange {
  if (!self.hasListeners) {
    return;
  }
  NSString *route = [self currentAudioRouteString];
  DGLogDebug(@"[Deepgram] emitRouteChange: %@", route);
  [self sendEventWithName:@"DeepgramRouteChange" body:@{@"route" : route}];
}

/**
 * Prefer a connected Bluetooth HFP input; output follows the negotiated HFP
 * route. Returns YES when an HFP device is engaged (or already was).
 */
- (BOOL)preferBluetoothInputIfAvailable {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  for (AVAudioSessionPortDescription *input in session.availableInputs) {
    if ([input.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
      // Skip when already pinned: a redundant setPreferredInput still posts a
      // route change → reconfigure → feedback loop that stalls playback.
      if ([session.preferredInput.UID isEqualToString:input.UID]) {
        return YES;
      }
      NSError *error = nil;
      if (![session setPreferredInput:input error:&error] || error) {
        DGLogWarn(@"[Deepgram] preferBluetoothInput failed: %@",
                  error.localizedDescription ?: error);
        return NO;
      }
      return YES;
    }
  }
  return NO;
}

/**
 * Release a previously preferred input so the OS resolves the default route
 * again. No-op when none is set.
 */
- (void)clearPreferredInputIfSet {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  if (!session.preferredInput) {
    return;
  }
  NSError *error = nil;
  if (![session setPreferredInput:nil error:&error] || error) {
    DGLogWarn(@"[Deepgram] clearPreferredInput failed: %@",
              error.localizedDescription ?: error);
  }
}

/**
 * Apply `requestedAudioRoute` to the *already configured* session — called
 * exactly once after each successful category configuration (which resets any
 * override). Every sub-call is no-op guarded when the session already matches:
 * redundant `setPreferredInput`/override calls caused route-change storms that
 * stalled the playback engine in the previous implementation.
 */
- (void)applyRequestedRouteToSession {
  NSString *route = self.requestedAudioRoute;
  if (!route.length) {
    return; // auto — leave the system default alone
  }

  AVAudioSession *session = [AVAudioSession sharedInstance];
  BOOL playAndRecord =
      [session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord];
  AVAudioSessionPort currentOutput =
      session.currentRoute.outputs.firstObject.portType;

  if ([route isEqualToString:@"speaker"]) {
    [self clearPreferredInputIfSet];
    // The override moves VoiceChat-mode output from receiver to speaker; only
    // meaningful for PlayAndRecord (Playback already defaults to the speaker).
    if (playAndRecord &&
        ![currentOutput isEqualToString:AVAudioSessionPortBuiltInSpeaker]) {
      NSError *error = nil;
      if (![session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker
                                      error:&error] ||
          error) {
        DGLogWarn(@"[Deepgram] applyRequestedRoute: speaker override failed %@",
                  error.localizedDescription ?: error);
      }
    }
  } else if ([route isEqualToString:@"earpiece"]) {
    [self clearPreferredInputIfSet];
    // Clear any speaker override; without DefaultToSpeaker (guaranteed by the
    // ladder for this route) PlayAndRecord defaults to the receiver.
    if (playAndRecord &&
        [currentOutput isEqualToString:AVAudioSessionPortBuiltInSpeaker]) {
      NSError *error = nil;
      if (![session overrideOutputAudioPort:AVAudioSessionPortOverrideNone
                                      error:&error] ||
          error) {
        DGLogWarn(@"[Deepgram] applyRequestedRoute: earpiece override failed %@",
                  error.localizedDescription ?: error);
      }
    }
  } else if ([route isEqualToString:@"bluetooth"]) {
    if (playAndRecord) {
      // Engage the headset via its HFP input; output follows. Best-effort —
      // with no headset connected the request stays pending (HFP stays allowed
      // in the category, so a later-connecting headset is adopted by the OS).
      if (![self preferBluetoothInputIfAvailable]) {
        DGLogDebug(@"[Deepgram] applyRequestedRoute: no Bluetooth HFP input "
                   @"available (request stays pending)");
      }
    }
    // Playback-only sessions route to A2DP automatically when connected.
  }
}

/**
 * Adopt the *actual* current route as the stored request after an external
 * route change (Control Center switch, headset unplug) so the next
 * reconfiguration preserves — rather than reverts — the user's pick.
 */
- (void)adoptCurrentRouteAsRequest {
  NSString *actual = [self currentAudioRouteString];
  NSString *adopted = nil;
  if ([actual isEqualToString:@"speaker"] ||
      [actual isEqualToString:@"earpiece"] ||
      [actual isEqualToString:@"bluetooth"]) {
    adopted = actual;
  }
  // `wired` (and anything else) is not a requestable route — fall back to
  // auto and let the OS keep managing it.

  NSString *current = self.requestedAudioRoute;
  if ((adopted == nil && current == nil) ||
      (adopted != nil && [adopted isEqualToString:current])) {
    return;
  }
  DGLogDebug(@"[Deepgram] adoptCurrentRouteAsRequest: %@ -> %@",
             current ?: @"auto", adopted ?: @"auto");
  self.requestedAudioRoute = adopted;
}

/**
 * Store and apply a route request from JS. Reconfigures the category only when
 * the route needs different options (HFP allowance / DefaultToSpeaker) — a
 * plain speaker ↔ earpiece flip is a pure output override and must not disturb
 * a running VPIO engine.
 */
- (BOOL)applyAudioRoute:(NSString *)route error:(NSError **)outError {
  NSString *normalized = [route isEqualToString:@"auto"] ? nil : route;
  self.requestedAudioRoute = normalized;
  DGLogDebug(@"[Deepgram] applyAudioRoute: %@", normalized ?: @"auto");

  if (!self.audioSessionConfigured) {
    // Nothing active — applied on the next activation.
    return YES;
  }

  AVAudioSession *session = [AVAudioSession sharedInstance];
  BOOL needsReset = NO;
  if ([session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord]) {
    AVAudioSessionCategoryOptions opts = session.categoryOptions;
    BOOL hfpAllowed = (opts & [self bluetoothHFPOption]) != 0;
    BOOL dtsSet = (opts & AVAudioSessionCategoryOptionDefaultToSpeaker) != 0;
    if ([normalized isEqualToString:@"bluetooth"]) {
      needsReset = !hfpAllowed || dtsSet;
    } else if ([normalized isEqualToString:@"earpiece"]) {
      needsReset = dtsSet || hfpAllowed;
    } else if ([normalized isEqualToString:@"speaker"]) {
      // If HFP is currently allowed, a connected headset must be fully
      // disengaged (the override alone would leave the BT mic as input).
      needsReset = hfpAllowed;
    }
    // auto: keep the running configuration until the next reconfiguration.
  }

  if (needsReset) {
    DGLogDebug(@"[Deepgram] applyAudioRoute: category options mismatch, "
               @"reconfiguring session");
    self.audioSessionConfigured = NO;
    NSError *error = nil;
    if (![self configureAudioSession:&error]) {
      if (outError) {
        *outError = error;
      }
      return NO;
    }
    return YES; // configureAudioSession applied the route post-configure
  }

  [self applyRequestedRouteToSession];
  return YES;
}

- (void)handleAudioRouteChange:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAudioRouteChange: %@", note.userInfo);
  NSNumber *reasonValue = note.userInfo[AVAudioSessionRouteChangeReasonKey];
  AVAudioSessionRouteChangeReason reason =
      reasonValue
          ? (AVAudioSessionRouteChangeReason)reasonValue.unsignedIntegerValue
          : AVAudioSessionRouteChangeReasonUnknown;

  // External route changes (CC switch, device removal) become the new stored
  // request so later reconfigurations preserve the user's pick.
  // NewDeviceAvailable is excluded: a merely-connected headset must not flip
  // the request to `bluetooth` (echo guard).
  if (reason == AVAudioSessionRouteChangeReasonOverride ||
      reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
    [self adoptCurrentRouteAsRequest];
  }

  [self emitRouteChange];

  // Headset unplugged — pause playback so we don't suddenly blast through the
  // loudspeaker (matches expo-audio behavior and Apple's guidance).
  if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: old device unavailable — "
               @"pausing playback");
    if (self.isPlaying && self.playerNode) {
      [self.playerNode pause];
    }
  }

  BOOL causedByCategory =
      reason == AVAudioSessionRouteChangeReasonCategoryChange ||
      reason == AVAudioSessionRouteChangeReasonNoSuitableRouteForCategory;
  BOOL causedByOverride = reason == AVAudioSessionRouteChangeReasonOverride;
  // NewDeviceAvailable and RouteConfigurationChange (posted e.g. when VPIO
  // engages after agent start) also leave the configured session valid;
  // hardware-format changes are covered by handleEngineConfigurationChange.
  // Clearing `audioSessionConfigured` for them re-runs the setCategory ladder
  // under the live VPIO engine and audibly breaks AEC (agent hears itself).
  BOOL sessionStillValid =
      causedByCategory || causedByOverride ||
      reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable ||
      reason == AVAudioSessionRouteChangeReasonRouteConfigurationChange;

  if (!sessionStillValid) {
    self.audioSessionConfigured = NO;
  }

  if (!_recordState.isRunning && !self.isPlaying) {
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: ignoring (inactive)");
    return;
  }

  if (!self.appIsActive) {
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: app inactive, skipping");
    return;
  }

  if (self.sessionInterrupted) {
    // Another session holds the audio hardware — `setActive:YES` is guaranteed
    // to fail. The interruption-ended handler reactivates when it's returned.
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: interrupted, deferring "
               @"reactivation");
    return;
  }

  if (causedByCategory) {
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: category change detected, "
               @"keeping session");
    return;
  }

  if (causedByOverride) {
    // Delivery of our own (or CC's) overrideOutputAudioPort on a still-valid
    // session; reconfiguring would loop the override under the live VPIO unit
    // and audibly break echo cancellation on the loudspeaker.
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: output override applied, "
               @"keeping session");
    return;
  }

  if (sessionStillValid) {
    // NewDeviceAvailable / RouteConfigurationChange — see above.
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: session still valid "
               @"(reason %lu), keeping session",
               (unsigned long)reason);
    return;
  }

  DGLogDebug(@"[Deepgram] handleAudioRouteChange: reactivating session");
  // Retry-based resume: Siri posts this route change while it still HOLDS the
  // hardware (sometimes before, or entirely without, an interruption
  // notification), so the first activation attempt routinely fails.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self resumeAfterInterruption:0];
  });
}

/**
 * AVAudioEngine stops itself and posts this when the hardware I/O format
 * changes — notably when the route moves between the built-in mic and a BT
 * HFP headset (48 kHz → 16/24 kHz). The mic tap and AVAudioConverter were
 * built against the *old* format, so without a rebuild capture goes silent
 * after switching to AirPods.
 */
- (void)handleEngineConfigurationChange:(NSNotification *)note {
  if (note.object != self.audioEngine) {
    return; // stale notification from a discarded engine instance
  }
  DGLogDebug(@"[Deepgram] handleEngineConfigurationChange");
  dispatch_async(dispatch_get_main_queue(), ^{
    [self restartEngineAfterConfigurationChange];
  });
}

- (void)restartEngineAfterConfigurationChange {
  if (!self.audioEngine) {
    return;
  }
  BOOL wantCapture = self.engineCaptureActive;
  BOOL wantPlayback = self.isPlaying;
  if (!wantCapture && !wantPlayback) {
    return; // idle — next start rebuilds everything anyway
  }
  if (self.audioEngine.isRunning) {
    return; // engine recovered on its own; nothing to rebuild
  }
  if (self.sessionInterrupted) {
    return; // hardware held by another session; rebuilt on interruption end
  }

  [self activateAudioSession:NULL];

  if (wantCapture) {
    // Reinstalls the tap and rebuilds the converter against the *current*
    // input hardware format, then restarts the engine.
    NSError *error = nil;
    if (![self startEngineCaptureAndReturnError:&error]) {
      DGLogError(@"[Deepgram] engine capture rebuild after config change "
                 @"failed: %@",
                 error.localizedDescription ?: error);
      return;
    }
  } else {
    NSError *error = nil;
    if (![self.audioEngine startAndReturnError:&error]) {
      DGLogError(@"[Deepgram] engine restart after config change failed: %@",
                 error.localizedDescription ?: error);
      return;
    }
  }

  if (wantPlayback && self.playerNode && !self.playerNode.isPlaying) {
    @try {
      [self.playerNode play];
    } @catch (NSException *e) {
      DGLogWarn(@"[Deepgram] playerNode resume after config change threw: %@",
                e);
    }
  }
}

// Posted when mediaserverd restarts: every AudioQueue / AVAudioEngine
// instance becomes a zombie. Apple's documented fix is to discard everything
// and rebuild on demand (matches expo-audio).
- (void)handleMediaServicesReset:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleMediaServicesReset: tearing down audio stack");
  self.audioSessionConfigured = NO;

  if (_recordState.isRunning || _recordState.queue) {
    [self cleanupRecordingQueue];
  }

  // Engine-based capture dies with mediaserverd too; force a full teardown so
  // the next startRecording rebuilds VPIO from scratch.
  self.engineCaptureActive = NO;
  self.captureConverter = nil;
  self.captureOutputFormat = nil;

  @try {
    if (self.playerNode) {
      [self.playerNode stop];
    }
    if (self.audioEngine) {
      [self.audioEngine stop];
    }
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] handleMediaServicesReset: teardown exception %@",
               e);
  }
  self.playerNode = nil;
  self.audioEngine = nil;
  self.isPlaying = NO;
}

/**
 * Resume capture/playback after the hardware was taken away — called when an
 * interruption ends AND from `handleAudioRouteChange:` (Siri grabs the
 * hardware and posts a route change sometimes before, or without, an
 * interruption notification). Activation is retried while the interrupter
 * releases the hardware; the engine paths need a full tap/converter rebuild
 * (a bare `[playerNode play]` on a stopped engine is a silent no-op). Every
 * step is idempotent, so overlapping invocations are harmless.
 */
- (void)resumeAfterInterruption:(int)attempt {
  if (self.sessionInterrupted) {
    return; // a new interruption began — its own Ended handler will resume
  }
  BOOL wantsQueueCapture = _recordState.isRunning && _recordState.queue;
  BOOL wantsEngine =
      self.audioEngine && (self.engineCaptureActive || self.isPlaying);
  if (!wantsQueueCapture && !wantsEngine) {
    DGLogDebug(@"[Deepgram] resumeAfterInterruption: nothing to resume");
    return; // stopped in the meantime
  }

  NSError *error = nil;
  if (![self activateAudioSession:&error]) {
    // ~4s of retries: Siri holds the hardware for several seconds and doesn't
    // always post interruption notifications to re-trigger the resume.
    if (attempt < 5) {
      DGLogDebug(@"[Deepgram] resumeAfterInterruption: activation not ready "
                 @"(attempt %d), retrying",
                 attempt);
      dispatch_after(
          dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.8 * NSEC_PER_SEC)),
          dispatch_get_main_queue(), ^{
            [self resumeAfterInterruption:attempt + 1];
          });
    } else {
      DGLogError(@"[Deepgram] resumeAfterInterruption: giving up after %d "
                 @"attempts: %@",
                 attempt + 1, error.localizedDescription ?: error);
    }
    return;
  }

  if (wantsQueueCapture) {
    OSStatus status = AudioQueueStart(_recordState.queue, NULL);
    if (status != noErr) {
      DGLogWarn(@"[Deepgram] resumeAfterInterruption: AudioQueueStart "
                @"failed (%d)",
                (int)status);
    } else {
      DGLogDebug(@"[Deepgram] resumeAfterInterruption: recording resumed");
    }
  }

  if (wantsEngine && !self.audioEngine.isRunning) {
    // Rebuilds the mic tap/converter against the current hardware format,
    // restarts the engine, and resumes the player node if it was playing.
    DGLogDebug(@"[Deepgram] resumeAfterInterruption: restarting engine");
    [self restartEngineAfterConfigurationChange];
  } else if (self.isPlaying && self.playerNode && !self.playerNode.isPlaying) {
    @try {
      [self.playerNode play];
    } @catch (NSException *e) {
      DGLogWarn(@"[Deepgram] resumeAfterInterruption: playerNode play "
                @"threw: %@",
                e);
    }
  }
}

- (void)handleAudioInterruption:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAudioInterruption: %@", note.userInfo);
  NSNumber *typeValue = note.userInfo[AVAudioSessionInterruptionTypeKey];
  AVAudioSessionInterruptionType type =
      (AVAudioSessionInterruptionType)typeValue.unsignedIntegerValue;

  if (type == AVAudioSessionInterruptionTypeBegan) {
    // A "began" posted because the app was suspended is stale history — no
    // matching "ended" ever arrives; treating it as live would wedge
    // `sessionInterrupted`. Resume instead. (Not posted on iOS 16+; the
    // app-active handler is the primary fallback.)
    BOOL wasSuspended = NO;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    if (@available(iOS 14.5, *)) {
      NSNumber *reasonValue = note.userInfo[AVAudioSessionInterruptionReasonKey];
      wasSuspended = reasonValue != nil &&
                     reasonValue.unsignedIntegerValue ==
                         AVAudioSessionInterruptionReasonAppWasSuspended;
    } else {
      NSNumber *suspendedValue =
          note.userInfo[AVAudioSessionInterruptionWasSuspendedKey];
      wasSuspended = suspendedValue.boolValue;
    }
#pragma clang diagnostic pop
    if (wasSuspended) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: stale was-suspended "
                 @"notification, resuming");
      dispatch_async(dispatch_get_main_queue(), ^{
        [self resumeAfterInterruption:0];
      });
      return;
    }

    DGLogDebug(@"[Deepgram] handleAudioInterruption: interruption began");
    self.sessionInterrupted = YES;
    if (_recordState.isRunning && _recordState.queue) {
      DGLogDebug(
          @"[Deepgram] handleAudioInterruption: pausing recording queue");
      AudioQueuePause(_recordState.queue);
    }
    if (self.isPlaying && self.playerNode) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: pausing player node");
      [self.playerNode pause];
    }
    // Observability only — the system doesn't say why (call, Siri, alarm, …).
    if (self.hasListeners) {
      [self sendEventWithName:@"DeepgramInterruption"
                         body:@{@"type" : @"began", @"reason" : @"unknown"}];
    }
  } else if (type == AVAudioSessionInterruptionTypeEnded) {
    DGLogDebug(@"[Deepgram] handleAudioInterruption: interruption ended");
    self.sessionInterrupted = NO;
    NSNumber *optionValue = note.userInfo[AVAudioSessionInterruptionOptionKey];
    AVAudioSessionInterruptionOptions options =
        (AVAudioSessionInterruptionOptions)optionValue.unsignedIntegerValue;
    BOOL shouldResume =
        (options & AVAudioSessionInterruptionOptionShouldResume) != 0;
    // Resume regardless of the ShouldResume hint — Siri regularly omits it,
    // and for a live mic/agent session "keep going" is always right. Runs
    // async on main since activation may need retries.
    dispatch_async(dispatch_get_main_queue(), ^{
      [self resumeAfterInterruption:0];
    });
    if (self.hasListeners) {
      [self sendEventWithName:@"DeepgramInterruption"
                         body:@{
                           @"type" : @"ended",
                           @"shouldResume" : @(shouldResume)
                         }];
    }
  }
}

@end
