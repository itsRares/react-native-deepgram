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
    __unused const AudioStreamPacketDescription *_Nullable inPacketDesc) {
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

/**
 * Build a canonical 44-byte little-endian WAV/RIFF header for `dataBytes` of
 * uncompressed PCM. Used for the placeholder header (dataBytes = 0) and to
 * patch the real sizes when recording stops.
 */
static NSData *DGMakeWavHeader(uint32_t sampleRate, uint16_t channels,
                               uint16_t bitsPerSample, uint32_t dataBytes) {
  uint32_t byteRate = sampleRate * channels * (bitsPerSample / 8);
  uint16_t blockAlign = (uint16_t)(channels * (bitsPerSample / 8));
  uint32_t chunkSize = 36 + dataBytes;
  uint32_t subchunk1Size = 16;
  uint16_t audioFormat = 1; // PCM

  NSMutableData *header = [NSMutableData dataWithCapacity:44];
  [header appendBytes:"RIFF" length:4];
  [header appendBytes:&chunkSize length:4];
  [header appendBytes:"WAVE" length:4];
  [header appendBytes:"fmt " length:4];
  [header appendBytes:&subchunk1Size length:4];
  [header appendBytes:&audioFormat length:2];
  [header appendBytes:&channels length:2];
  [header appendBytes:&sampleRate length:4];
  [header appendBytes:&byteRate length:4];
  [header appendBytes:&blockAlign length:2];
  [header appendBytes:&bitsPerSample length:2];
  [header appendBytes:"data" length:4];
  [header appendBytes:&dataBytes length:4];
  return header;
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
 * a `DeepgramAudioLevel` event, throttled to `meteringIntervalSeconds`. Called
 * from the shared capture sink so the AudioQueue (STT) and AVAudioEngine
 * (Voice Agent) paths are metered identically.
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

  // Metering runs on the same captured PCM that feeds transcription, so it
  // reflects exactly what Deepgram receives; it never alters the payload.
  [self emitAudioLevelForPCM:pcmData];

  // Tee the captured PCM to the WAV file. On a write failure (e.g. disk full)
  // we stop teeing but keep streaming so transcription is unaffected.
  if (self.recordToFileEnabled && self.recordFileHandle) {
    @try {
      [self.recordFileHandle writeData:pcmData];
      self.recordFileDataBytes += (unsigned long long)pcmData.length;
    } @catch (NSException *e) {
      DGLogWarn(
          @"[Deepgram] appendPCMDataAndEmitIfNeeded: file write failed %@", e);
      self.recordToFileEnabled = NO;
    }
  }

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
    [self emitPCMChunk:chunk sampleRate:self.captureSampleRate];
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
  [self emitPCMChunk:remaining sampleRate:self.captureSampleRate];
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

- (BOOL)beginRecordingToFileIfRequested:(NSDictionary *)options
                                  error:(NSError **)outError {
  if (![options isKindOfClass:[NSDictionary class]]) {
    return YES; // nothing requested
  }
  id enabledRaw = options[@"enabled"];
  BOOL enabled =
      [enabledRaw isKindOfClass:[NSNumber class]] && [enabledRaw boolValue];
  if (!enabled) {
    return YES;
  }

  // Close any stale handle from a previous, incompletely stopped session.
  [self discardRecordingFile];

  // Resolve the destination path. A caller-supplied `path` (with or without a
  // file:// scheme) wins; otherwise write to an app-specific temporary file.
  NSString *path = nil;
  id rawPath = options[@"path"];
  if ([rawPath isKindOfClass:[NSString class]] &&
      [(NSString *)rawPath length] > 0) {
    NSString *candidate = (NSString *)rawPath;
    if ([candidate hasPrefix:@"file://"]) {
      NSURL *url = [NSURL URLWithString:candidate];
      candidate = url.path ?: [candidate substringFromIndex:7];
    }
    path = candidate;
  } else {
    NSString *name =
        [NSString stringWithFormat:@"deepgram-recording-%.0f.wav",
                                   [[NSDate date] timeIntervalSince1970] * 1000];
    path = [NSTemporaryDirectory() stringByAppendingPathComponent:name];
  }

  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *dir = [path stringByDeletingLastPathComponent];
  NSError *dirError = nil;
  if (dir.length > 0 && ![fm fileExistsAtPath:dir]) {
    [fm createDirectoryAtPath:dir
        withIntermediateDirectories:YES
                         attributes:nil
                              error:&dirError];
  }

  // (Re)create the file and write the placeholder header (data size = 0).
  NSData *header = DGMakeWavHeader((uint32_t)MAX(1, self.captureSampleRate), 1,
                                   16, 0);
  if (![fm createFileAtPath:path contents:header attributes:nil]) {
    if (outError) {
      *outError = DGNativeError(
          @"DeepgramRecordToFile", -1,
          [NSString stringWithFormat:@"Unable to create recording file at %@",
                                     path]);
    }
    return NO;
  }

  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!handle) {
    if (outError) {
      *outError = DGNativeError(
          @"DeepgramRecordToFile", -2,
          [NSString stringWithFormat:@"Unable to open recording file at %@",
                                     path]);
    }
    return NO;
  }
  [handle seekToEndOfFile];

  self.recordFilePath = path;
  self.recordFileHandle = handle;
  self.recordFileDataBytes = 0;
  self.recordToFileEnabled = YES;
  DGLogDebug(@"[Deepgram] beginRecordingToFile: writing to %@", path);
  return YES;
}

- (NSString *)finishRecordingToFile {
  NSFileHandle *handle = self.recordFileHandle;
  NSString *path = self.recordFilePath;
  self.recordToFileEnabled = NO;
  self.recordFileHandle = nil;
  self.recordFilePath = nil;

  if (!handle || path.length == 0) {
    self.recordFileDataBytes = 0;
    return nil;
  }

  uint32_t dataBytes = (uint32_t)self.recordFileDataBytes;
  self.recordFileDataBytes = 0;

  @try {
    // Patch the header with the final size and sample rate.
    NSData *header =
        DGMakeWavHeader((uint32_t)MAX(1, self.captureSampleRate), 1, 16,
                        dataBytes);
    [handle seekToFileOffset:0];
    [handle writeData:header];
    [handle closeFile];
  } @catch (NSException *e) {
    DGLogWarn(@"[Deepgram] finishRecordingToFile: header patch failed %@", e);
    @try {
      [handle closeFile];
    } @catch (__unused NSException *ignored) {
    }
  }

  NSString *uri = [[NSURL fileURLWithPath:path] absoluteString];
  DGLogDebug(@"[Deepgram] finishRecordingToFile: %@ (%u data bytes)", uri,
             (unsigned int)dataBytes);
  return uri;
}

- (void)discardRecordingFile {
  NSFileHandle *handle = self.recordFileHandle;
  NSString *path = self.recordFilePath;
  self.recordToFileEnabled = NO;
  self.recordFileHandle = nil;
  self.recordFilePath = nil;
  self.recordFileDataBytes = 0;

  if (handle) {
    @try {
      [handle closeFile];
    } @catch (__unused NSException *e) {
    }
  }
  if (path.length > 0) {
    [[NSFileManager defaultManager] removeItemAtPath:path error:NULL];
  }
}



/**
 * Engine-based microphone capture used when JS opts in to hardware voice
 * processing (Voice Agent / duplex). Routes through `AVAudioEngine.inputNode`
 * with `setVoiceProcessingEnabled:YES` on both input and output nodes — the
 * only Apple-supported way to engage VPIO hardware echo cancellation. The
 * AudioQueue path remains for STT-only usage where AEC is undesirable.
 */
- (BOOL)startEngineCaptureAndReturnError:(NSError **)outError {
  // The requested capture rate is set by startRecording and must survive
  // engine rebuilds — handleEngineConfigurationChange re-runs this method, so
  // never re-hardcode it here.
  if (self.captureSampleRate <= 0) {
    self.captureSampleRate = 16000;
  }

  if (!self.audioEngine) {
    NSError *engineError = nil;
    if (![self setupAudioEngineWithSampleRate:self.captureSampleRate
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
      // Re-asserting VP when it is already engaged tears down and rebuilds
      // the VPIO unit, leaving a brief window with no echo cancellation (and
      // can fail outright, silently dropping AEC). Only toggle when needed.
      NSError *vpError = nil;
      AVAudioInputNode *vpInput = self.audioEngine.inputNode;
      AVAudioOutputNode *vpOutput = self.audioEngine.outputNode;
      if (vpInput && !vpInput.isVoiceProcessingEnabled &&
          ![vpInput setVoiceProcessingEnabled:YES error:&vpError]) {
        DGLogWarn(@"[Deepgram] inputNode VP enable failed: %@", vpError);
      }
      if (vpOutput && !vpOutput.isVoiceProcessingEnabled &&
          ![vpOutput setVoiceProcessingEnabled:YES error:&vpError]) {
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
                                       sampleRate:self.captureSampleRate
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
      (NSUInteger)MAX(1, (int)round(self.captureSampleRate * 2 * 0.2));
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
