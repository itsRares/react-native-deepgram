#import "Deepgram+Recording.h"
#import "Deepgram+AudioSession.h"
#import "Deepgram+Playback.h"
#import "Deepgram+Private.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>

#include <math.h>
#include <string.h>

/**
 * Microphone capture for the Deepgram module. Two capture paths share this
 * file:
 *
 *   - The AudioQueue path (`DGHandleInputBuffer` + `cleanupRecordingQueue`),
 *     used for STT-only recording where hardware echo cancellation is not
 *     wanted.
 *   - The `AVAudioEngine` path (`startEngineCaptureAndReturnError:`), used for
 *     Voice Agent / duplex where VPIO hardware AEC is required. It shares the
 *     same `AVAudioEngine` instance as playback so the Voice-Processing I/O
 *     unit can cancel our own output from the captured input.
 */

void DGHandleInputBuffer(
    void *inUserData, __unused AudioQueueRef inAQ, AudioQueueBufferRef inBuffer,
    __unused const AudioTimeStamp *inStartTime, __unused UInt32 inNumPackets,
    __unused const AudioStreamPacketDescription *inPacketDesc) {
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

@implementation Deepgram (Recording)

- (void)emitPCMChunk:(NSData *)chunk sampleRate:(int)sampleRate {
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
      DGLogDebug(
          @"[Deepgram] Skipping DeepgramAudioPCM event (bridge not ready)");
      return;
    }

    DGLogDebug(@"[Deepgram] emitPCMChunk: sending %lu bytes sampleRate=%d",
               (unsigned long)chunkCopy.length, sampleRate);
    NSString *b64 = [chunkCopy base64EncodedStringWithOptions:0];
    [weakSelf sendEventWithName:@"DeepgramAudioPCM"
                           body:@{
                             @"b64" : b64,
                             @"sampleRate" : @(sampleRate)
                           }];
  });
}

/**
 * Compute a normalized RMS amplitude (0..1) over a PCM16 buffer and emit it as
 * a `DeepgramAudioLevel` event, throttled to `meteringIntervalSeconds`. No-op
 * unless metering is enabled and JS listeners are attached. Called from the
 * shared capture sink so both the AudioQueue (STT) and AVAudioEngine (Voice
 * Agent) paths are metered with identical semantics.
 */
- (void)emitAudioLevelForPCM:(NSData *)pcmData {
  if (!self.meteringEnabled || !self.hasListeners) {
    return;
  }
  if (!pcmData || pcmData.length < sizeof(int16_t)) {
    return;
  }

  // Throttle to the configured interval (default ~100 ms / 10 Hz).
  NSTimeInterval now = [NSProcessInfo processInfo].systemUptime;
  NSTimeInterval interval =
      self.meteringIntervalSeconds > 0 ? self.meteringIntervalSeconds : 0.1;
  NSTimeInterval last = self.lastMeterEmitTime;
  if (last > 0 && (now - last) < interval) {
    return;
  }
  self.lastMeterEmitTime = now;

  const int16_t *samples = (const int16_t *)pcmData.bytes;
  NSUInteger count = pcmData.length / sizeof(int16_t);
  if (count == 0) {
    return;
  }

  double sumSquares = 0.0;
  for (NSUInteger i = 0; i < count; i++) {
    double s = (double)samples[i] / 32768.0;
    sumSquares += s * s;
  }
  double level = sqrt(sumSquares / (double)count);
  if (level > 1.0) {
    level = 1.0;
  }

  __weak __typeof(self) weakSelf = self;
  dispatch_queue_t queue = self.emitterQueue ?: dispatch_get_main_queue();
  dispatch_async(queue, ^{
    __typeof(self) strongSelf = weakSelf;
    if (!strongSelf || !strongSelf.hasListeners) {
      return;
    }
    if (!strongSelf.bridge || !strongSelf.callableJSModules) {
      return;
    }
    [strongSelf sendEventWithName:@"DeepgramAudioLevel"
                             body:@{@"level" : @(level)}];
  });
}

- (void)appendPCMDataAndEmitIfNeeded:(NSData *)pcmData {
  if (!pcmData || pcmData.length == 0) {
    DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: empty PCM, skipping");
    return;
  }

  // Audio-level metering is computed on the same captured PCM that feeds the
  // transcription stream, so it reflects exactly what Deepgram receives. It is
  // throttled and gated independently and never alters the PCM payload.
  [self emitAudioLevelForPCM:pcmData];

  if (!self.pendingPCMBuffer) {
    DGLogDebug(
        @"[Deepgram] appendPCMDataAndEmitIfNeeded: allocate pending buffer");
    self.pendingPCMBuffer = [[NSMutableData alloc] init];
  }

  DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: append %lu bytes "
             @"(pending=%lu)",
             (unsigned long)pcmData.length,
             (unsigned long)self.pendingPCMBuffer.length);
  [self.pendingPCMBuffer appendData:pcmData];

  NSUInteger chunkSize =
      self.chunkSizeBytes > 0 ? self.chunkSizeBytes : pcmData.length;

  while (self.pendingPCMBuffer.length >= chunkSize) {
    NSData *chunk =
        [self.pendingPCMBuffer subdataWithRange:NSMakeRange(0, chunkSize)];
    [self.pendingPCMBuffer replaceBytesInRange:NSMakeRange(0, chunkSize)
                                     withBytes:NULL
                                        length:0];
    DGLogDebug(@"[Deepgram] appendPCMDataAndEmitIfNeeded: emitting chunk %lu "
               @"bytes remaining=%lu",
               (unsigned long)chunk.length,
               (unsigned long)self.pendingPCMBuffer.length);
    [self emitPCMChunk:chunk sampleRate:self.currentSampleRate];
  }
}

- (void)flushPendingPCM {
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

- (void)cleanupRecordingQueue {
  DGLogDebug(@"[Deepgram] cleanupRecordingQueue: begin");
  self.audioQueueCaptureRequested = NO;
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
- (BOOL)startEngineCaptureAndReturnError:(NSError **)outError {
  self.currentSampleRate = 16000;

  if (!self.audioEngine) {
    NSError *engineError = nil;
    if (![self setupAudioEngineWithSampleRate:self.currentSampleRate
                                     channels:1
                        enableVoiceProcessing:YES
                                        error:&engineError]) {
      if (outError)
        *outError = engineError;
      return NO;
    }
  } else {
#if TARGET_IPHONE_SIMULATOR
    // VPIO is unsupported on the simulator and toggling VP corrupts the
    // input node's format (sampleRate becomes 0), which would later fail
    // the IsFormatSampleRateAndChannelCountValid check. Skip entirely.
    DGLogWarn(@"[Deepgram] NOTE: Voice Processing I/O (Echo Cancellation) is "
              @"NOT supported on the iOS Simulator. Audio output may be picked "
              @"up by the microphone. Please test on a physical device for "
              @"proper AEC behavior.");
#else
    @try {
      NSError *vpError = nil;
      if (self.audioEngine.inputNode &&
          ![self.audioEngine.inputNode setVoiceProcessingEnabled:YES
                                                           error:&vpError]) {
        DGLogWarn(@"[Deepgram] inputNode VP enable failed: %@", vpError);
      }
      if (self.audioEngine.outputNode &&
          ![self.audioEngine.outputNode setVoiceProcessingEnabled:YES
                                                            error:&vpError]) {
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
      *outError = [NSError
          errorWithDomain:@"DeepgramAudioEngine"
                     code:-2
                 userInfo:@{
                   NSLocalizedDescriptionKey : @"No input node available"
                 }];
    }
    return NO;
  }

  AVAudioFormat *hwFormat = [inputNode inputFormatForBus:0];
  if (!hwFormat || hwFormat.sampleRate <= 0) {
    if (outError) {
      *outError =
          [NSError errorWithDomain:@"DeepgramAudioEngine"
                              code:-3
                          userInfo:@{
                            NSLocalizedDescriptionKey : @"Invalid input format"
                          }];
    }
    return NO;
  }

  AVAudioFormat *outputFormat =
      [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                       sampleRate:self.currentSampleRate
                                         channels:1
                                      interleaved:YES];
  self.captureOutputFormat = outputFormat;
  self.captureConverter =
      [[AVAudioConverter alloc] initFromFormat:hwFormat toFormat:outputFormat];
  if (!self.captureConverter) {
    if (outError) {
      *outError = [NSError errorWithDomain:@"DeepgramAudioEngine"
                                      code:-4
                                  userInfo:@{
                                    NSLocalizedDescriptionKey :
                                        @"Failed to build AVAudioConverter"
                                  }];
    }
    return NO;
  }

  AVAudioFrameCount tapFrames = (AVAudioFrameCount)MAX(
      1024, (NSUInteger)round(hwFormat.sampleRate * 0.2));

  __weak __typeof(self) weakSelf = self;
  @try {
    [inputNode removeTapOnBus:0];
  } @catch (__unused NSException *e) {
    // No prior tap — fine.
  }

  @try {
    [inputNode
        installTapOnBus:0
             bufferSize:tapFrames
                 format:hwFormat
                  block:^(AVAudioPCMBuffer *_Nonnull inBuf,
                          __unused AVAudioTime *_Nonnull when) {
                    __strong __typeof(weakSelf) strongSelf = weakSelf;
                    if (!strongSelf || !strongSelf.engineCaptureActive)
                      return;
                    AVAudioConverter *converter = strongSelf.captureConverter;
                    AVAudioFormat *outFmt = strongSelf.captureOutputFormat;
                    if (!converter || !outFmt || inBuf.frameLength == 0)
                      return;

                    AVAudioFrameCount outCapacity =
                        (AVAudioFrameCount)ceil((double)inBuf.frameLength *
                                                outFmt.sampleRate /
                                                inBuf.format.sampleRate) +
                        16;
                    AVAudioPCMBuffer *outBuf = [[AVAudioPCMBuffer alloc]
                        initWithPCMFormat:outFmt
                            frameCapacity:outCapacity];
                    if (!outBuf)
                      return;

                    __block BOOL provided = NO;
                    NSError *cvtError = nil;
                    AVAudioConverterInputBlock inputBlock =
                        ^AVAudioBuffer *_Nullable(
                            __unused AVAudioPacketCount inNumPackets,
                            AVAudioConverterInputStatus *_Nonnull outStatus) {
                      if (provided) {
                        *outStatus = AVAudioConverterInputStatus_NoDataNow;
                        return nil;
                      }
                      provided = YES;
                      *outStatus = AVAudioConverterInputStatus_HaveData;
                      return inBuf;
                    };

                    AVAudioConverterOutputStatus status =
                        [converter convertToBuffer:outBuf
                                             error:&cvtError
                                withInputFromBlock:inputBlock];
                    if (status == AVAudioConverterOutputStatus_Error ||
                        cvtError) {
                      DGLogWarn(@"[Deepgram] capture convert failed: %@",
                                cvtError);
                      return;
                    }
                    if (outBuf.frameLength == 0 || !outBuf.int16ChannelData)
                      return;

                    NSUInteger byteCount = (NSUInteger)outBuf.frameLength * 2;
                    NSData *pcm =
                        [NSData dataWithBytes:outBuf.int16ChannelData[0]
                                       length:byteCount];
                    [strongSelf appendPCMDataAndEmitIfNeeded:pcm];
                  }];
  } @catch (NSException *e) {
    DGLogError(@"[Deepgram] installTapOnBus exception: %@", e);
    if (outError) {
      *outError = [NSError
          errorWithDomain:@"DeepgramAudioEngine"
                     code:-5
                 userInfo:@{
                   NSLocalizedDescriptionKey : e.reason ?: @"Tap install failed"
                 }];
    }
    return NO;
  }

  self.chunkSizeBytes =
      (NSUInteger)MAX(1, (int)round(self.currentSampleRate * 2 * 0.2));
  self.engineCaptureActive = YES;

  if (!self.audioEngine.isRunning) {
    NSError *startError = nil;
    if (![self.audioEngine startAndReturnError:&startError]) {
      DGLogError(@"[Deepgram] engine start failed: %@", startError);
      @try {
        [inputNode removeTapOnBus:0];
      } @catch (__unused NSException *e) {
      }
      self.engineCaptureActive = NO;
      if (outError)
        *outError = startError;
      return NO;
    }
  }
  return YES;
}

- (void)stopEngineCapture {
  if (!self.engineCaptureActive && !self.captureConverter)
    return;
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
    @try {
      [self.audioEngine stop];
    } @catch (__unused NSException *e) {
    }
  }
}

@end
