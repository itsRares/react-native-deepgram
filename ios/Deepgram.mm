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

@interface Deepgram : RCTEventEmitter <AVAudioPlayerDelegate>
{
  DGRecordState _recordState;
}

// Recording
@property (nonatomic, strong) NSMutableData      *pendingPCMBuffer;
@property (nonatomic, strong) dispatch_queue_t    emitterQueue;
@property (nonatomic, assign) NSUInteger           chunkSizeBytes;
@property (atomic, assign) BOOL                    hasListeners;
@property (atomic, assign) BOOL                    appIsActive;

// Playback / TTS
@property (nonatomic, strong) AVAudioPlayer      *audioPlayer;
@property (nonatomic, strong) NSMutableData      *audioBuffer;
@property (nonatomic, assign) BOOL                isPlaying;
@property (nonatomic, assign) int                 currentSampleRate;
@property (nonatomic, assign) BOOL                audioSessionConfigured;
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

  RCTUnsafeExecuteOnMainQueueSync(^{
    DGLogDebug(@"[Deepgram] activateAudioSession: configuring on main queue");
    success = [self configureAudioSessionIfNeeded:&activationError];
  });

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
  RCTUnsafeExecuteOnMainQueueSync(^{
    NSError *error = nil;
    if (![[AVAudioSession sharedInstance] setActive:NO error:&error] && error) {
      DGLogError(@"[Deepgram] Failed to deactivate audio session: %@",
            error.localizedDescription ?: error);
    }
  });
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
  DGLogDebug(@"[Deepgram] configureAudioSession: begin");
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  AVAudioSessionCategoryOptions options = AVAudioSessionCategoryOptionDuckOthers |
                                           AVAudioSessionCategoryOptionDefaultToSpeaker |
                                           AVAudioSessionCategoryOptionAllowBluetooth;

  if (@available(iOS 10.0, *)) {
    DGLogDebug(@"[Deepgram] configureAudioSession: enabling AirPlay option");
    options |= AVAudioSessionCategoryOptionAllowAirPlay;
  }

  BOOL categorySuccess = NO;

  if (@available(iOS 10.0, *)) {
    DGLogDebug(@"[Deepgram] configureAudioSession: setCategory PlayAndRecord voice chat (iOS10+)");
    categorySuccess = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                     mode:AVAudioSessionModeVoiceChat
                                  options:options
                                    error:&error];
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    DGLogDebug(@"[Deepgram] configureAudioSession: setCategory legacy path");
    categorySuccess = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                             withOptions:options
                                   error:&error];
#pragma clang diagnostic pop
    if (categorySuccess && !error) {
      NSError *modeError = nil;
      categorySuccess = [session setMode:AVAudioSessionModeVoiceChat error:&modeError] && !modeError;
      if (modeError) {
        error = modeError;
      }
    }
  }

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
  if (!activeSuccess || activeError) {
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
  DGLogDebug(@"[Deepgram] maybeDeactivateAudioSession: running=%@ playing=%@",
        _recordState.isRunning ? @"YES" : @"NO",
        self.isPlaying ? @"YES" : @"NO");
  if (!_recordState.isRunning && !self.isPlaying) {
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

#if TARGET_OS_IOS
- (void)handleAppDidBecomeActive:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleAppDidBecomeActive: %@", note.userInfo);
  self.appIsActive = YES;

  if (_recordState.isRunning || self.isPlaying) {
    DGLogDebug(@"[Deepgram] handleAppDidBecomeActive: reactivating session");
    [self activateAudioSession:NULL];
  }
}

- (void)handleAppDidEnterBackground:(NSNotification *)note
{
  DGLogDebug(@"[Deepgram] handleAppDidEnterBackground: %@", note.userInfo);
  self.appIsActive = NO;
  [self maybeDeactivateAudioSession];
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
RCT_EXPORT_METHOD(startRecording
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] startRecording: begin");
    self.currentSampleRate = 16000;
    DGLogDebug(@"[Deepgram] startRecording: targetSampleRate=%d", self.currentSampleRate);
    NSError *sessionError = nil;
    if (![self activateAudioSession:&sessionError]) {
      NSString *message = sessionError.localizedDescription ?: @"Failed to activate audio session";
      DGLogError(@"[Deepgram] startRecording: activation failed %@", message);
      if (reject) reject(@"record_start_error", message, sessionError);
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
    [self cleanupRecordingQueue];
    [self flushPendingPCM];
    self.pendingPCMBuffer = nil;
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
    if (!self.audioBuffer) {
      self.audioBuffer = [[NSMutableData alloc] init];
      DGLogDebug(@"[Deepgram] startAudio: created audioBuffer");
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
/*  2.  SIMPLE AUDIO PLAYBACK (USING AVAUDIOPLAYER)                   */
/* ================================================================== */

/**
 * Create a WAV header for PCM data.
 * This allows us to use AVAudioPlayer with raw PCM data.
 */
- (NSData *)createWAVHeaderForPCMData:(NSData *)pcmData sampleRate:(int)sampleRate {
  uint32_t dataSize = (uint32_t)pcmData.length;
  uint32_t fileSize = 36 + dataSize;
  uint16_t channels = 1;
  uint16_t bitsPerSample = 16;
  uint32_t byteRate = sampleRate * channels * (bitsPerSample / 8);
  uint16_t blockAlign = channels * (bitsPerSample / 8);
  
  NSMutableData *wavData = [NSMutableData data];
  
  // RIFF header
  [wavData appendBytes:"RIFF" length:4];
  [wavData appendBytes:&fileSize length:4];
  [wavData appendBytes:"WAVE" length:4];
  
  // fmt chunk
  [wavData appendBytes:"fmt " length:4];
  uint32_t fmtSize = 16;
  [wavData appendBytes:&fmtSize length:4];
  uint16_t audioFormat = 1; // PCM
  [wavData appendBytes:&audioFormat length:2];
  [wavData appendBytes:&channels length:2];
  uint32_t sampleRateValue = sampleRate;
  [wavData appendBytes:&sampleRateValue length:4];
  [wavData appendBytes:&byteRate length:4];
  [wavData appendBytes:&blockAlign length:2];
  [wavData appendBytes:&bitsPerSample length:2];
  
  // data chunk
  [wavData appendBytes:"data" length:4];
  [wavData appendBytes:&dataSize length:4];
  [wavData appendData:pcmData];
  
  return wavData;
}

RCT_EXPORT_METHOD(startPlayer
                  :(nonnull NSNumber *)sampleRate
                  channels:(nonnull NSNumber *)channels)
{
  DGLogDebug(@"[Deepgram] startPlayer: begin sampleRate=%@ channels=%@",
        sampleRate,
        channels);
  [self stopPlayer:nil rejecter:nil];
  NSError *sessionError = nil;
  if (![self activateAudioSession:&sessionError]) {
    DGLogWarn(@"[Deepgram] Unable to activate audio session for playback: %@",
          sessionError.localizedDescription ?: sessionError);
    return;
  }

  self.audioBuffer = [[NSMutableData alloc] init];
  self.isPlaying = NO;
  self.currentSampleRate = sampleRate.intValue;
  DGLogDebug(@"[Deepgram] startPlayer: initialized buffer sampleRate=%d",
        self.currentSampleRate);
}

/**
 * Add audio data to the buffer for streaming playback.
 */
RCT_EXPORT_METHOD(feedAudio:(NSString *)b64)
{
  DGLogDebug(@"[Deepgram] feedAudio: begin length=%lu", (unsigned long)b64.length);
  if (!self.audioBuffer) {
    // Use default sample rate if not set
    int defaultSampleRate = self.currentSampleRate > 0 ? self.currentSampleRate : 16000;
    DGLogDebug(@"[Deepgram] feedAudio: auto startPlayer defaultSampleRate=%d", defaultSampleRate);
    [self startPlayer:@(defaultSampleRate) channels:@1];
  }

  NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:b64 options:0];
  if (!pcmData || pcmData.length == 0) {
    DGLogDebug(@"[Deepgram] feedAudio: decoded data empty");
    return;
  }

  [self.audioBuffer appendData:pcmData];
  DGLogDebug(@"[Deepgram] feedAudio: appended %lu bytes (buffer=%lu)",
        (unsigned long)pcmData.length,
        (unsigned long)self.audioBuffer.length);

  if (!self.isPlaying && self.audioBuffer.length > 1000) {
    DGLogDebug(@"[Deepgram] feedAudio: triggering playback");
    [self playAccumulatedAudio];
  }
}

/**
 * Play accumulated audio buffer for streaming.
 */
- (void)playAccumulatedAudio {
  if (!self.audioBuffer || self.audioBuffer.length == 0) {
    DGLogDebug(@"[Deepgram] playAccumulatedAudio: no buffered audio");
    return;
  }

  NSData *wavData = [self createWAVHeaderForPCMData:self.audioBuffer sampleRate:self.currentSampleRate];

  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:wavData error:&error];

  if (error) {
    DGLogError(@"[Deepgram] playAccumulatedAudio: player error=%@", error);
    return;
  }

  self.audioPlayer = player;
  self.audioPlayer.delegate = self;

  self.isPlaying = YES;
  [player prepareToPlay];
  BOOL success = [player play];

  if (success) {
    DGLogDebug(@"[Deepgram] playAccumulatedAudio: playback started, clearing buffer");
    [self.audioBuffer setLength:0];
  } else {
    DGLogError(@"[Deepgram] playAccumulatedAudio: failed to start playback");
    self.isPlaying = NO;
  }
}

/**
 * Play PCM data immediately using AVAudioPlayer.
 */
- (void)playPCMData:(NSData *)pcmData {
  DGLogDebug(@"[Deepgram] playPCMData: begin length=%lu", (unsigned long)pcmData.length);
  NSData *wavData = [self createWAVHeaderForPCMData:pcmData sampleRate:self.currentSampleRate];

  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:wavData error:&error];

  if (error) {
    DGLogError(@"[Deepgram] playPCMData: player error=%@", error);
    return;
  }

  self.audioPlayer = player;
  [player prepareToPlay];
  DGLogDebug(@"[Deepgram] playPCMData: playing");
  [player play];
}

/**
 * Stop and cleanup the audio player.
 */
RCT_EXPORT_METHOD(stopPlayer
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] stopPlayer: begin");
    if (self.audioPlayer) {
      [self.audioPlayer stop];
      DGLogDebug(@"[Deepgram] stopPlayer: stopped audioPlayer");
      self.audioPlayer = nil;
    }

    self.audioBuffer = nil;
    self.isPlaying = NO;

    [self maybeDeactivateAudioSession];

    DGLogDebug(@"[Deepgram] stopPlayer: success");
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] Error stopping player: %@", e.reason);
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
 * Play a single audio chunk (one-shot playback).
 */
RCT_EXPORT_METHOD(playAudioChunk
                  :(NSString *)chunk
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    DGLogDebug(@"[Deepgram] playAudioChunk: begin");
    NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:chunk options:0];
    if (!pcmData) {
      DGLogError(@"[Deepgram] playAudioChunk: failed to decode base64");
      if (reject) reject(@"invalid_data", @"Failed to decode audio data", nil);
      return;
    }

    [self playPCMData:pcmData];

    DGLogDebug(@"[Deepgram] playAudioChunk: success");
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    DGLogError(@"[Deepgram] playAudioChunk: exception %@", e);
    if (reject) reject(@"playback_error", e.reason, nil);
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

  if (self.audioPlayer) {
    [self.audioPlayer stop];
    self.audioPlayer = nil;
  }

  self.audioBuffer = nil;
  self.isPlaying = NO;
  self.hasListeners = NO;
  self.appIsActive = NO;

  [self maybeDeactivateAudioSession];

  DGLogDebug(@"[Deepgram] invalidate: finished");
  [super invalidate];
}

/* ================================================================== */
/*  3.  AVAUDIOPLAYER DELEGATE METHODS                                */
/* ================================================================== */

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag {
  DGLogDebug(@"[Deepgram] audioPlayerDidFinishPlaying: success=%@", flag ? @"YES" : @"NO");
  self.isPlaying = NO;

  if (self.audioBuffer && self.audioBuffer.length > 0) {
    DGLogDebug(@"[Deepgram] audioPlayerDidFinishPlaying: playing remaining buffered audio");
    [self playAccumulatedAudio];
  }
}

- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer *)player error:(NSError *)error {
  DGLogError(@"[Deepgram] audioPlayerDecodeErrorDidOccur: error=%@", error);
  self.isPlaying = NO;
}

@end
