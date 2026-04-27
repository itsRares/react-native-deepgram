#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>
#import <TargetConditionals.h>
#if TARGET_OS_IOS
#import <UIKit/UIKit.h>
#endif
#include <math.h>
#include <string.h>
#include <atomic>

#define DGNumberBuffers 3

#ifndef DG_ENABLE_DEBUG_LOGS
#define DG_ENABLE_DEBUG_LOGS 0
#endif

#if DG_ENABLE_DEBUG_LOGS
#define DGLogDebug(...) NSLog(__VA_ARGS__)
#else
#define DGLogDebug(...)
#endif

#define DGLogWarn(...) RCTLogWarn(__VA_ARGS__)
#define DGLogError(...) RCTLogError(__VA_ARGS__)

@class Deepgram;

typedef struct {
  __unsafe_unretained Deepgram *mSelf;
  AudioStreamBasicDescription dataFormat;
  AudioQueueRef queue;
  AudioQueueBufferRef buffers[DGNumberBuffers];
  UInt32 bufferByteSize;
  SInt64 currentPacket;
  bool isRunning;
} DGRecordState;

@interface Deepgram : RCTEventEmitter
{
  DGRecordState _recordState;
  std::atomic<int> _scheduledBufferCount;
}

// Recording
@property (nonatomic, strong) NSMutableData      *pendingPCMBuffer;
@property (nonatomic, strong) dispatch_queue_t    emitterQueue;
@property (nonatomic, assign) NSUInteger           chunkSizeBytes;
@property (atomic, assign) BOOL                    hasListeners;
@property (atomic, assign) BOOL                    appIsActive;

// Playback / TTS (AVAudioEngine-based with echo cancellation)
@property (nonatomic, strong) AVAudioEngine      *audioEngine;
@property (nonatomic, strong) AVAudioPlayerNode  *playerNode;
@property (nonatomic, strong) AVAudioFormat      *playbackFormat;
@property (atomic,    assign) BOOL                isPlaying;
@property (atomic,    assign) int                 currentSampleRate;
@property (nonatomic, assign) BOOL                audioSessionConfigured;
// YES while we're capturing the microphone through `audioEngine.inputNode`
// (Voice Agent / duplex). When YES, the AudioQueue path is bypassed and the
// session must use VoiceChat mode so Apple's Voice-Processing I/O Audio Unit
// engages and performs hardware echo cancellation.
@property (atomic,    assign) BOOL                engineCaptureActive;
@property (atomic,    assign) BOOL                voiceProcessingRequested;
@property (nonatomic, strong) AVAudioConverter   *captureConverter;
@property (nonatomic, strong) AVAudioFormat      *captureOutputFormat;
@end

@interface Deepgram (RecordingPrivate)
- (void)appendPCMDataAndEmitIfNeeded:(NSData *)pcmData;
- (BOOL)activateAudioSession:(NSError **)outError;
- (BOOL)configureAudioSessionIfNeeded:(NSError **)outError;
- (BOOL)configureAudioSession:(NSError **)outError;
- (void)maybeDeactivateAudioSession;
@end

static void DGHandleInputBuffer(void *inUserData,
                                __unused AudioQueueRef inAQ,
                                AudioQueueBufferRef inBuffer,
                                __unused const AudioTimeStamp *inStartTime,
                                __unused UInt32 inNumPackets,
                                __unused const AudioStreamPacketDescription *inPacketDesc)
{
  @autoreleasepool {
    DGRecordState *state = (DGRecordState *)inUserData;
    if (!state || !state->isRunning) {
      DGLogDebug(@"[Deepgram] DGHandleInputBuffer: inactive state");
      return;
    }

    Deepgram *strongSelf = state->mSelf;
    if (!strongSelf) {
      DGLogDebug(@"[Deepgram] DGHandleInputBuffer: missing self");
      return;
    }

    if (!inBuffer || inBuffer->mAudioDataByteSize == 0) {
      DGLogDebug(@"[Deepgram] DGHandleInputBuffer: empty buffer");
      return;
    }

    DGLogDebug(@"[Deepgram] DGHandleInputBuffer: received %u bytes",
          (unsigned int)inBuffer->mAudioDataByteSize);
    NSData *data = [NSData dataWithBytes:inBuffer->mAudioData
                                   length:inBuffer->mAudioDataByteSize];
    [strongSelf appendPCMDataAndEmitIfNeeded:data];

    if (state->queue) {
      DGLogDebug(@"[Deepgram] DGHandleInputBuffer: re-enqueue buffer");
      AudioQueueEnqueueBuffer(state->queue, inBuffer, 0, NULL);
    }
  }
}

@implementation Deepgram
RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"DeepgramAudioPCM" ];
}

- (void)startObserving
{
  DGLogDebug(@"[Deepgram] startObserving: listeners attached");
  self.hasListeners = YES;
}

- (void)stopObserving
{
  DGLogDebug(@"[Deepgram] stopObserving: listeners detached");
  self.hasListeners = NO;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
- (instancetype)init
{
  if (self = [super init]) {
    _chunkSizeBytes = 6400; // ≈200 ms of 16 kHz mono PCM16 audio
    DGLogDebug(@"[Deepgram] init: chunkSizeBytes=%lu", (unsigned long)_chunkSizeBytes);
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
    DGLogDebug(@"[Deepgram] init: registered for UIApplicationDidBecomeActiveNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAppDidEnterBackground:)
               name:UIApplicationDidEnterBackgroundNotification
             object:nil];
    DGLogDebug(@"[Deepgram] init: registered for UIApplicationDidEnterBackgroundNotification");
#endif
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAudioRouteChange:)
                name:AVAudioSessionRouteChangeNotification
              object:nil];
    DGLogDebug(@"[Deepgram] init: registered for AVAudioSessionRouteChangeNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAudioInterruption:)
                name:AVAudioSessionInterruptionNotification
              object:nil];
    DGLogDebug(@"[Deepgram] init: registered for AVAudioSessionInterruptionNotification");
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleMediaServicesReset:)
                name:AVAudioSessionMediaServicesWereResetNotification
              object:nil];
    DGLogDebug(@"[Deepgram] init: registered for AVAudioSessionMediaServicesWereResetNotification");
  }
  return self;
}

- (void)dealloc
{
  DGLogDebug(@"[Deepgram] dealloc: cleaning up recording queue and removing observers");
  [self cleanupRecordingQueue];
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (BOOL)activateAudioSession:(NSError **)outError
{
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
    DGLogDebug(@"[Deepgram] activateAudioSession: success=%@", success ? @"YES" : @"NO");
  }

  if (outError) {
    *outError = activationError;
  }

  return success;
}

- (void)deactivateAudioSession
{
  DGLogDebug(@"[Deepgram] deactivateAudioSession: begin");
  NSError *error = nil;
  // Use NotifyOthersOnDeactivation so other audio sessions (expo-av, etc.)
  // know they can resume.
  if (![[AVAudioSession sharedInstance] setActive:NO
                                      withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                            error:&error] && error) {
    DGLogError(@"[Deepgram] Failed to deactivate audio session: %@",
          error.localizedDescription ?: error);
  }
  self.audioSessionConfigured = NO;
}

- (BOOL)configureAudioSessionIfNeeded:(NSError **)outError
{
  if (!self.audioSessionConfigured) {
    DGLogDebug(@"[Deepgram] configureAudioSessionIfNeeded: not configured, configuring");
    return [self configureAudioSession:outError];
  }

  DGLogDebug(@"[Deepgram] configureAudioSessionIfNeeded: already configured, ensuring active");
  NSError *activeError = nil;
  BOOL success = [[AVAudioSession sharedInstance] setActive:YES error:&activeError];
  if (!success || activeError) {
    self.audioSessionConfigured = NO;
    if (outError) {
      *outError = activeError;
    }
  }
  return success;
}

- (BOOL)configureAudioSession:(NSError **)outError
{
  BOOL needsMic = _recordState.isRunning || self.engineCaptureActive;
  return [self configureAudioSessionForRecording:needsMic error:outError];
}

/**
 * Configure audio session with mode appropriate to current usage.
 * Uses MixWithOthers to avoid interfering with other packages (expo-av, etc.).
 * Only uses VoiceChat mode when both recording and playback are active simultaneously.
 */
- (BOOL)configureAudioSessionForRecording:(BOOL)needsMicrophone error:(NSError **)outError
{
  DGLogDebug(@"[Deepgram] configureAudioSession: begin (mic=%@)", needsMicrophone ? @"YES" : @"NO");
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  // Use MixWithOthers to coexist with other audio packages (expo-av, etc.)
  AVAudioSessionCategoryOptions options = AVAudioSessionCategoryOptionMixWithOthers |
                                           AVAudioSessionCategoryOptionDefaultToSpeaker;

  // iOS 17 deprecated `AllowBluetooth` (HFP route) in favor of
  // `AllowBluetoothHFP`. Prefer the new symbol when building against the iOS
  // 17+ SDK and fall back to the legacy spelling on older toolchains.
#if defined(__IPHONE_17_0) && (__IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_17_0)
  if (@available(iOS 17.0, *)) {
    options |= AVAudioSessionCategoryOptionAllowBluetoothHFP;
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    options |= AVAudioSessionCategoryOptionAllowBluetooth;
#pragma clang diagnostic pop
  }
#else
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  options |= AVAudioSessionCategoryOptionAllowBluetooth;
#pragma clang diagnostic pop
#endif
  options |= AVAudioSessionCategoryOptionAllowBluetoothA2DP;
  options |= AVAudioSessionCategoryOptionAllowAirPlay;

  AVAudioSessionCategory category;
  NSString *mode;

  if (needsMicrophone) {
    // When recording, we need PlayAndRecord. Use VoiceChat mode whenever we
    // also need echo cancellation (engine-based capture for the Voice Agent,
    // or playback while recording). Apple's hardware AEC (VPIO) only kicks in
    // when the session mode is VoiceChat or VideoChat.
    category = AVAudioSessionCategoryPlayAndRecord;
    BOOL needsAEC = self.engineCaptureActive || self.voiceProcessingRequested || self.isPlaying;
    mode = needsAEC ? AVAudioSessionModeVoiceChat : AVAudioSessionModeDefault;
  } else {
    // Playback only — use Playback category to avoid audio route conflicts
    category = AVAudioSessionCategoryPlayback;
    mode = AVAudioSessionModeDefault;
  }

  BOOL categorySuccess = NO;

  DGLogDebug(@"[Deepgram] configureAudioSession: setCategory %@ mode %@", category, mode);
  categorySuccess = [session setCategory:category
                                   mode:mode
                                options:options
                                  error:&error];

  if (!categorySuccess || error) {
    DGLogError(@"[Deepgram] configureAudioSession: category failed error=%@",
          error.localizedDescription ?: error);
    if (outError) {
      *outError = error;
    }
    self.audioSessionConfigured = NO;
    return NO;
  }

  NSError *activeError = nil;
  BOOL activeSuccess = [session setActive:YES error:&activeError];
  if (!activeSuccess && activeError) {
    DGLogError(@"[Deepgram] configureAudioSession: setActive failed error=%@",
          activeError.localizedDescription ?: activeError);
    if (outError) {
      *outError = activeError;
    }
    self.audioSessionConfigured = NO;
    return NO;
  }

  self.audioSessionConfigured = YES;
  DGLogDebug(@"[Deepgram] configureAudioSession: success");
  return YES;
}

- (void)maybeDeactivateAudioSession
{
  DGLogDebug(@"[Deepgram] maybeDeactivateAudioSession: running=%@ playing=%@ engineCapture=%@",
        _recordState.isRunning ? @"YES" : @"NO",
        self.isPlaying ? @"YES" : @"NO",
        self.engineCaptureActive ? @"YES" : @"NO");
  if (!_recordState.isRunning && !self.isPlaying && !self.engineCaptureActive) {
    DGLogDebug(@"[Deepgram] maybeDeactivateAudioSession: deactivating");
    [self deactivateAudioSession];
  }
}

- (void)handleAudioRouteChange:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleAudioRouteChange: %@", note.userInfo);
  NSNumber *reasonValue = note.userInfo[AVAudioSessionRouteChangeReasonKey];
  AVAudioSessionRouteChangeReason reason = reasonValue
                                                 ? (AVAudioSessionRouteChangeReason)
                                                       reasonValue.unsignedIntegerValue
                                                 : AVAudioSessionRouteChangeReasonUnknown;

  // Headphones / Bluetooth headset unplugged — pause playback so we don't
  // surprise the user by suddenly blasting through the loud speaker.
  // (System would route audio to the speaker automatically; that's the point
  // of this notification.) Matches expo-audio behavior and Apple's guidance.
  if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: old device unavailable — pausing playback");
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
    DGLogDebug(@"[Deepgram] handleAudioRouteChange: category change detected, keeping session");
    return;
  }

  DGLogDebug(@"[Deepgram] handleAudioRouteChange: reactivating session");
  [self activateAudioSession:NULL];
}

// AVAudioSession can post this when mediaserverd restarts (e.g. after a
// rare system audio HAL hiccup). Once it fires, every AudioQueue / AVAudioEngine
// instance becomes a zombie. Apple's documented fix is to throw everything
// away and rebuild on demand. Match expo-audio's approach.
- (void)handleMediaServicesReset:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleMediaServicesReset: tearing down audio stack");
  self.audioSessionConfigured = NO;

  // Recording queue must be torn down — it's a zombie after a media services reset.
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
    DGLogError(@"[Deepgram] handleMediaServicesReset: teardown exception %@", e);
  }
  self.playerNode = nil;
  self.audioEngine = nil;
  self.isPlaying = NO;
}

- (void)handleAudioInterruption:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleAudioInterruption: %@", note.userInfo);
  NSNumber *typeValue = note.userInfo[AVAudioSessionInterruptionTypeKey];
  AVAudioSessionInterruptionType type = (AVAudioSessionInterruptionType)typeValue.unsignedIntegerValue;

  if (type == AVAudioSessionInterruptionTypeBegan) {
    DGLogDebug(@"[Deepgram] handleAudioInterruption: interruption began");
    if (_recordState.isRunning && _recordState.queue) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: pausing recording queue");
      AudioQueuePause(_recordState.queue);
    }
    if (self.isPlaying && self.playerNode) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: pausing player node");
      [self.playerNode pause];
    }
  } else if (type == AVAudioSessionInterruptionTypeEnded) {
    DGLogDebug(@"[Deepgram] handleAudioInterruption: interruption ended");
    NSNumber *optionValue = note.userInfo[AVAudioSessionInterruptionOptionKey];
    AVAudioSessionInterruptionOptions options = (AVAudioSessionInterruptionOptions)optionValue.unsignedIntegerValue;
    if (options & AVAudioSessionInterruptionOptionShouldResume) {
      DGLogDebug(@"[Deepgram] handleAudioInterruption: should resume");
      [self activateAudioSession:nil];
      
      if (_recordState.isRunning && _recordState.queue) {
        DGLogDebug(@"[Deepgram] handleAudioInterruption: resuming recording queue");
        AudioQueueStart(_recordState.queue, NULL);
      }
      if (self.isPlaying && self.playerNode) {
        DGLogDebug(@"[Deepgram] handleAudioInterruption: resuming player node");
        [self.playerNode play];
      }
    }
  }
}

#if TARGET_OS_IOS
- (void)handleAppDidBecomeActive:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleAppDidBecomeActive: %@", note.userInfo);
  self.appIsActive = YES;

  if (_recordState.isRunning || self.isPlaying || self.engineCaptureActive) {
    DGLogDebug(@"[Deepgram] handleAppDidBecomeActive: reactivating session");
    [self activateAudioSession:NULL];
  }
}

- (void)handleAppDidEnterBackground:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleAppDidEnterBackground: %@", note.userInfo);
  self.appIsActive = NO;
}
#endif

- (void)emitPCMChunk:(NSData *)chunk sampleRate:(int)sampleRate
{
  if (!chunk || chunk.length == 0) {
    DGLogDebug(@"[Deepgram] emitPCMChunk: empty chunk, skipping");
    return;
  }

  __weak __typeof(self) weakSelf = self;
  NSData *chunkCopy = [chunk copy];
  dispatch_queue_t queue = self.emitterQueue ?: dispatch_get_main_queue();
  dispatch_async(queue, ^{
    if (!weakSelf) {
      DGLogDebug(@"[Deepgram] emitPCMChunk: self released, aborting");
      return;
    }

    if (!weakSelf.hasListeners) {
      DGLogDebug(@"[Deepgram] emitPCMChunk: no listeners, dropping %lu bytes",
            (unsigned long)chunkCopy.length);
      return;
    }

    if (!weakSelf.bridge || !weakSelf.callableJSModules) {
      DGLogDebug(@"[Deepgram] Skipping DeepgramAudioPCM event (bridge not ready)");
      return;
    }

    DGLogDebug(@"[Deepgram] emitPCMChunk: sending %lu bytes sampleRate=%d",
          (unsigned long)chunkCopy.length,
          sampleRate);
    NSString *b64 = [chunkCopy base64EncodedStringWithOptions:0];
    [weakSelf sendEventWithName:@"DeepgramAudioPCM"
                           body:@{ @"b64": b64, @"sampleRate": @(sampleRate) }];
  });
}

- (void)appendPCMDataAndEmitIfNeeded:(NSData *)pcmData
{
  if (!pcmData || pcmData.length == 0) {
    DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: empty PCM, skipping");
    return;
  }

  if (!self.pendingPCMBuffer) {
    DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: allocate pending buffer");
    self.pendingPCMBuffer = [[NSMutableData alloc] init];
  }

  DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: append %lu bytes (pending=%lu)",
        (unsigned long)pcmData.length,
        (unsigned long)self.pendingPCMBuffer.length);
  [self.pendingPCMBuffer appendData:pcmData];

  NSUInteger chunkSize = self.chunkSizeBytes > 0 ? self.chunkSizeBytes : pcmData.length;

  while (self.pendingPCMBuffer.length >= chunkSize) {
    NSData *chunk =
        [self.pendingPCMBuffer subdataWithRange:NSMakeRange(0, chunkSize)];
    [self.pendingPCMBuffer replaceBytesInRange:NSMakeRange(0, chunkSize)
                                     withBytes:NULL
                                        length:0];
    DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: emitting chunk %lu bytes remaining=%lu",
          (unsigned long)chunk.length,
          (unsigned long)self.pendingPCMBuffer.length);
    [self emitPCMChunk:chunk sampleRate:self.currentSampleRate];
  }
}

- (void)flushPendingPCM
{
  if (self.pendingPCMBuffer.length == 0) {
    DGLogDebug(@"[Deepgram] flushPendingPCM: nothing to flush");
    return;
  }

  NSData *remaining = [self.pendingPCMBuffer copy];
  [self.pendingPCMBuffer setLength:0];
  DGLogDebug(@"[Deepgram] flushPendingPCM: flushing %lu bytes",
        (unsigned long)remaining.length);
  [self emitPCMChunk:remaining sampleRate:self.currentSampleRate];
}

- (void)cleanupRecordingQueue
{
  DGLogDebug(@"[Deepgram] cleanupRecordingQueue: begin");
  _recordState.isRunning = false;

  if (_recordState.queue) {
    DGLogDebug(@"[Deepgram] cleanupRecordingQueue: stopping queue");
    AudioQueueStop(_recordState.queue, true);

    for (int i = 0; i < DGNumberBuffers; i++) {
      if (_recordState.buffers[i]) {
        DGLogDebug(@"[Deepgram] cleanupRecordingQueue: freeing buffer %d", i);
        AudioQueueFreeBuffer(_recordState.queue, _recordState.buffers[i]);
        _recordState.buffers[i] = NULL;
      }
    }

    DGLogDebug(@"[Deepgram] cleanupRecordingQueue: disposing queue");
    AudioQueueDispose(_recordState.queue, true);
  }

  memset(&_recordState, 0, sizeof(DGRecordState));
  DGLogDebug(@"[Deepgram] cleanupRecordingQueue: state cleared");
  [self maybeDeactivateAudioSession];
}

/* ================================================================== */
/*  1.  MICROPHONE CAPTURE (16 kHz PCM16 emission)                     */
/* ================================================================== */

/**
 * Engine-based microphone capture path used when the JS side opts in to
 * hardware voice processing (Voice Agent / duplex). This routes through
 * `AVAudioEngine.inputNode` with `setVoiceProcessingEnabled:YES` on both
 * input and output nodes — the only Apple-supported way to actually engage
 * the VPIO Audio Unit's hardware echo cancellation on iOS. The legacy
 * AudioQueue path is preserved for STT-only usage where AEC is undesirable.
 */
- (BOOL)startEngineCaptureAndReturnError:(NSError **)outError
{
  self.currentSampleRate = 16000;

  if (!self.audioEngine) {
    NSError *engineError = nil;
    if (![self setupAudioEngineWithSampleRate:self.currentSampleRate
                                     channels:1
                        enableVoiceProcessing:YES
                                        error:&engineError]) {
      if (outError) *outError = engineError;
      return NO;
    }
  } else {
#if TARGET_IPHONE_SIMULATOR
    // VPIO is unsupported on the simulator and toggling VP corrupts the
    // input node's format (sampleRate becomes 0), which would later fail
    // the IsFormatSampleRateAndChannelCountValid check. Skip entirely.
    DGLogWarn(@"[Deepgram] NOTE: Voice Processing I/O (Echo Cancellation) is NOT supported on the iOS Simulator. Audio output may be picked up by the microphone. Please test on a physical device for proper AEC behavior.");
#else
    @try {
      NSError *vpError = nil;
      if (self.audioEngine.inputNode &&
          ![self.audioEngine.inputNode setVoiceProcessingEnabled:YES error:&vpError]) {
        DGLogWarn(@"[Deepgram] inputNode VP enable failed: %@", vpError);
      }
      if (self.audioEngine.outputNode &&
          ![self.audioEngine.outputNode setVoiceProcessingEnabled:YES error:&vpError]) {
        DGLogWarn(@"[Deepgram] outputNode VP enable failed: %@", vpError);
      }
    } @catch (NSException *e) {
      DGLogWarn(@"[Deepgram] VP enable threw: %@", e);
    }
#endif
  }

  AVAudioInputNode *inputNode = self.audioEngine.inputNode;
  if (!inputNode) {
    if (outError) {
      *outError = [NSError errorWithDomain:@"DeepgramAudioEngine"
                                      code:-2
                                  userInfo:@{NSLocalizedDescriptionKey: @"No input node available"}];
    }
    return NO;
  }

  AVAudioFormat *hwFormat = [inputNode inputFormatForBus:0];
  if (!hwFormat || hwFormat.sampleRate <= 0) {
    if (outError) {
      *outError = [NSError errorWithDomain:@"DeepgramAudioEngine"
                                      code:-3
                                  userInfo:@{NSLocalizedDescriptionKey: @"Invalid input format"}];
    }
    return NO;
  }

  AVAudioFormat *outputFormat =
      [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                        sampleRate:self.currentSampleRate
                                          channels:1
                                       interleaved:YES];
  self.captureOutputFormat = outputFormat;
  self.captureConverter = [[AVAudioConverter alloc] initFromFormat:hwFormat toFormat:outputFormat];
  if (!self.captureConverter) {
    if (outError) {
      *outError = [NSError errorWithDomain:@"DeepgramAudioEngine"
                                      code:-4
                                  userInfo:@{NSLocalizedDescriptionKey: @"Failed to build AVAudioConverter"}];
    }
    return NO;
  }

  AVAudioFrameCount tapFrames = (AVAudioFrameCount)MAX(1024, (NSUInteger)round(hwFormat.sampleRate * 0.2));

  __weak __typeof(self) weakSelf = self;
  @try {
    [inputNode removeTapOnBus:0];
  } @catch (__unused NSException *e) {
    // No prior tap — fine.
  }

  @try {
    [inputNode installTapOnBus:0
                    bufferSize:tapFrames
                        format:hwFormat
                         block:^(AVAudioPCMBuffer * _Nonnull inBuf, __unused AVAudioTime * _Nonnull when) {
      __strong __typeof(weakSelf) strongSelf = weakSelf;
      if (!strongSelf || !strongSelf.engineCaptureActive) return;
      AVAudioConverter *converter = strongSelf.captureConverter;
      AVAudioFormat *outFmt = strongSelf.captureOutputFormat;
      if (!converter || !outFmt || inBuf.frameLength == 0) return;

      AVAudioFrameCount outCapacity =
          (AVAudioFrameCount)ceil((double)inBuf.frameLength * outFmt.sampleRate /
                                  inBuf.format.sampleRate) + 16;
      AVAudioPCMBuffer *outBuf =
          [[AVAudioPCMBuffer alloc] initWithPCMFormat:outFmt frameCapacity:outCapacity];
      if (!outBuf) return;

      __block BOOL provided = NO;
      NSError *cvtError = nil;
      AVAudioConverterInputBlock inputBlock =
          ^AVAudioBuffer * _Nullable(__unused AVAudioPacketCount inNumPackets,
                                     AVAudioConverterInputStatus * _Nonnull outStatus) {
        if (provided) {
          *outStatus = AVAudioConverterInputStatus_NoDataNow;
          return nil;
        }
        provided = YES;
        *outStatus = AVAudioConverterInputStatus_HaveData;
        return inBuf;
      };

      AVAudioConverterOutputStatus status =
          [converter convertToBuffer:outBuf error:&cvtError withInputFromBlock:inputBlock];
      if (status == AVAudioConverterOutputStatus_Error || cvtError) {
        DGLogWarn(@"[Deepgram] capture convert failed: %@", cvtError);
        return;
      }
      if (outBuf.frameLength == 0 || !outBuf.int16ChannelData) return;

      NSUInteger byteCount = (NSUInteger)outBuf.frameLength * 2;
      NSData *pcm = [NSData dataWithBytes:outBuf.int16ChannelData[0] length:byteCount];
      [strongSelf appendPCMDataAndEmitIfNeeded:pcm];
    }];
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] installTapOnBus exception: %@", e);
    if (outError) {
      *outError = [NSError errorWithDomain:@"DeepgramAudioEngine"
                                      code:-5
                                  userInfo:@{NSLocalizedDescriptionKey: e.reason ?: @"Tap install failed"}];
    }
    return NO;
  }

  self.chunkSizeBytes = (NSUInteger)MAX(1, (int)round(self.currentSampleRate * 2 * 0.2));
  self.engineCaptureActive = YES;

  if (!self.audioEngine.isRunning) {
    NSError *startError = nil;
    if (![self.audioEngine startAndReturnError:&startError]) {
      DGLogError(@"[Deepgram] engine start failed: %@", startError);
      @try { [inputNode removeTapOnBus:0]; } @catch (__unused NSException *e) {}
      self.engineCaptureActive = NO;
      if (outError) *outError = startError;
      return NO;
    }
  }
  return YES;
}

- (void)stopEngineCapture
{
  if (!self.engineCaptureActive && !self.captureConverter) return;
  DGLogDebug(@"[Deepgram] stopEngineCapture");
  self.engineCaptureActive = NO;

  @try {
    [self.audioEngine.inputNode removeTapOnBus:0];
  } @catch (NSException *e) {
    DGLogWarn(@"[Deepgram] removeTapOnBus exception: %@", e);
  }

#if !TARGET_IPHONE_SIMULATOR
  @try {
    NSError *vpError = nil;
    if (self.audioEngine.inputNode) {
      [self.audioEngine.inputNode setVoiceProcessingEnabled:NO error:&vpError];
    }
  } @catch (__unused NSException *e) {
    // best-effort
  }
#endif

  self.captureConverter = nil;
  self.captureOutputFormat = nil;

  if (!self.isPlaying && self.audioEngine.isRunning) {
    @try { [self.audioEngine stop]; } @catch (__unused NSException *e) {}
  }
}

RCT_EXPORT_METHOD(startRecording:(NSDictionary *)options
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] startRecording: begin");

    BOOL enableVoiceProcessing = NO;
    if ([options isKindOfClass:[NSDictionary class]]) {
      id raw = options[@"enableVoiceProcessing"];
      if ([raw isKindOfClass:[NSNumber class]]) {
        enableVoiceProcessing = [(NSNumber *)raw boolValue];
      }
    }
    self.voiceProcessingRequested = enableVoiceProcessing;

    self.currentSampleRate = 16000;
    DGLogDebug(@"[Deepgram] startRecording: targetSampleRate=%d vp=%@",
               self.currentSampleRate,
               enableVoiceProcessing ? @"YES" : @"NO");
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] startRecording: activation failed %@", message);
      self.voiceProcessingRequested = NO;
      if (reject) reject(@"record_start_error", message, sessionError);
      return;
    }

    if (enableVoiceProcessing) {
      if (_recordState.isRunning) {
        [self cleanupRecordingQueue];
      }
      [self stopEngineCapture];
      self.pendingPCMBuffer = [[NSMutableData alloc] init];

      NSError *engineError = nil;
      if (![self startEngineCaptureAndReturnError:&engineError]) {
        NSString *message = engineError.localizedDescription ?: @"Failed to start engine capture";
        DGLogError(@"[Deepgram] startRecording: %@", message);
        self.voiceProcessingRequested = NO;
        [self maybeDeactivateAudioSession];
        if (reject) reject(@"record_start_error", message, engineError);
        return;
      }
      DGLogDebug(@"[Deepgram] startRecording: engine capture started");
      if (resolve) resolve(nil);
      return;
    }

    if (_recordState.isRunning) {
      DGLogDebug(@"[Deepgram] startRecording: record state already running, cleaning up");
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

    OSStatus status = AudioQueueNewInput(&_recordState.dataFormat,
                                         DGHandleInputBuffer,
                                         &_recordState,
                                         NULL,
                                         NULL,
                                         0,
                                         &_recordState.queue);

    if (status != noErr) {
      NSString *message =
          [NSString stringWithFormat:@"AudioQueueNewInput failed: %d", (int)status];
      DGLogError(@"[Deepgram] startRecording: %@", message);
      [self cleanupRecordingQueue];
      if (reject) reject(@"record_start_error", message, nil);
      return;
    }

    AudioStreamBasicDescription actualFormat;
    UInt32 actualFormatSize = sizeof(actualFormat);
    status = AudioQueueGetProperty(_recordState.queue,
                                   kAudioQueueProperty_StreamDescription,
                                   &actualFormat,
                                   &actualFormatSize);
    if (status == noErr) {
      int resolvedSampleRate = (int)llround(actualFormat.mSampleRate);
      DGLogDebug(@"[Deepgram] startRecording: actual sampleRate=%f (%d)",
            actualFormat.mSampleRate,
            resolvedSampleRate);
      if (resolvedSampleRate > 0) {
        self.currentSampleRate = resolvedSampleRate;
      }

      UInt32 bytesPerFrame = actualFormat.mBytesPerFrame
                                  ? actualFormat.mBytesPerFrame
                                  : _recordState.dataFormat.mBytesPerFrame;
      UInt32 adaptiveChunk =
          (UInt32)MAX(1, (int)round(actualFormat.mSampleRate * bytesPerFrame * targetSecondsPerChunk));
      if (adaptiveChunk > 0 && adaptiveChunk != self.chunkSizeBytes) {
        self.chunkSizeBytes = adaptiveChunk;
        _recordState.bufferByteSize = adaptiveChunk;
        DGLogDebug(@"[Deepgram] startRecording: adjusted chunkSize=%lu",
              (unsigned long)self.chunkSizeBytes);
      }
    } else {
      DGLogError(@"[Deepgram] startRecording: failed to read stream description %d", (int)status);
    }

    for (int i = 0; i < DGNumberBuffers; i++) {
      status = AudioQueueAllocateBuffer(_recordState.queue,
                                        _recordState.bufferByteSize,
                                        &_recordState.buffers[i]);
      if (status != noErr) {
        NSString *message = [NSString
            stringWithFormat:@"AudioQueueAllocateBuffer failed: %d", (int)status];
        DGLogError(@"[Deepgram] startRecording: %@", message);
        [self cleanupRecordingQueue];
        if (reject) reject(@"record_start_error", message, nil);
        return;
      }

      status = AudioQueueEnqueueBuffer(_recordState.queue,
                                       _recordState.buffers[i],
                                       0,
                                       NULL);
      if (status != noErr) {
        NSString *message = [NSString
            stringWithFormat:@"AudioQueueEnqueueBuffer failed: %d", (int)status];
        DGLogError(@"[Deepgram] startRecording: %@", message);
        [self cleanupRecordingQueue];
        if (reject) reject(@"record_start_error", message, nil);
        return;
      }
    }

    status = AudioQueueStart(_recordState.queue, NULL);
    if (status != noErr) {
      NSString *message =
          [NSString stringWithFormat:@"AudioQueueStart failed: %d", (int)status];
      DGLogError(@"[Deepgram] startRecording: %@", message);
      [self cleanupRecordingQueue];
      if (reject) reject(@"record_start_error", message, nil);
      return;
    }

    DGLogDebug(@"[Deepgram] startRecording: success");
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] startRecording: exception %@", e);
    [self cleanupRecordingQueue];
    if (reject) reject(@"record_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopRecording
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] stopRecording: begin");
    [self stopEngineCapture];
    [self cleanupRecordingQueue];
    [self flushPendingPCM];
    self.pendingPCMBuffer = nil;
    self.voiceProcessingRequested = NO;
    [self maybeDeactivateAudioSession];
    DGLogDebug(@"[Deepgram] stopRecording: finished");
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] stopRecording: exception %@", e);
    if (reject) reject(@"record_stop_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(startAudio
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] startAudio: begin");
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] startAudio: activation failed %@", message);
      if (reject) reject(@"audio_start_error", message, sessionError);
      return;
    }
    if (self.currentSampleRate <= 0) {
      self.currentSampleRate = 16000;
      DGLogDebug(@"[Deepgram] startAudio: default sample rate applied %d", self.currentSampleRate);
    }
    DGLogDebug(@"[Deepgram] startAudio: success");
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] startAudio: exception %@", e);
    if (reject) reject(@"audio_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopAudio
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] stopAudio: begin");
    [self stopPlayer:nil rejecter:nil];
    DGLogDebug(@"[Deepgram] stopAudio: success");
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] stopAudio: exception %@", e);
    if (reject) reject(@"audio_stop_error", e.reason, nil);
  }
}

/* ================================================================== */
/*  2.  AVAUDIOENGINE PLAYBACK WITH VOICE PROCESSING (ECHO CANCEL)    */
/* ================================================================== */

/**
 * Setup AVAudioEngine for output. When `enableVoiceProcessing` is YES we also
 * configure the input node for hardware echo cancellation (Voice Agent /
 * duplex use case). When NO (pure TTS playback), we deliberately avoid
 * touching `inputNode` so we don't request the microphone or interfere with
 * other audio libraries.
 */
- (BOOL)setupAudioEngineWithSampleRate:(int)sampleRate
                              channels:(int)channels
                  enableVoiceProcessing:(BOOL)enableVoiceProcessing
                                 error:(NSError **)outError {
  if (self.audioEngine && self.audioEngine.isRunning) {
    [self.audioEngine stop];
  }
  
  self.audioEngine = [[AVAudioEngine alloc] init];
  self.playerNode = [[AVAudioPlayerNode alloc] init];
  
  self.playbackFormat = [[AVAudioFormat alloc]
                         initWithCommonFormat:AVAudioPCMFormatInt16
                         sampleRate:sampleRate
                         channels:channels
                         interleaved:YES];
  
  if (!self.playbackFormat) {
    if (outError) {
      *outError = [NSError errorWithDomain:@"DeepgramAudioEngine"
                                      code:-1
                                  userInfo:@{NSLocalizedDescriptionKey: @"Failed to create audio format"}];
    }
    return NO;
  }
  
  [self.audioEngine attachNode:self.playerNode];
  [self.audioEngine connect:self.playerNode
                         to:self.audioEngine.mainMixerNode
                     format:self.playbackFormat];
  
  if (enableVoiceProcessing) {
#if TARGET_IPHONE_SIMULATOR
    // VPIO is not implemented on the simulator. Calling
    // setVoiceProcessingEnabled:YES there raises an internal AVAEInternal
    // exception about IsFormatSampleRateAndChannelCountValid because the
    // simulator's input node cannot satisfy the VPIO format constraints.
    // Skip VP entirely; AEC has to be tested on a physical device.
    DGLogWarn(@"[Deepgram] NOTE: Voice Processing I/O (Echo Cancellation) is NOT supported on the iOS Simulator. Audio output may be picked up by the microphone. Please test on a physical device for proper AEC behavior.");
#else
    @try {
      AVAudioInputNode *inputNode = self.audioEngine.inputNode;
      AVAudioOutputNode *outputNode = self.audioEngine.outputNode;
      // Apple's hardware AEC (VPIO Audio Unit) only engages when *both*
      // input and output flow through a voice-processing-enabled audio
      // unit. Enabling VP only on the input node is a no-op for capture
      // unless rendering goes through the same unit, so we enable both.
      if (inputNode) {
        NSError *voiceProcessingError = nil;
        if (![inputNode setVoiceProcessingEnabled:YES error:&voiceProcessingError]) {
          DGLogWarn(@"[Deepgram] inputNode VP enable failed: %@", voiceProcessingError);
        }
      }
      if (outputNode) {
        NSError *voiceProcessingError = nil;
        if (![outputNode setVoiceProcessingEnabled:YES error:&voiceProcessingError]) {
          DGLogWarn(@"[Deepgram] outputNode VP enable failed: %@", voiceProcessingError);
        }
      }
    } @catch (NSException *exception) {
      // Continue - voice processing not critical for basic playback
      DGLogWarn(@"[Deepgram] VP enable threw: %@", exception);
    }
#endif
  }
  
  [self.audioEngine prepare];
  NSError *startError = nil;
  BOOL started = [self.audioEngine startAndReturnError:&startError];
  
  if (!started) {
    DGLogError(@"[Deepgram] Failed to start audio engine: %@", startError.localizedDescription);
    if (outError) {
      *outError = startError;
    }
    return NO;
  }
  
  return YES;
}

/**
 * Create AVAudioPCMBuffer from raw PCM data.
 */
- (AVAudioPCMBuffer *)createPCMBufferFromData:(NSData *)data {
  if (!data || data.length == 0 || !self.playbackFormat) {
    return nil;
  }
  
  // Calculate frame count (data length / bytes per frame)
  const AudioStreamBasicDescription *asbd = self.playbackFormat.streamDescription;
  int bytesPerFrame = asbd->mBytesPerFrame;
  AVAudioFrameCount frameCount = (AVAudioFrameCount)(data.length / bytesPerFrame);
  
  if (frameCount == 0) {
    return nil;
  }
  
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc]
                             initWithPCMFormat:self.playbackFormat
                             frameCapacity:frameCount];
  
  buffer.frameLength = frameCount;
  
  // Copy audio data to buffer
  memcpy(buffer.int16ChannelData[0], data.bytes, data.length);
  
  return buffer;
}

RCT_EXPORT_METHOD(startPlayer:(nonnull NSNumber *)sampleRate
                  channels:(nonnull NSNumber *)channels)
{
  [self stopPlayer:nil rejecter:nil];
  
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
  BOOL needsVoiceProcessing = _recordState.isRunning || self.engineCaptureActive ||
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
RCT_EXPORT_METHOD(feedAudio:(NSString *)b64)
{
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
        DGLogWarn(@"[Deepgram] feedAudio: dropping audio chunks (buffer full > 500). App might be receiving audio faster than playback.");
      });
      return;
    }
    
    NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:b64 options:0];
    if (!pcmData || pcmData.length == 0) {
      return;
    }
    
    AVAudioPCMBuffer *buffer = [self createPCMBufferFromData:pcmData];
    if (!buffer) {
      DGLogError(@"[Deepgram] feedAudio: failed to create PCM buffer");
      return;
    }
    
    _scheduledBufferCount++;
    __weak Deepgram *weakSelf = self;
    [self.playerNode scheduleBuffer:buffer completionHandler:^{
      Deepgram *strongSelf = weakSelf;
      if (strongSelf) {
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
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] feedAudio: exception %@", e);
  }
}

/**
 * Stop audio playback and cleanup AVAudioEngine.
 */
RCT_EXPORT_METHOD(stopPlayer
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    // Stop player node first (must stop before detach to avoid crash)
    if (self.playerNode) {
      [self.playerNode stop];
    }
    
    // Stop audio engine before detaching nodes
    if (self.audioEngine) {
      if (self.audioEngine.isRunning) {
        [self.audioEngine stop];
      }
      // Detach after engine is stopped to prevent crash
      if (self.playerNode) {
        [self.audioEngine detachNode:self.playerNode];
      }
      [self.audioEngine reset];
    }
    
    // Clear properties
    self.playerNode = nil;
    self.audioEngine = nil;
    self.playbackFormat = nil;
    self.isPlaying = NO;
    _scheduledBufferCount = 0;

    [self maybeDeactivateAudioSession];

    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] stopPlayer: exception %@", e);
    if (reject) reject(@"player_stop_error", e.reason, nil);
  }
}

/**
 * Set audio configuration (compatibility method).
 */
RCT_EXPORT_METHOD(setAudioConfig
                  :(nonnull NSNumber *)sampleRate
                  channels:(nonnull NSNumber *)channels)
{
  DGLogDebug(@"[Deepgram] setAudioConfig: sampleRate=%@ channels=%@", sampleRate, channels);
  [self startPlayer:sampleRate channels:channels];
}

/**
 * Play a single audio chunk (base64-encoded PCM).
 * This is used for one-shot TTS playback (HTTP mode).
 */
RCT_EXPORT_METHOD(playAudioChunk:(NSString *)b64
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    if (!b64 || b64.length == 0) {
      if (reject) reject(@"audio_chunk_error", @"Empty audio chunk", nil);
      return;
    }
    
    NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:b64 options:0];
    if (!pcmData || pcmData.length == 0) {
      if (reject) reject(@"audio_chunk_error", @"Failed to decode audio chunk", nil);
      return;
    }
    
    // Activate audio session
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] playAudioChunk: activation failed %@", message);
      if (reject) reject(@"audio_chunk_error", message, sessionError);
      return;
    }
    
    // Determine sample rate and channels from the audio data
    // For linear16 PCM, assume 24kHz mono (2 bytes per sample)
    int sampleRate = self.currentSampleRate > 0 ? self.currentSampleRate : 24000;
    int channels = 1;
    
    // Setup audio engine if needed
    if (!self.audioEngine || !self.audioEngine.isRunning) {
      NSError *engineError = nil;
      // One-shot HTTP TTS playback never needs voice processing.
      if (![self setupAudioEngineWithSampleRate:sampleRate
                                       channels:channels
                          enableVoiceProcessing:NO
                                          error:&engineError]) {
        DGLogError(@"[Deepgram] playAudioChunk: failed to setup audio engine: %@", engineError);
        if (reject) reject(@"audio_chunk_error", @"Failed to setup audio engine", engineError);
        return;
      }
    }
    
    // Create PCM buffer and schedule for playback
    AVAudioPCMBuffer *buffer = [self createPCMBufferFromData:pcmData];
    if (!buffer) {
      DGLogError(@"[Deepgram] playAudioChunk: failed to create PCM buffer");
      if (reject) reject(@"audio_chunk_error", @"Failed to create PCM buffer", nil);
      return;
    }
    
    self.isPlaying = YES;
    
    // Schedule buffer with completion handler to resolve promise
    __weak Deepgram *weakSelf = self;
    [self.playerNode scheduleBuffer:buffer completionHandler:^{
      Deepgram *strongSelf = weakSelf;
      if (strongSelf) {
        strongSelf.isPlaying = NO;
        [strongSelf maybeDeactivateAudioSession];
      }
      if (resolve) resolve(nil);
    }];
    
    // Start playing if not already playing
    if (!self.playerNode.isPlaying) {
      [self.playerNode play];
    }
    
    DGLogDebug(@"[Deepgram] playAudioChunk: scheduled %lu bytes for playback", (unsigned long)pcmData.length);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] playAudioChunk: exception %@", e);
    if (reject) reject(@"audio_chunk_error", e.reason, nil);
  }
}

- (void)invalidate
{
  DGLogDebug(@"[Deepgram] invalidate: begin");

  @try {
    [self cleanupRecordingQueue];
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] invalidate: cleanupRecordingQueue exception %@", e);
  }

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
