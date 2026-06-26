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

  // Build an ordered list of attempts, best first.
  NSMutableArray<NSDictionary *> *attempts = [NSMutableArray array];

  if (needsMicrophone) {
    BOOL needsAEC = self.engineCaptureActive || self.voiceProcessingRequested ||
                    self.isPlaying;

    // Input-safe options for PlayAndRecord. DefaultToSpeaker + HFP are valid
    // here; A2DP/AirPlay are intentionally excluded (see rule 1 above).
    AVAudioSessionCategoryOptions recordOptions =
        AVAudioSessionCategoryOptionDefaultToSpeaker | [self bluetoothHFPOption];

#if !TARGET_OS_SIMULATOR
    // Preferred: hardware AEC via VoiceChat (device only). VoiceChat mode
    // manages the route itself, so DefaultToSpeaker / HFP must NOT be combined
    // with it — doing so is rejected with -50 on some iOS versions. Only
    // MixWithOthers is safe to layer on top.
    if (needsAEC) {
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

- (void)handleAudioRouteChange:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAudioRouteChange: %@", note.userInfo);
  NSNumber *reasonValue = note.userInfo[AVAudioSessionRouteChangeReasonKey];
  AVAudioSessionRouteChangeReason reason =
      reasonValue
          ? (AVAudioSessionRouteChangeReason)reasonValue.unsignedIntegerValue
          : AVAudioSessionRouteChangeReasonUnknown;

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
