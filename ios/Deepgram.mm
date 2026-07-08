#import "Deepgram.h"
#import "Deepgram+Private.h"
#import "Deepgram+AudioSession.h"
#import "Deepgram+Recording.h"
#import "Deepgram+Playback.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>
#import <React/RCTUtils.h>
#import <TargetConditionals.h>
#if TARGET_OS_IOS
#import <UIKit/UIKit.h>
#endif

#include <math.h>
#include <string.h>

// The class state (ivars + properties), the shared C helpers, the
// `DGRecordState` struct and the `DGHandleInputBuffer` AudioQueue callback now
// live in the shared headers and category files:
//   - DGSupport.h            : logging macros, error helpers, DGRecordState
//   - Deepgram+Private.h     : class extension (state) + cross-file decls
//   - Deepgram+AudioSession.mm : audio session lifecycle
//   - Deepgram+Recording.mm    : microphone capture (+ DGHandleInputBuffer)
//   - Deepgram+Playback.mm     : TTS / Voice Agent playback
// This file keeps the module registration, lifecycle and the exported
// RCT_EXPORT_METHOD entry points (kept here so the macros register on the
// concrete class rather than a category).

/**
 * Whether the user has explicitly granted microphone record permission. Read
 * via the deprecated `AVAudioSession` accessor (still functional on iOS 17+)
 * with the deprecation warning suppressed locally — mirroring MicPermission.m.
 * Lets `startRecording` fail fast with the contract `permission_denied` code,
 * matching the Android module.
 */
static BOOL DGHasRecordPermission(void) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  return [AVAudioSession sharedInstance].recordPermission ==
         AVAudioSessionRecordPermissionGranted;
#pragma clang diagnostic pop
}

@implementation Deepgram
RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"DeepgramAudioPCM", @"DeepgramAudioLevel", @"DeepgramRouteChange",
    @"DeepgramInterruption"
  ];
}

- (void)startObserving {
  DGLogDebug(@"[Deepgram] startObserving: listeners attached");
  self.hasListeners = YES;
}

- (void)stopObserving {
  DGLogDebug(@"[Deepgram] stopObserving: listeners detached");
  self.hasListeners = NO;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
- (instancetype)init {
  if (self = [super init]) {
    _chunkSizeBytes = 6400; // ≈200 ms of 16 kHz mono PCM16 audio
    DGLogDebug(@"[Deepgram] init: chunkSizeBytes=%lu",
               (unsigned long)_chunkSizeBytes);
    _emitterQueue = dispatch_queue_create("com.deepgram.liveaudiostream",
                                          DISPATCH_QUEUE_SERIAL);
    memset(&_recordState, 0, sizeof(DGRecordState));
    _scheduledBufferCount = 0;
    _appIsActive = YES;
#if TARGET_OS_IOS
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAppDidBecomeActive:)
               name:UIApplicationDidBecomeActiveNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for "
               @"UIApplicationDidBecomeActiveNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAppDidEnterBackground:)
               name:UIApplicationDidEnterBackgroundNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for "
               @"UIApplicationDidEnterBackgroundNotification");
#endif
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAudioRouteChange:)
               name:AVAudioSessionRouteChangeNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for "
               @"AVAudioSessionRouteChangeNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAudioInterruption:)
               name:AVAudioSessionInterruptionNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for "
               @"AVAudioSessionInterruptionNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleMediaServicesReset:)
               name:AVAudioSessionMediaServicesWereResetNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for "
               @"AVAudioSessionMediaServicesWereResetNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleEngineConfigurationChange:)
               name:AVAudioEngineConfigurationChangeNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for "
               @"AVAudioEngineConfigurationChangeNotification");
  }
  return self;
}

- (void)dealloc {
  DGLogDebug(@"[Deepgram] dealloc: cleaning up recording queue and removing "
             @"observers");
  [self cleanupRecordingQueue];
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

// MARK: - Audio session lifecycle lives in Deepgram+AudioSession.mm

#if TARGET_OS_IOS
- (void)handleAppDidBecomeActive:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAppDidBecomeActive: %@", note.userInfo);
  self.appIsActive = YES;

  if (_recordState.isRunning || self.isPlaying || self.engineCaptureActive) {
    // Siri (and some call flows) regularly ends an interruption WITHOUT ever
    // posting AVAudioSessionInterruptionTypeEnded; becoming active again is
    // the only reliable signal that the hardware is coming back. Clear the
    // interruption flag and run the full retrying resume — a bare setActive:
    // would leave the paused AudioQueue / stopped AVAudioEngine dead. If an
    // interruption is actually still ongoing (user returned to the app
    // mid-call), activation fails, the retries burn out harmlessly, and the
    // real interruption-ended notification resumes later.
    DGLogDebug(@"[Deepgram] handleAppDidBecomeActive: resuming session");
    self.sessionInterrupted = NO;
    dispatch_async(dispatch_get_main_queue(), ^{
      [self resumeAfterInterruption:0];
    });
  }
}

- (void)handleAppDidEnterBackground:(NSNotification *)note {
  DGLogDebug(@"[Deepgram] handleAppDidEnterBackground: %@", note.userInfo);
  self.appIsActive = NO;
}
#endif

// MARK: - Microphone capture lives in Deepgram+Recording.mm
//         (emitPCMChunk / appendPCMDataAndEmitIfNeeded / flushPendingPCM /
//          cleanupRecordingQueue / startEngineCaptureAndReturnError /
//          stopEngineCapture, plus the DGHandleInputBuffer callback)

RCT_EXPORT_METHOD(startRecording : (NSDictionary *)options resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    DGLogDebug(@"[Deepgram] startRecording: begin");

    if (!DGHasRecordPermission()) {
      DGLogError(
          @"[Deepgram] startRecording: microphone permission not granted");
      DGRejectPromise(
          reject, @"permission_denied",
          @"Microphone permission has not been granted. Request it from JS "
          @"(MicPermission.request) before calling startRecording.",
          nil);
      return;
    }

    BOOL enableVoiceProcessing = NO;
    if ([options isKindOfClass:[NSDictionary class]]) {
      id raw = options[@"enableVoiceProcessing"];
      if ([raw isKindOfClass:[NSNumber class]]) {
        enableVoiceProcessing = [(NSNumber *)raw boolValue];
      }
    }
    self.voiceProcessingRequested = enableVoiceProcessing;
    self.audioQueueCaptureRequested = !enableVoiceProcessing;

    NSDictionary *recordToFileOptions = nil;
    if ([options isKindOfClass:[NSDictionary class]]) {
      id rtf = options[@"recordToFile"];
      if ([rtf isKindOfClass:[NSDictionary class]]) {
        recordToFileOptions = (NSDictionary *)rtf;
      }
    }
    // Drop any file left open by a previous, incompletely stopped session.
    [self discardRecordingFile];

    self.currentSampleRate = 16000;
    DGLogDebug(@"[Deepgram] startRecording: targetSampleRate=%d vp=%@",
               self.currentSampleRate, enableVoiceProcessing ? @"YES" : @"NO");
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription
                              ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] startRecording: activation failed %@", message);
      self.voiceProcessingRequested = NO;
      self.audioQueueCaptureRequested = NO;
      DGRejectPromise(reject, @"start_error", message, sessionError);
      return;
    }

    if (enableVoiceProcessing) {
      if (_recordState.isRunning) {
        [self cleanupRecordingQueue];
      }
      [self stopEngineCapture];
      self.pendingPCMBuffer = [[NSMutableData alloc] init];

      // Open the WAV target before capture starts so the first buffers are
      // teed to disk and any file-open failure is surfaced before the mic opens.
      NSError *fileError = nil;
      if (![self beginRecordingToFileIfRequested:recordToFileOptions
                                           error:&fileError]) {
        DGLogError(@"[Deepgram] startRecording: record-to-file failed %@",
                   fileError);
        self.voiceProcessingRequested = NO;
        [self maybeDeactivateAudioSession];
        DGRejectPromise(reject, @"start_error", fileError.localizedDescription,
                        fileError);
        return;
      }

      NSError *engineError = nil;
      if (![self startEngineCaptureAndReturnError:&engineError]) {
        NSString *message = engineError.localizedDescription
                                ?: @"Failed to start engine capture";
        DGLogError(@"[Deepgram] startRecording: %@", message);
        [self discardRecordingFile];
        self.voiceProcessingRequested = NO;
        [self maybeDeactivateAudioSession];
        DGRejectPromise(reject, @"start_error", message, engineError);
        return;
      }
      DGLogDebug(@"[Deepgram] startRecording: engine capture started");
      if (resolve)
        resolve(nil);
      return;
    }

    if (_recordState.isRunning) {
      DGLogDebug(@"[Deepgram] startRecording: record state already running, "
                 @"cleaning up");
      [self cleanupRecordingQueue];
    }

    DGLogDebug(@"[Deepgram] startRecording: resetting buffers");
    self.pendingPCMBuffer = [[NSMutableData alloc] init];

    memset(&_recordState, 0, sizeof(DGRecordState));
    _recordState.mSelf = self;

    _recordState.dataFormat.mSampleRate = self.currentSampleRate;
    _recordState.dataFormat.mChannelsPerFrame = 1;
    _recordState.dataFormat.mBitsPerChannel = 16;
    _recordState.dataFormat.mBytesPerPacket =
        (_recordState.dataFormat.mBitsPerChannel / 8) *
        _recordState.dataFormat.mChannelsPerFrame;
    _recordState.dataFormat.mBytesPerFrame =
        _recordState.dataFormat.mBytesPerPacket;
    _recordState.dataFormat.mFramesPerPacket = 1;
    _recordState.dataFormat.mReserved = 0;
    _recordState.dataFormat.mFormatID = kAudioFormatLinearPCM;
    _recordState.dataFormat.mFormatFlags =
        kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
    _recordState.currentPacket = 0;
    _recordState.isRunning = true;

    const double targetSecondsPerChunk = 0.2; // ≈200 ms of audio
    UInt32 defaultChunkSize =
        (UInt32)MAX(1, (int)round(_recordState.dataFormat.mSampleRate *
                                  _recordState.dataFormat.mBytesPerFrame *
                                  targetSecondsPerChunk));
    self.chunkSizeBytes = defaultChunkSize;
    _recordState.bufferByteSize = (UInt32)self.chunkSizeBytes;
    DGLogDebug(@"[Deepgram] startRecording: bufferByteSize=%u (chunkSize=%lu)",
               (unsigned int)_recordState.bufferByteSize,
               (unsigned long)self.chunkSizeBytes);

    OSStatus status =
        AudioQueueNewInput(&_recordState.dataFormat, DGHandleInputBuffer,
                           &_recordState, NULL, NULL, 0, &_recordState.queue);

    if (status != noErr) {
      NSError *error = DGOSStatusError(@"AudioQueueNewInput", status);
      NSString *message = error.localizedDescription;
      DGLogError(@"[Deepgram] startRecording: %@", message);
      [self cleanupRecordingQueue];
      DGRejectPromise(reject, @"start_error", message, error);
      return;
    }

    AudioStreamBasicDescription actualFormat;
    UInt32 actualFormatSize = sizeof(actualFormat);
    status = AudioQueueGetProperty(_recordState.queue,
                                   kAudioQueueProperty_StreamDescription,
                                   &actualFormat, &actualFormatSize);
    if (status == noErr) {
      int resolvedSampleRate = (int)llround(actualFormat.mSampleRate);
      DGLogDebug(@"[Deepgram] startRecording: actual sampleRate=%f (%d)",
                 actualFormat.mSampleRate, resolvedSampleRate);
      if (resolvedSampleRate > 0) {
        self.currentSampleRate = resolvedSampleRate;
      }

      UInt32 bytesPerFrame = actualFormat.mBytesPerFrame
                                 ? actualFormat.mBytesPerFrame
                                 : _recordState.dataFormat.mBytesPerFrame;
      UInt32 adaptiveChunk =
          (UInt32)MAX(1, (int)round(actualFormat.mSampleRate * bytesPerFrame *
                                    targetSecondsPerChunk));
      if (adaptiveChunk > 0 && adaptiveChunk != self.chunkSizeBytes) {
        self.chunkSizeBytes = adaptiveChunk;
        _recordState.bufferByteSize = adaptiveChunk;
        DGLogDebug(@"[Deepgram] startRecording: adjusted chunkSize=%lu",
                   (unsigned long)self.chunkSizeBytes);
      }
    } else {
      DGLogError(
          @"[Deepgram] startRecording: failed to read stream description %d",
          (int)status);
    }

    for (int i = 0; i < DGNumberBuffers; i++) {
      status = AudioQueueAllocateBuffer(_recordState.queue,
                                        _recordState.bufferByteSize,
                                        &_recordState.buffers[i]);
      if (status != noErr) {
        NSError *error = DGOSStatusError(@"AudioQueueAllocateBuffer", status);
        NSString *message = error.localizedDescription;
        DGLogError(@"[Deepgram] startRecording: %@", message);
        [self cleanupRecordingQueue];
        DGRejectPromise(reject, @"start_error", message, error);
        return;
      }

      status = AudioQueueEnqueueBuffer(_recordState.queue,
                                       _recordState.buffers[i], 0, NULL);
      if (status != noErr) {
        NSError *error = DGOSStatusError(@"AudioQueueEnqueueBuffer", status);
        NSString *message = error.localizedDescription;
        DGLogError(@"[Deepgram] startRecording: %@", message);
        [self cleanupRecordingQueue];
        DGRejectPromise(reject, @"start_error", message, error);
        return;
      }
    }

    // Open the WAV target before capture starts so the first buffers are teed
    // to disk and any file-open failure is surfaced before the mic opens.
    NSError *fileError = nil;
    if (![self beginRecordingToFileIfRequested:recordToFileOptions
                                         error:&fileError]) {
      DGLogError(@"[Deepgram] startRecording: record-to-file failed %@",
                 fileError);
      [self cleanupRecordingQueue];
      DGRejectPromise(reject, @"start_error", fileError.localizedDescription,
                      fileError);
      return;
    }

    status = AudioQueueStart(_recordState.queue, NULL);
    if (status != noErr) {
      NSError *error = DGOSStatusError(@"AudioQueueStart", status);
      NSString *message = error.localizedDescription;
      DGLogError(@"[Deepgram] startRecording: %@", message);
      [self discardRecordingFile];
      [self cleanupRecordingQueue];
      DGRejectPromise(reject, @"start_error", message, error);
      return;
    }

    DGLogDebug(@"[Deepgram] startRecording: success");
    self.audioQueueCaptureRequested = NO;
    if (resolve)
      resolve(nil);
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] startRecording: exception %@", e);
    [self cleanupRecordingQueue];
    NSString *message = e.reason ?: @"Deepgram native exception";
    NSError *error = DGNativeError(@"DeepgramNativeException", 0, message);
    DGRejectPromise(reject, @"start_error", message, error);
  }
}

RCT_EXPORT_METHOD(stopRecording : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    DGLogDebug(@"[Deepgram] stopRecording: begin");
    [self stopEngineCapture];
    [self cleanupRecordingQueue];
    [self flushPendingPCM];
    self.pendingPCMBuffer = nil;
    self.voiceProcessingRequested = NO;
    NSString *recordingUri = [self finishRecordingToFile];
    [self maybeDeactivateAudioSession];
    DGLogDebug(@"[Deepgram] stopRecording: finished");
    if (resolve)
      resolve(recordingUri ? @{@"recordingUri" : recordingUri} : nil);
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] stopRecording: exception %@", e);
    [self discardRecordingFile];
    DGRejectPromise(reject, @"stop_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(startAudio : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    DGLogDebug(@"[Deepgram] startAudio: begin");
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription
                              ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] startAudio: activation failed %@", message);
      if (reject)
        reject(@"audio_start_error", message, sessionError);
      return;
    }
    if (self.currentSampleRate <= 0) {
      self.currentSampleRate = 16000;
      DGLogDebug(@"[Deepgram] startAudio: default sample rate applied %d",
                 self.currentSampleRate);
    }
    DGLogDebug(@"[Deepgram] startAudio: success");
    if (resolve)
      resolve(nil);
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] startAudio: exception %@", e);
    DGRejectPromise(reject, @"audio_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopAudio : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    DGLogDebug(@"[Deepgram] stopAudio: begin");
    [self stopPlayer:nil rejecter:nil];
    DGLogDebug(@"[Deepgram] stopAudio: success");
    if (resolve)
      resolve(nil);
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] stopAudio: exception %@", e);
    DGRejectPromise(reject, @"audio_stop_error", e.reason, nil);
  }
}

// MARK: - TTS / Voice Agent playback lives in Deepgram+Playback.mm
//         (stopAndDetachPlayerNode / interruptPlayerPlayback /
//          setupAudioEngineWithSampleRate / createPCMBufferFromData)

RCT_EXPORT_METHOD(startPlayer : (nonnull NSNumber *)
                      sampleRate channels : (nonnull NSNumber *)channels) {
  if (!self.engineCaptureActive) {
    [self stopPlayer:nil rejecter:nil];
  }

  NSError *sessionError = nil;
  if (![self activateAudioSession:&sessionError]) {
    DGLogWarn(@"[Deepgram] Unable to activate audio session: %@", sessionError);
    return;
  }

  NSError *engineError = nil;
  // Voice processing (hardware echo cancellation) is only useful when we
  // are also recording the microphone (Voice Agent duplex). Enabling it
  // for pure TTS playback would force the input node open and can trip
  // the system microphone indicator on some iOS versions.
  BOOL needsVoiceProcessing = _recordState.isRunning ||
                              self.engineCaptureActive ||
                              self.voiceProcessingRequested;
  if (![self setupAudioEngineWithSampleRate:sampleRate.intValue
                                   channels:channels.intValue
                      enableVoiceProcessing:needsVoiceProcessing
                                      error:&engineError]) {
    DGLogError(@"[Deepgram] Failed to setup audio engine: %@", engineError);
    return;
  }

  self.isPlaying = NO;
  self.currentSampleRate = sampleRate.intValue;
}

/**
 * Feed base64-encoded PCM audio data for playback using AVAudioEngine.
 * Uses real-time PCM buffer streaming instead of WAV files.
 */
RCT_EXPORT_METHOD(feedAudio : (NSString *)b64) {
  @try {
    if (!self.playerNode || !self.audioEngine || !self.audioEngine.isRunning) {
      return;
    }

    // Safety: prevent unbounded memory growth if JS sends faster than playback
    // 500 chunks * 200ms approx = 100 seconds of buffered audio.
    // If we exceed this, we are likely leaking or hopelessly behind.
    if (_scheduledBufferCount > 500) {
      static dispatch_once_t onceToken;
      dispatch_once(&onceToken, ^{
        DGLogWarn(@"[Deepgram] feedAudio: dropping audio chunks (buffer full > "
                  @"500). App might be receiving audio faster than playback.");
      });
      return;
    }

    NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:b64
                                                          options:0];
    if (!pcmData || pcmData.length == 0) {
      return;
    }

    AVAudioPCMBuffer *buffer = [self createPCMBufferFromData:pcmData];
    if (!buffer) {
      DGLogError(@"[Deepgram] feedAudio: failed to create PCM buffer");
      return;
    }

    _scheduledBufferCount++;
    int playbackGeneration = _playbackGeneration.load();
    __weak Deepgram *weakSelf = self;
    [self.playerNode scheduleBuffer:buffer
                  completionHandler:^{
                    Deepgram *strongSelf = weakSelf;
                    if (strongSelf) {
                      if (strongSelf->_playbackGeneration.load() !=
                          playbackGeneration) {
                        return;
                      }

                      int remaining = --strongSelf->_scheduledBufferCount;
                      if (remaining <= 0) {
                        strongSelf.isPlaying = NO;
                        [strongSelf maybeDeactivateAudioSession];
                      }
                    }
                  }];

    if (!self.playerNode.isPlaying) {
      self.isPlaying = YES;
      [self.playerNode play];
    } else {
      self.isPlaying = YES;
    }
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] feedAudio: exception %@", e);
  }
}

RCT_EXPORT_METHOD(interruptAudio) {
  @try {
    [self interruptPlayerPlayback];
    [self maybeDeactivateAudioSession];
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] interruptAudio: exception %@", e);
  }
}

/**
 * Stop audio playback and cleanup AVAudioEngine.
 */
RCT_EXPORT_METHOD(stopPlayer : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    BOOL preserveCaptureEngine = self.engineCaptureActive;

    if (self.audioEngine) {
      if (self.audioEngine.isRunning) {
        [self.audioEngine stop];
      }

      [self stopAndDetachPlayerNode];

      if (preserveCaptureEngine) {
        [self.audioEngine prepare];
        NSError *restartError = nil;
        if (![self.audioEngine startAndReturnError:&restartError]) {
          DGLogWarn(@"[Deepgram] stopPlayer: failed to restart capture engine: %@",
                    restartError);
        }
      } else {
        [self.audioEngine reset];
        self.audioEngine = nil;
      }
    } else {
      [self stopAndDetachPlayerNode];
    }

    [self maybeDeactivateAudioSession];

    if (resolve)
      resolve(nil);
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] stopPlayer: exception %@", e);
    DGRejectPromise(reject, @"stop_player_error", e.reason, nil);
  }
}

/**
 * Set audio configuration (compatibility method).
 */
RCT_EXPORT_METHOD(setAudioConfig : (nonnull NSNumber *)
                      sampleRate channels : (nonnull NSNumber *)channels) {
  DGLogDebug(@"[Deepgram] setAudioConfig: sampleRate=%@ channels=%@",
             sampleRate, channels);
  [self startPlayer:sampleRate channels:channels];
}

/**
 * Enable / disable microphone audio-level (metering) events. When enabled the
 * module emits `DeepgramAudioLevel` events with a normalized RMS amplitude
 * (0..1) at most once per `intervalMs` (default 100 ms). Purely additive — the
 * mic capture path and PCM emission are unaffected.
 */
RCT_EXPORT_METHOD(setMeteringEnabled : (BOOL)enabled intervalMs : (nonnull NSNumber *)
                      intervalMs) {
  double ms = [intervalMs doubleValue];
  if (ms <= 0) {
    ms = 100.0; // sensible ~10 Hz default
  }
  self.meteringEnabled = enabled;
  self.meteringIntervalSeconds = ms / 1000.0;
  self.lastMeterEmitTime = 0;
  DGLogDebug(@"[Deepgram] setMeteringEnabled: enabled=%@ intervalMs=%.0f",
             enabled ? @"YES" : @"NO", ms);
}

/**
 * Request a preferred output route for playback (`speaker` / `earpiece` /
 * `bluetooth` / `auto`). Best-effort and device-dependent: the OS can
 * override the request (a wired headset always wins) and `bluetooth` only
 * engages when a compatible headset is connected. Implementation lives in
 * Deepgram+AudioSession.mm (`applyAudioRoute:error:`).
 */
RCT_EXPORT_METHOD(setAudioRoute : (NSString *)route resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    static NSSet<NSString *> *validRoutes;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      validRoutes = [NSSet
          setWithObjects:@"speaker", @"earpiece", @"bluetooth", @"auto", nil];
    });
    if (!route || ![validRoutes containsObject:route]) {
      DGRejectPromise(
          reject, @"invalid_data",
          [NSString stringWithFormat:@"Unknown audio route '%@'", route], nil);
      return;
    }
    NSError *error = nil;
    if (![self applyAudioRoute:route error:&error]) {
      DGRejectPromise(reject, @"playback_error",
                      error.localizedDescription
                          ?: @"Failed to apply audio route",
                      error);
      return;
    }
    [self emitRouteChange];
    resolve(nil);
  } @catch (NSException *e) {
    DGRejectPromise(reject, @"playback_error", e.reason, nil);
  }
}

/**
 * Resolve the output route the system is currently using (`speaker` /
 * `earpiece` / `bluetooth` / `wired`). Reflects the *actual* route, which may
 * differ from the last `setAudioRoute` request.
 */
RCT_EXPORT_METHOD(getAudioRoute : (RCTPromiseResolveBlock)
                      resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    resolve([self currentAudioRouteString]);
  } @catch (NSException *e) {
    DGRejectPromise(reject, @"playback_error", e.reason, nil);
  }
}

/**
 * Play a single audio chunk (base64-encoded PCM).
 * This is used for one-shot TTS playback (HTTP mode).
 */
RCT_EXPORT_METHOD(playAudioChunk : (NSString *)b64 resolver : (
    RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject) {
  @try {
    if (!b64 || b64.length == 0) {
      if (reject)
        reject(@"invalid_data", @"Empty audio chunk", nil);
      return;
    }

    NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:b64
                                                          options:0];
    if (!pcmData || pcmData.length == 0) {
      if (reject)
        reject(@"invalid_data", @"Failed to decode audio chunk", nil);
      return;
    }

    // Activate audio session
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription
                              ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] playAudioChunk: activation failed %@", message);
      if (reject)
        reject(@"playback_error", message, sessionError);
      return;
    }

    // Determine sample rate and channels from the audio data
    // For linear16 PCM, assume 24kHz mono (2 bytes per sample)
    int sampleRate =
        self.currentSampleRate > 0 ? self.currentSampleRate : 24000;
    int channels = 1;

    // Setup audio engine if needed
    if (!self.audioEngine || !self.audioEngine.isRunning) {
      NSError *engineError = nil;
      // One-shot HTTP TTS playback never needs voice processing.
      if (![self setupAudioEngineWithSampleRate:sampleRate
                                       channels:channels
                          enableVoiceProcessing:NO
                                          error:&engineError]) {
        DGLogError(
            @"[Deepgram] playAudioChunk: failed to setup audio engine: %@",
            engineError);
        if (reject)
          reject(@"playback_error", @"Failed to setup audio engine",
                 engineError);
        return;
      }
    }

    // Create PCM buffer and schedule for playback
    AVAudioPCMBuffer *buffer = [self createPCMBufferFromData:pcmData];
    if (!buffer) {
      DGLogError(@"[Deepgram] playAudioChunk: failed to create PCM buffer");
      if (reject)
        reject(@"invalid_data", @"Failed to create PCM buffer", nil);
      return;
    }

    self.isPlaying = YES;
    _scheduledBufferCount++;
    int playbackGeneration = _playbackGeneration.load();

    // Schedule buffer with completion handler to resolve promise. The session
    // teardown is guarded by the playback generation and remaining buffer count
    // (mirroring feedAudio) so a one-shot finishing mid-stream cannot deactivate
    // the audio session while streaming playback is still active.
    __weak Deepgram *weakSelf = self;
    [self.playerNode scheduleBuffer:buffer
                  completionHandler:^{
                    Deepgram *strongSelf = weakSelf;
                    if (strongSelf &&
                        strongSelf->_playbackGeneration.load() ==
                            playbackGeneration) {
                      int remaining = --strongSelf->_scheduledBufferCount;
                      if (remaining <= 0) {
                        strongSelf.isPlaying = NO;
                        [strongSelf maybeDeactivateAudioSession];
                      }
                    }
                    if (resolve)
                      resolve(nil);
                  }];

    // Start playing if not already playing
    if (!self.playerNode.isPlaying) {
      [self.playerNode play];
    }

    DGLogDebug(@"[Deepgram] playAudioChunk: scheduled %lu bytes for playback",
               (unsigned long)pcmData.length);
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] playAudioChunk: exception %@", e);
    DGRejectPromise(reject, @"playback_error", e.reason, nil);
  }
}

- (void)invalidate {
  DGLogDebug(@"[Deepgram] invalidate: begin");

  @try {
    [self cleanupRecordingQueue];
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] invalidate: cleanupRecordingQueue exception %@", e);
  }

  [self discardRecordingFile];

  self.pendingPCMBuffer = nil;

  if (self.playerNode) {
    [self.playerNode stop];
    self.playerNode = nil;
  }

  if (self.audioEngine && self.audioEngine.isRunning) {
    [self.audioEngine stop];
  }
  self.audioEngine = nil;
  self.playbackFormat = nil;

  self.isPlaying = NO;
  self.hasListeners = NO;
  self.appIsActive = NO;

  [self maybeDeactivateAudioSession];

  DGLogDebug(@"[Deepgram] invalidate: finished");
  [super invalidate];
}

@end
