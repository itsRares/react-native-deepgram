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
 * Build the Bluetooth input option appropriate for the running OS.
 * iOS 17 deprecated `AllowBluetooth` (HFP route) in favor of
 * `AllowBluetoothHFP`. Prefer the new symbol when building against the iOS
 * 17+ SDK and fall back to the legacy spelling on older toolchains.
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
 * Attempt to apply a single category/mode/options tuple and activate the
 * session. Returns YES on success. On failure, populates `outError` so the
 * caller can decide whether to try a more conservative configuration.
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
 * Configure audio session with mode appropriate to current usage.
 *
 * The configuration is attempted from most- to least-capable. If a richer
 * setup is rejected we automatically fall back to a simpler one so audio still
 * works instead of hard-failing.
 *
 * Two subtle rules drive the ordering below; getting them wrong yields
 * OSStatus -50 (kAudioSession/paramErr) on `setCategory`, which then leaves the
 * session in a half-configured state and makes a later AudioQueueStart fail
 * with 'what' (kAudioSessionUnspecifiedError):
 *
 *   1. `DefaultToSpeaker` forces output to the built-in speaker, while
 *      `AllowBluetoothA2DP` / `AllowAirPlay` route output to external devices.
 *      Combining them is contradictory and is rejected with -50, so those
 *      output-routing options are NEVER mixed with a recording configuration.
 *      A2DP/AirPlay devices are output-only and can't supply a mic input
 *      anyway — Bluetooth input uses the HFP route instead.
 *   2. `MixWithOthers` lets us coexist with other audio packages (expo-av,
 *      etc.) but can prevent us from acquiring the input on some routes. We try
 *      it first to be a good citizen, then degrade to exclusive access so
 *      recording still starts reliably.
 *
 * VoiceChat mode (which engages Apple's hardware AEC / VPIO) is used only when
 * echo cancellation is required and only on a device — VPIO is unavailable on
 * the Simulator and requesting it there guarantees a -50.
 */
- (BOOL)configureAudioSessionForRecording:(BOOL)needsMicrophone
                                    error:(NSError **)outError {
  DGLogDebug(@"[Deepgram] configureAudioSession: begin (mic=%@)",
             needsMicrophone ? @"YES" : @"NO");

  const AVAudioSessionCategoryOptions mixOption =
      AVAudioSessionCategoryOptionMixWithOthers;

  // The requested output route shapes the option set:
  //   - `bluetooth` adds the HFP option to the AEC/VoiceChat attempts (a BT
  //     headset is only usable while the mic is live via the HFP route; HFP +
  //     VoiceChat is the standard VoIP configuration). It is *not* added by
  //     default — with HFP allowed, iOS auto-routes onto a connected headset,
  //     and VPIO's echo cancellation is tuned for the built-in speaker/mic.
  //   - `speaker` / `earpiece` drop the HFP option so a connected headset is
  //     fully disengaged, and `earpiece` (or `bluetooth`) also drops
  //     DefaultToSpeaker — with that option set, the receiver is unreachable.
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
    // Preferred: hardware AEC via VoiceChat (device only). VoiceChat mode
    // manages the route itself, so DefaultToSpeaker must NOT be combined
    // with it — doing so is rejected with -50 on some iOS versions. Only
    // MixWithOthers (and, for an explicit Bluetooth request, HFP) is safe to
    // layer on top; the bare attempts remain as -50 fallbacks.
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
      // Category (re)configuration resets any output override / preferred
      // input, so the requested route is applied exactly once, here. Every
      // sub-call is guarded to be a no-op when the session already matches,
      // so this cannot trigger route-change feedback loops.
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
 * Prefer a connected Bluetooth HFP input. Output follows the negotiated HFP
 * route, so selecting the BT input is what actually moves call audio onto the
 * headset. Returns YES when an HFP device is engaged (or already was).
 */
- (BOOL)preferBluetoothInputIfAvailable {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  for (AVAudioSessionPortDescription *input in session.availableInputs) {
    if ([input.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
      // Idempotent: re-setting the input we're already pinned to still posts
      // a route-change notification, and the route-change handler reconfigures
      // the session — which would call back in here and spin into a feedback
      // loop that stalls playback. Skip when already pinned.
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
 * Release a previously preferred input (e.g. a Bluetooth HFP device) so the
 * OS resolves the default route again. Idempotent: no-op when no preferred
 * input is set.
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
 * Apply `requestedAudioRoute` to the *already configured* session. Called
 * exactly once after each successful category configuration (which resets any
 * override) and from `applyAudioRoute:` when no reconfiguration is needed.
 *
 * Every sub-call is guarded to be a no-op when the session already matches
 * the request, so this never generates redundant route-change notifications
 * (redundant `setPreferredInput` / override calls caused route-change storms
 * that stalled the playback engine in the previous implementation).
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
    // The override is what moves VoiceChat-mode output from the receiver to
    // the loud speaker. Only meaningful for PlayAndRecord (Playback has no
    // receiver — its default output already is the speaker).
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
    // Clear any speaker override; without DefaultToSpeaker in the options
    // (guaranteed by the ladder for this route) PlayAndRecord defaults to the
    // receiver. Only needed when the output actually sits on the speaker.
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
      // when no headset is connected the request stays pending and HFP stays
      // allowed in the category, so a headset that connects later is adopted
      // by the OS automatically.
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
 * route change (user Control Center switch, headset unplug). Without this,
 * the next session reconfiguration would re-assert a stale request and revert
 * the user's choice — the "can't switch output while the agent is running"
 * bug class from the previous implementation.
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
 * Store and apply a route request from JS. When nothing is active the request
 * is simply remembered (it shapes the next activation). When a session is
 * live, the category is re-set only if the route needs different category
 * options (Bluetooth HFP allowance / DefaultToSpeaker) — a plain speaker ↔
 * earpiece flip under VoiceChat is a pure output override and must not
 * disturb a running VPIO engine.
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
    // auto: keep the running configuration; the system default applies from
    // the next reconfiguration onward.
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

  // External route changes (a Control Center output switch, a device
  // disappearing) become the new stored request so later reconfigurations
  // preserve — rather than fight — the user's pick. Our own overrides also
  // land here with reason Override, but by delivery time the route already
  // *is* the requested one, so adoption converges to the same value.
  // NewDeviceAvailable is excluded: merely connecting a headset must not
  // convert the request to `bluetooth` (the duplex agent stays on the
  // built-in hardware unless BT is explicitly chosen — echo guard).
  if (reason == AVAudioSessionRouteChangeReasonOverride ||
      reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
    [self adoptCurrentRouteAsRequest];
  }

  // Surface every route change to JS (headphone plug/unplug, BT
  // connect/disconnect, speaker ↔ earpiece switches).
  [self emitRouteChange];

  // Headphones / Bluetooth headset unplugged — pause playback so we don't
  // surprise the user by suddenly blasting through the loud speaker.
  // (System would route audio to the speaker automatically; that's the point
  // of this notification.) Matches expo-audio behavior and Apple's guidance.
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

  if (!causedByCategory) {
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

  if (causedByCategory) {
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: category change detected, "
               @"keeping session");
    return;
  }

  DGLogDebug(@"[Deepgram] handleAudioRouteChange: reactivating session");
  [self activateAudioSession:NULL];
}

/**
 * AVAudioEngine stops itself and posts this notification whenever the
 * underlying hardware I/O format changes — most notably when the route moves
 * between the built-in mic and a Bluetooth HFP headset (48 kHz → 16/24 kHz).
 * The mic tap and AVAudioConverter were built against the *old* hardware
 * format, so without a rebuild capture goes silent after switching to
 * AirPods. Rebuild the capture front-end against the new format and restart
 * the engine.
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

// AVAudioSession can post this when mediaserverd restarts (e.g. after a
// rare system audio HAL hiccup). Once it fires, every AudioQueue /
// AVAudioEngine instance becomes a zombie. Apple's documented fix is to throw
// everything away and rebuild on demand. Match expo-audio's approach.
- (void)handleMediaServicesReset:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleMediaServicesReset: tearing down audio stack");
  self.audioSessionConfigured = NO;

  // Recording queue must be torn down — it's a zombie after a media services
  // reset.
  if (_recordState.isRunning || _recordState.queue) {
    [self cleanupRecordingQueue];
  }

  // Engine-based capture path also dies with mediaserverd; force a full
  // teardown so the next startRecording rebuilds VPIO from scratch.
  self.engineCaptureActive = NO;
  self.captureConverter = nil;
  self.captureOutputFormat = nil;

  // AVAudioEngine + player node are no longer valid. Stop and discard so the
  // next setup call rebuilds from scratch.
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

- (void)handleAudioInterruption:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAudioInterruption: %@", note.userInfo);
  NSNumber *typeValue = note.userInfo[AVAudioSessionInterruptionTypeKey];
  AVAudioSessionInterruptionType type =
      (AVAudioSessionInterruptionType)typeValue.unsignedIntegerValue;

  if (type == AVAudioSessionInterruptionTypeBegan) {
    DGLogDebug(@"[Deepgram] handleAudioInterruption: interruption began");
    if (_recordState.isRunning && _recordState.queue) {
      DGLogDebug(
          @"[Deepgram] handleAudioInterruption: pausing recording queue");
      AudioQueuePause(_recordState.queue);
    }
    if (self.isPlaying && self.playerNode) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: pausing player node");
      [self.playerNode pause];
    }
  } else if (type == AVAudioSessionInterruptionTypeEnded) {
    DGLogDebug(@"[Deepgram] handleAudioInterruption: interruption ended");
    NSNumber *optionValue = note.userInfo[AVAudioSessionInterruptionOptionKey];
    AVAudioSessionInterruptionOptions options =
        (AVAudioSessionInterruptionOptions)optionValue.unsignedIntegerValue;
    if (options & AVAudioSessionInterruptionOptionShouldResume) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: should resume");
      [self activateAudioSession:nil];

      if (_recordState.isRunning && _recordState.queue) {
        DGLogDebug(
            @"[Deepgram] handleAudioInterruption: resuming recording queue");
        AudioQueueStart(_recordState.queue, NULL);
      }
      if (self.isPlaying && self.playerNode) {
        DGLogDebug(@"[Deepgram] handleAudioInterruption: resuming player node");
        [self.playerNode play];
      }
    }
  }
}

@end
