#import "Deepgram+AudioSession.h"
#import "Deepgram+Private.h"
#import "Deepgram+Recording.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>

// Synthetic device identifiers for the built-in outputs. These aren't real
// audio-port UIDs (the built-in speaker/receiver are output overrides, not
// selectable input ports), so we mint stable ids the JS layer can pass back to
// `selectAudioDevice`. Every other device id is a real AVAudioSession port UID.
static NSString *const kDGSpeakerDeviceId = @"dg-builtin-speaker";
static NSString *const kDGEarpieceDeviceId = @"dg-builtin-earpiece";

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

  // Honor any user-requested output route across (re)configurations. This only
  // re-pins the speaker/earpiece override; it never rebuilds the category, so
  // it cannot recurse back into configureAudioSession.
  [self reapplyOutputOverrideOnly];

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

  // Build an ordered list of attempts, best first.
  NSMutableArray<NSDictionary *> *attempts = [NSMutableArray array];

  if (needsMicrophone) {
    BOOL needsAEC = self.engineCaptureActive || self.voiceProcessingRequested ||
                    self.isPlaying;

    // Input-safe options for PlayAndRecord. DefaultToSpeaker + HFP are valid
    // here; A2DP/AirPlay are intentionally excluded (see rule 1 above).
    //
    // When the user has explicitly requested the earpiece, omit
    // DefaultToSpeaker: the output override below can only choose between the
    // speaker and "none", and "none" still resolves to the loud speaker while
    // DefaultToSpeaker is set. Dropping it lets the built-in receiver become
    // the default output. (VoiceChat / AEC attempts never carry this option,
    // so they are unaffected.)
    AVAudioSessionCategoryOptions recordOptions = [self bluetoothHFPOption];
    if (![self.requestedAudioRoute isEqualToString:@"earpiece"]) {
      recordOptions |= AVAudioSessionCategoryOptionDefaultToSpeaker;
    }

#if !TARGET_OS_SIMULATOR
    // Preferred: hardware AEC via VoiceChat (device only).
    //
    // VoiceChat must still carry the Bluetooth HFP option. A2DP is output-only
    // and can't be used while the mic is live, so a connected headset (AirPods,
    // car kit, etc.) is dropped from the route the instant recording starts
    // unless HFP is allowed — and its input port never even appears in
    // `availableInputs`, so it can't be enumerated or selected either. HFP is
    // fully compatible with VoiceChat (it is the standard VoIP setup); only
    // DefaultToSpeaker and A2DP/AirPlay are kept out (the output override picks
    // speaker vs. earpiece, see rule 1). We try HFP first and fall back to the
    // bare VoiceChat configs only if a device rejects the combination with -50.
    if (needsAEC) {
      AVAudioSessionCategoryOptions hfpOption = [self bluetoothHFPOption];
      [attempts addObject:@{
        @"category" : AVAudioSessionCategoryPlayAndRecord,
        @"mode" : AVAudioSessionModeVoiceChat,
        @"options" : @(hfpOption | mixOption),
      }];
      [attempts addObject:@{
        @"category" : AVAudioSessionCategoryPlayAndRecord,
        @"mode" : AVAudioSessionModeVoiceChat,
        @"options" : @(hfpOption),
      }];
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

/**
 * Adopt the route the system is *actually* using as our sticky request. Called
 * when something outside our control moves the route mid-session — most often
 * the user picking a different output in the Control Center "Audio output"
 * menu — so the next (re)configuration re-asserts *their* choice instead of
 * reverting to our stored default. A Bluetooth output is pinned by its input
 * UID so the specific headset survives reconfiguration.
 *
 * Deliberately NOT called for a *freshly connected* Bluetooth device
 * (NewDeviceAvailable): the duplex agent stays on the built-in mic to avoid
 * feeding itself echo until the user explicitly selects the headset.
 */
- (void)adoptActualRouteAsRequest {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSString *actual = [self currentAudioRouteString];

  if ([actual isEqualToString:@"bluetooth"]) {
    NSString *uid = nil;
    for (AVAudioSessionPortDescription *input in session.currentRoute.inputs) {
      if ([input.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
        uid = input.UID;
        break;
      }
    }
    if (!uid.length) {
      for (AVAudioSessionPortDescription *input in session.availableInputs) {
        if ([input.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
          uid = input.UID;
          break;
        }
      }
    }
    self.requestedDeviceId = uid;
    self.requestedAudioRoute = @"bluetooth";
    DGLogDebug(@"[Deepgram] adoptActualRoute: bluetooth (uid=%@)", uid);
    return;
  }

  // Built-in or wired output — drop any stale device pin and track the coarse
  // route so reapplyOutputOverrideOnly keeps (rather than fights) it.
  self.requestedDeviceId = nil;
  if ([actual isEqualToString:@"speaker"]) {
    self.requestedAudioRoute = @"speaker";
  } else if ([actual isEqualToString:@"earpiece"]) {
    self.requestedAudioRoute = @"earpiece";
  } else {
    // wired / unknown: let the OS keep routing to it; nothing to override.
    self.requestedAudioRoute = @"auto";
  }
  DGLogDebug(@"[Deepgram] adoptActualRoute: %@", self.requestedAudioRoute);
}

- (void)handleAudioRouteChange:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAudioRouteChange: %@", note.userInfo);
  NSNumber *reasonValue = note.userInfo[AVAudioSessionRouteChangeReasonKey];
  AVAudioSessionRouteChangeReason reason =
      reasonValue
          ? (AVAudioSessionRouteChangeReason)reasonValue.unsignedIntegerValue
          : AVAudioSessionRouteChangeReasonUnknown;

  // Surface the route change to JS regardless of our internal active state so
  // listeners observe headphone plug/unplug and Bluetooth connect/disconnect
  // even while idle.
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

    // An external actor moved the route (most often the user picking a
    // different output in the Control Center "Audio output" menu). Adopt it as
    // our sticky request so the next (re)configuration honors their choice
    // instead of reverting to the stored default. A *freshly connected*
    // Bluetooth device is skipped — the duplex agent stays on the built-in mic
    // (echo guard) until explicitly selected — and only while a PlayAndRecord
    // session owns the route (plain Playback already follows the OS output with
    // no override to fight).
    if (reason != AVAudioSessionRouteChangeReasonNewDeviceAvailable &&
        [[AVAudioSession sharedInstance].category
            isEqualToString:AVAudioSessionCategoryPlayAndRecord]) {
      [self adoptActualRouteAsRequest];
    }
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
  // Headphones / USB / HDMI / car audio / line-out — wired-style outputs that
  // can't be selected explicitly (the OS routes to them automatically).
  return @"wired";
}

- (void)emitRouteChange {
  if (!self.hasListeners) {
    return;
  }
  NSString *route = [self currentAudioRouteString];
  DGLogDebug(@"[Deepgram] emitRouteChange: %@", route);
  [self sendEventWithName:@"DeepgramRouteChange" body:@{@"route" : route}];
  // Keep the richer device-centric listeners in sync from the same triggers.
  [self emitAudioDevices];
}

/**
 * Prefer a connected Bluetooth HFP input. Output follows the negotiated HFP
 * route, so selecting the BT input is what actually moves call audio onto the
 * headset. Returns YES when an HFP device was pinned, NO when none is present
 * (or the pin failed) so the caller can release to the OS default instead.
 */
- (BOOL)preferBluetoothInputIfAvailable {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  for (AVAudioSessionPortDescription *input in session.availableInputs) {
    if ([input.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
      // Idempotent: re-setting the input we're already pinned to still posts a
      // route change, and the route-change handler reconfigures the session —
      // which would call back in here and spin into a feedback loop that
      // stalls playback. Skip when already pinned.
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
 * Release any previously preferred input (e.g. a Bluetooth HFP device) so the
 * OS is free to resolve the default route again. Used when the requested route
 * is no longer `bluetooth`.
 */
- (void)clearPreferredInput {
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
 * Find an available input port by its stable UID, or nil when the device is no
 * longer connected. Used to re-pin the exact device the user selected (e.g. a
 * specific Bluetooth headset among several).
 */
- (AVAudioSessionPortDescription *)availableInputPortWithUID:(NSString *)uid {
  if (!uid.length) {
    return nil;
  }
  for (AVAudioSessionPortDescription *input in
       [AVAudioSession sharedInstance].availableInputs) {
    if ([input.UID isEqualToString:uid]) {
      return input;
    }
  }
  return nil;
}

/**
 * Map an AVAudioSession port type to our coarse route category, or nil when the
 * port isn't a user-selectable output device (e.g. the built-in mic, which is
 * surfaced as the synthetic speaker/earpiece entries instead).
 */
- (NSString *)routeTypeForPortType:(AVAudioSessionPort)portType {
  if ([portType isEqualToString:AVAudioSessionPortBluetoothHFP] ||
      [portType isEqualToString:AVAudioSessionPortBluetoothLE]) {
    return @"bluetooth";
  }
  if ([portType isEqualToString:AVAudioSessionPortHeadsetMic] ||
      [portType isEqualToString:AVAudioSessionPortHeadphones] ||
      [portType isEqualToString:AVAudioSessionPortUSBAudio] ||
      [portType isEqualToString:AVAudioSessionPortCarAudio] ||
      [portType isEqualToString:AVAudioSessionPortLineIn]) {
    return @"wired";
  }
  return nil;
}

/**
 * Pin the input that satisfies the current request. A specific device id (the
 * exact port UID the user picked) wins so the chosen headset is re-selected
 * across (re)configurations. Only an explicit `bluetooth` request follows a
 * connected headset; every other route — including the default `auto` — keeps
 * the agent on the built-in mic.
 *
 * This is deliberate: the duplex Voice Agent runs Apple's VPIO hardware echo
 * canceller, which is tuned for the built-in speaker/mic geometry. If iOS
 * silently moves the route onto a Bluetooth headset (especially one sitting on
 * a desk), VPIO can no longer cancel the agent's own output and it "hears
 * itself". So a connected headset stays *listed* in the picker but is engaged
 * only when the user taps it.
 */
- (void)pinPreferredInputForCurrentRequest {
  NSString *route = self.requestedAudioRoute ?: @"auto";

  if (self.requestedDeviceId.length) {
    AVAudioSessionPortDescription *port =
        [self availableInputPortWithUID:self.requestedDeviceId];
    if (port) {
      AVAudioSession *session = [AVAudioSession sharedInstance];
      // Idempotent: re-pinning the same device still posts a route change that
      // can spin the route-change handler into a reconfiguration loop.
      if (![session.preferredInput.UID isEqualToString:port.UID]) {
        NSError *error = nil;
        if (![session setPreferredInput:port error:&error] || error) {
          DGLogWarn(@"[Deepgram] pinPreferredInput(%@) failed: %@",
                    self.requestedDeviceId,
                    error.localizedDescription ?: error);
        }
      }
      return;
    }
    // The chosen device disappeared (disconnected) — fall back to the coarse
    // route handling below.
  }

  if ([route isEqualToString:@"bluetooth"]) {
    [self preferBluetoothInputIfAvailable];
    return;
  }

  // auto / speaker / earpiece / wired: don't let iOS auto-route the duplex
  // agent onto a merely-connected Bluetooth headset (that reintroduces echo).
  [self keepBuiltInInputWhenBluetoothPresent];
}

/**
 * When a Bluetooth HFP headset is connected but hasn't been explicitly chosen,
 * pin the built-in mic so the system doesn't auto-route the duplex agent onto
 * the headset and defeat VPIO echo cancellation. Only applies while hardware
 * voice processing is active (the agent / duplex case); plain STT capture has
 * no playback to echo, so it keeps honoring the OS default route (which may
 * legitimately be a Bluetooth mic). No Bluetooth present → release the pin.
 */
- (void)keepBuiltInInputWhenBluetoothPresent {
  BOOL duplexAEC = self.voiceProcessingRequested || self.engineCaptureActive;
  if (!duplexAEC) {
    [self clearPreferredInput];
    return;
  }

  AVAudioSession *session = [AVAudioSession sharedInstance];
  AVAudioSessionPortDescription *builtInMic = nil;
  BOOL bluetoothPresent = NO;
  for (AVAudioSessionPortDescription *input in session.availableInputs) {
    if ([input.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
      builtInMic = input;
    } else if ([input.portType
                   isEqualToString:AVAudioSessionPortBluetoothHFP]) {
      bluetoothPresent = YES;
    }
  }

  if (bluetoothPresent && builtInMic) {
    // Idempotent: only switch when we're not already on the built-in mic, so we
    // don't post a redundant route change on every reconfiguration (which the
    // route-change handler would answer with another reconfiguration — a storm
    // that stalls the player and overflows the playback buffer).
    if (![session.preferredInput.UID isEqualToString:builtInMic.UID]) {
      NSError *error = nil;
      if (![session setPreferredInput:builtInMic error:&error] || error) {
        DGLogWarn(@"[Deepgram] keepBuiltInInput failed: %@",
                  error.localizedDescription ?: error);
      }
    }
    return;
  }
  [self clearPreferredInput];
}

- (void)reapplyOutputOverrideOnly {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  // Output overrides and input preferences only apply to PlayAndRecord;
  // Playback already routes to the speaker by default and has no input to pin.
  if (![session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord]) {
    return;
  }

  NSString *route = self.requestedAudioRoute ?: @"auto";
  AVAudioSessionPortOverride override =
      [route isEqualToString:@"speaker"] ? AVAudioSessionPortOverrideSpeaker
                                         : AVAudioSessionPortOverrideNone;
  NSError *error = nil;
  if (![session overrideOutputAudioPort:override error:&error] || error) {
    DGLogWarn(@"[Deepgram] reapplyOutputOverrideOnly failed: %@",
              error.localizedDescription ?: error);
  }

  // Re-pin (or release) the preferred input so a specific-device or `bluetooth`
  // request actually follows the headset across (re)configurations, while every
  // other route — including `auto` — drops a stale preference.
  [self pinPreferredInputForCurrentRequest];
}

- (BOOL)applyRequestedAudioRoute:(NSError **)outError {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSString *route = self.requestedAudioRoute ?: @"auto";

  // Nothing to override until a PlayAndRecord session is active; the request is
  // stored and applied automatically on the next (re)configuration via
  // reapplyOutputOverrideOnly (and the DefaultToSpeaker rule for earpiece).
  if (!self.audioSessionConfigured ||
      ![session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord]) {
    return YES;
  }

  BOOL aecActive = self.engineCaptureActive || self.voiceProcessingRequested;

  // In the AEC / VoiceChat path DefaultToSpeaker is never part of the category,
  // so the output override alone selects speaker vs. earpiece — reconfiguring
  // there risks disturbing VPIO. Only the non-AEC PlayAndRecord ladder carries
  // DefaultToSpeaker, so `earpiece` needs a category rebuild to drop it.
  if (!aecActive && [route isEqualToString:@"earpiece"]) {
    NSError *cfgError = nil;
    if (![self configureAudioSession:&cfgError]) {
      if (outError) {
        *outError = cfgError;
      }
      return NO;
    }
  }

  AVAudioSessionPortOverride override =
      [route isEqualToString:@"speaker"] ? AVAudioSessionPortOverrideSpeaker
                                         : AVAudioSessionPortOverrideNone;
  NSError *ovError = nil;
  if (![session overrideOutputAudioPort:override error:&ovError] || ovError) {
    if (outError) {
      *outError = ovError;
    }
    return NO;
  }

  [self pinPreferredInputForCurrentRequest];

  return YES;
}

/**
 * Enumerate the output devices the user can currently route to. The built-in
 * loudspeaker and receiver are surfaced as synthetic entries (they are output
 * overrides, not selectable input ports); every connected Bluetooth/wired
 * device is reported individually with its real port UID so a UI can list and
 * pick between several Bluetooth headsets by name.
 *
 * Bluetooth/earpiece entries only appear while a PlayAndRecord session is
 * active (HFP inputs aren't enumerable under the Playback category), which is
 * the Voice Agent / live-STT case this is built for.
 */
- (NSArray<NSDictionary *> *)enumerateAudioDevices {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSMutableArray<NSDictionary *> *devices = [NSMutableArray array];

  BOOL hasBuiltInMic = NO;
  NSMutableArray<NSDictionary *> *externalDevices = [NSMutableArray array];
  for (AVAudioSessionPortDescription *input in session.availableInputs) {
    if ([input.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
      hasBuiltInMic = YES;
      continue;
    }
    NSString *type = [self routeTypeForPortType:input.portType];
    if (!type) {
      continue;
    }
    [externalDevices addObject:@{
      @"id" : input.UID ?: input.portName ?: @"",
      @"name" : input.portName ?: type,
      @"type" : type,
    }];
  }

  NSString *activeRoute = [self currentAudioRouteString];
  NSString *preferredUID = session.preferredInput.UID;

  // Built-in loudspeaker is always available.
  [devices addObject:@{
    @"id" : kDGSpeakerDeviceId,
    @"name" : @"Speaker",
    @"type" : @"speaker",
  }];
  // The earpiece (receiver) is only a valid output while recording, i.e. when a
  // built-in mic input exists.
  if (hasBuiltInMic) {
    [devices addObject:@{
      @"id" : kDGEarpieceDeviceId,
      @"name" : @"Earpiece",
      @"type" : @"earpiece",
    }];
  }
  [devices addObjectsFromArray:externalDevices];

  // Decide which single device is currently selected. For a category with
  // multiple matches (e.g. two Bluetooth headsets) prefer the pinned input,
  // then the user's last explicit request, then the first of that type.
  NSString *selectedId = nil;
  if ([activeRoute isEqualToString:@"speaker"]) {
    selectedId = kDGSpeakerDeviceId;
  } else if ([activeRoute isEqualToString:@"earpiece"]) {
    selectedId = hasBuiltInMic ? kDGEarpieceDeviceId : nil;
  } else {
    // bluetooth / wired — match a concrete external device.
    for (NSDictionary *device in externalDevices) {
      if (![device[@"type"] isEqualToString:activeRoute]) {
        continue;
      }
      if ([device[@"id"] isEqualToString:preferredUID] ||
          [device[@"id"] isEqualToString:self.requestedDeviceId]) {
        selectedId = device[@"id"];
        break;
      }
      if (!selectedId) {
        selectedId = device[@"id"]; // first of this type as a fallback
      }
    }
  }

  NSMutableArray<NSDictionary *> *result = [NSMutableArray array];
  for (NSDictionary *device in devices) {
    NSMutableDictionary *entry = [device mutableCopy];
    entry[@"selected"] = @([device[@"id"] isEqualToString:selectedId]);
    [result addObject:entry];
  }
  return result;
}

/**
 * Route audio to a specific device by id (a synthetic built-in id or a real
 * port UID from `enumerateAudioDevices`). Stores the request so it is re-pinned
 * across (re)configurations, then applies it immediately when a session is live.
 */
- (BOOL)selectAudioDeviceById:(NSString *)deviceId error:(NSError **)outError {
  if (!deviceId.length) {
    if (outError) {
      *outError =
          DGNativeError(@"DeepgramAudioRoute", 1, @"A deviceId is required");
    }
    return NO;
  }

  if ([deviceId isEqualToString:kDGSpeakerDeviceId]) {
    self.requestedDeviceId = nil;
    self.requestedAudioRoute = @"speaker";
    return [self applyRequestedAudioRoute:outError];
  }
  if ([deviceId isEqualToString:kDGEarpieceDeviceId]) {
    self.requestedDeviceId = nil;
    self.requestedAudioRoute = @"earpiece";
    return [self applyRequestedAudioRoute:outError];
  }

  AVAudioSessionPortDescription *port =
      [self availableInputPortWithUID:deviceId];
  if (!port) {
    if (outError) {
      *outError = DGNativeError(
          @"DeepgramAudioRoute", 1,
          [NSString stringWithFormat:
                        @"Unknown or unavailable audio device '%@'", deviceId]);
    }
    return NO;
  }

  NSString *type = [self routeTypeForPortType:port.portType] ?: @"bluetooth";
  self.requestedDeviceId = deviceId;
  // Bluetooth needs the `bluetooth` coarse route (keeps HFP routing intent);
  // wired devices follow the pinned input under `auto`.
  self.requestedAudioRoute =
      [type isEqualToString:@"bluetooth"] ? @"bluetooth" : @"auto";
  return [self applyRequestedAudioRoute:outError];
}

- (void)emitAudioDevices {
  if (!self.hasListeners) {
    return;
  }
  NSArray<NSDictionary *> *devices = [self enumerateAudioDevices];
  NSString *selectedId = nil;
  for (NSDictionary *device in devices) {
    if ([device[@"selected"] boolValue]) {
      selectedId = device[@"id"];
      break;
    }
  }
  [self sendEventWithName:@"DeepgramAudioDevices"
                    body:@{
                      @"devices" : devices,
                      @"selectedId" : selectedId ?: [NSNull null],
                    }];
}

@end
