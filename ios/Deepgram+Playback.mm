#import "Deepgram+Playback.h"
#import "Deepgram+Private.h"

#import <AVFoundation/AVFoundation.h>

#include <string.h>

/**
 * TTS / Voice Agent audio output for the Deepgram module. Playback runs through
 * an `AVAudioPlayerNode` on a shared `AVAudioEngine`. When voice processing is
 * requested the same engine drives both output and microphone capture so the
 * VPIO Audio Unit can cancel our own output out of the captured input
 * (hardware echo cancellation).
 */
@implementation Deepgram (Playback)

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
- (void)stopAndDetachPlayerNode {
  if (self.playerNode) {
    _playbackGeneration.fetch_add(1);

    @try {
      [self.playerNode stop];
    } @catch (NSException *e) {
      DGLogWarn(@"[Deepgram] playerNode stop exception: %@", e);
    }

    if (self.audioEngine) {
      @try {
        [self.audioEngine detachNode:self.playerNode];
      } @catch (NSException *e) {
        DGLogWarn(@"[Deepgram] playerNode detach exception: %@", e);
      }
    }
  }

  self.playerNode = nil;
  self.playbackFormat = nil;
  self.isPlaying = NO;
  _scheduledBufferCount = 0;
}

- (void)interruptPlayerPlayback {
  if (self.playerNode) {
    _playbackGeneration.fetch_add(1);

    @try {
      [self.playerNode stop];
    } @catch (NSException *e) {
      DGLogWarn(@"[Deepgram] playerNode interrupt exception: %@", e);
    }
  }

  self.isPlaying = NO;
  _scheduledBufferCount = 0;
}

- (BOOL)setupAudioEngineWithSampleRate:(int)sampleRate
                              channels:(int)channels
                 enableVoiceProcessing:(BOOL)enableVoiceProcessing
                                 error:(NSError **)outError {
  BOOL reuseCaptureEngine = self.audioEngine && self.engineCaptureActive;

  if (self.audioEngine && self.audioEngine.isRunning) {
    [self.audioEngine stop];
  }

  [self stopAndDetachPlayerNode];

  if (!reuseCaptureEngine) {
    if (self.audioEngine) {
      [self.audioEngine reset];
    }
    self.audioEngine = [[AVAudioEngine alloc] init];
  }

  if (!self.audioEngine) {
    self.audioEngine = [[AVAudioEngine alloc] init];
  }

  self.playerNode = [[AVAudioPlayerNode alloc] init];

  self.playbackFormat =
      [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                       sampleRate:sampleRate
                                         channels:channels
                                      interleaved:YES];

  if (!self.playbackFormat) {
    if (outError) {
      *outError = [NSError
          errorWithDomain:@"DeepgramAudioEngine"
                     code:-1
                 userInfo:@{
                   NSLocalizedDescriptionKey : @"Failed to create audio format"
                 }];
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
    DGLogWarn(@"[Deepgram] NOTE: Voice Processing I/O (Echo Cancellation) is "
              @"NOT supported on the iOS Simulator. Audio output may be picked "
              @"up by the microphone. Please test on a physical device for "
              @"proper AEC behavior.");
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
        if (![inputNode setVoiceProcessingEnabled:YES
                                            error:&voiceProcessingError]) {
          DGLogWarn(@"[Deepgram] inputNode VP enable failed: %@",
                    voiceProcessingError);
        }
      }
      if (outputNode) {
        NSError *voiceProcessingError = nil;
        if (![outputNode setVoiceProcessingEnabled:YES
                                             error:&voiceProcessingError]) {
          DGLogWarn(@"[Deepgram] outputNode VP enable failed: %@",
                    voiceProcessingError);
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
    DGLogError(@"[Deepgram] Failed to start audio engine: %@",
               startError.localizedDescription);
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
  const AudioStreamBasicDescription *asbd =
      self.playbackFormat.streamDescription;
  int bytesPerFrame = asbd ? (int)asbd->mBytesPerFrame : 0;
  if (bytesPerFrame <= 0) {
    return nil;
  }
  AVAudioFrameCount frameCount =
      (AVAudioFrameCount)(data.length / bytesPerFrame);

  if (frameCount == 0) {
    return nil;
  }

  AVAudioPCMBuffer *buffer =
      [[AVAudioPCMBuffer alloc] initWithPCMFormat:self.playbackFormat
                                    frameCapacity:frameCount];

  buffer.frameLength = frameCount;

  // Copy only whole frames. `data.length` may not be an exact multiple of
  // bytesPerFrame (e.g. a truncated network chunk); copying the raw length
  // would write past the buffer, which is sized for `frameCount` frames.
  NSUInteger usableBytes = (NSUInteger)frameCount * (NSUInteger)bytesPerFrame;
  memcpy(buffer.int16ChannelData[0], data.bytes, usableBytes);

  return buffer;
}

@end
