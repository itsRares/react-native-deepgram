#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface Deepgram : RCTEventEmitter
// Recording
@property (nonatomic, strong) AVAudioEngine      *recEngine;

// Playback / TTS
@property (nonatomic, strong) AVAudioEngine      *playEngine;
@property (nonatomic, strong) AVAudioPlayerNode  *player;
@property (nonatomic, strong) AVAudioFormat      *pcmFormat;
@end

@implementation Deepgram
RCT_EXPORT_MODULE();

/* ------------------------------------------------------------------ */
/*  React-Native boilerplate                                          */
/* ------------------------------------------------------------------ */
+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"DeepgramAudioPCM" ];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
- (void)activateAudioSession
{
  AVAudioSession *s = [AVAudioSession sharedInstance];
  NSError *error = nil;
  
  // Use PlayAndRecord for both recording and playback
  BOOL success = [s setCategory:AVAudioSessionCategoryPlayAndRecord
                    withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker | 
                               AVAudioSessionCategoryOptionAllowBluetooth
                          error:&error];
  
  if (!success) {
    NSLog(@"[Deepgram] Failed to set audio session category: %@", error.localizedDescription);
  }
  
  success = [s setActive:YES error:&error];
  if (!success) {
    NSLog(@"[Deepgram] Failed to activate audio session: %@", error.localizedDescription);
  } else {
    NSLog(@"[Deepgram] Audio session activated successfully");
  }
}

/* ================================================================== */
/*  1.  MICROPHONE CAPTURE (≈ 48 kHz Float-32)                         */
/* ================================================================== */
RCT_EXPORT_METHOD(startRecording
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    if (!self.recEngine) self.recEngine = [[AVAudioEngine alloc] init];
    [self activateAudioSession];

    AVAudioInputNode *input = self.recEngine.inputNode;
    AVAudioFormat *hwFmt    = [input outputFormatForBus:0];

    [input removeTapOnBus:0];

    __weak __typeof(self) weakSelf = self;
    [input installTapOnBus:0
                bufferSize:1024
                    format:hwFmt
                     block:^(AVAudioPCMBuffer *buf, __unused AVAudioTime *when) {
                       if (!weakSelf) return;
                       NSData *pcm = [NSData dataWithBytes:buf.floatChannelData[0]
                                                    length:buf.frameLength * sizeof(float)];
                       NSString *b64 = [pcm base64EncodedStringWithOptions:0];
                       [weakSelf sendEventWithName:@"DeepgramAudioPCM"
                                              body:@{ @"b64": b64 }];
                     }];

    [self.recEngine prepare];
    [self.recEngine startAndReturnError:nil];
    resolve(nil);
  }
  @catch (NSException *e) {
    reject(@"record_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopRecording
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self.recEngine.inputNode removeTapOnBus:0];
    [self.recEngine stop];
    self.recEngine = nil;
    resolve(nil);
  }
  @catch (NSException *e) {
    reject(@"record_stop_error", e.reason, nil);
  }
}

/* ================================================================== */
/*  2.  PCM PLAYBACK  (TTS / STREAMED CHUNKS)                         */
/* ================================================================== */

/**
 * Initialise / restart the playback engine for a specific PCM format.
 * @param sampleRate e.g. 16000
 * @param channels   1 (mono) or 2 (stereo)
 */
RCT_EXPORT_METHOD(startPlayer
                  :(nonnull NSNumber *)sampleRate   // e.g. 16000
                  channels:(nonnull NSNumber *)channels)   // 1
{
  [self stopPlayer:nil rejecter:nil];
  [self activateAudioSession];

  self.playEngine = [[AVAudioEngine alloc] init];
  self.player     = [[AVAudioPlayerNode alloc] init];

  /* PCM format matching Deepgram's output */
  self.pcmFormat  = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                                     sampleRate:sampleRate.doubleValue
                                                       channels:channels.unsignedIntValue
                                                    interleaved:NO];

  NSLog(@"[Deepgram] Starting player: %@ Hz, %@ channels", sampleRate, channels);
  NSLog(@"[Deepgram] Format: %@", self.pcmFormat);

  [self.playEngine attachNode:self.player];

  /* !!! pass `nil` so Core Audio inserts a SRC/channel converter */
  [self.playEngine connect:self.player
                        to:self.playEngine.mainMixerNode
                    format:nil];           // ← key change

  NSError *error = nil;
  BOOL success = [self.playEngine startAndReturnError:&error];
  if (!success) {
    NSLog(@"[Deepgram] Failed to start audio engine: %@", error.localizedDescription);
  } else {
    NSLog(@"[Deepgram] Audio engine started successfully");
  }
}

/**
 * Feed a base-64-encoded PCM chunk (matching the format set by startPlayer).
 */
RCT_EXPORT_METHOD(feedAudio
                  :(NSString *)b64)
{
  if (!self.pcmFormat) {
    NSLog(@"[Deepgram] feedAudio called but pcmFormat is nil");
    return;
  }

  NSData *data = [[NSData alloc] initWithBase64EncodedString:b64 options:0];
  if (!data) {
    NSLog(@"[Deepgram] Failed to decode base64 audio data");
    return;
  }

  uint32_t bytesPerFrame = (uint32_t)self.pcmFormat.streamDescription->mBytesPerFrame;
  uint32_t frames = (uint32_t)(data.length / bytesPerFrame);

  NSLog(@"[Deepgram] Feeding audio: %lu bytes, %u frames, %u channels", 
        (unsigned long)data.length, frames, (unsigned int)self.pcmFormat.channelCount);

  AVAudioPCMBuffer *buf =
      [[AVAudioPCMBuffer alloc] initWithPCMFormat:self.pcmFormat
                                    frameCapacity:frames];
  buf.frameLength = frames;

  // Handle both mono and stereo properly
  if (self.pcmFormat.channelCount == 1) {
    // Mono: copy all data to channel 0
    memcpy(buf.int16ChannelData[0], data.bytes, data.length);
    NSLog(@"[Deepgram] Copied %lu bytes to mono channel", (unsigned long)data.length);
  } else {
    // Stereo: interleaved data needs to be de-interleaved
    const int16_t *source = (const int16_t *)data.bytes;
    int16_t *leftChannel = buf.int16ChannelData[0];
    int16_t *rightChannel = buf.int16ChannelData[1];
    
    for (uint32_t i = 0; i < frames; i++) {
      leftChannel[i] = source[i * 2];     // Left channel
      rightChannel[i] = source[i * 2 + 1]; // Right channel
    }
    NSLog(@"[Deepgram] De-interleaved %u frames to stereo channels", frames);
  }
  
  [self.player scheduleBuffer:buf completionHandler:^{
    NSLog(@"[Deepgram] Audio buffer finished playing");
  }];

  if (!self.player.isPlaying) {
    [self.player play];
    NSLog(@"[Deepgram] Started audio playback");
  }
}

/**
 * Gracefully stop playback and release resources.
 */
RCT_EXPORT_METHOD(stopPlayer
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self.player stop];
    [self.playEngine stop];
    self.playEngine = nil;
    self.player     = nil;
    self.pcmFormat  = nil;
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    if (reject) reject(@"player_stop_error", e.reason, nil);
  }
}

/**
 * Play a base-64-encoded PCM chunk using the current player format.
 * Re-uses startPlayer(16000, 1) under the hood.
 */
RCT_EXPORT_METHOD(playAudioChunk
                  :(NSString *)chunk
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // Re-use startPlayer(16000,1) under the hood
  if (!self.pcmFormat ||                       // not set yet
    self.pcmFormat.sampleRate  != 16000 ||   // wrong rate
    self.pcmFormat.channelCount != 1)        // stereo? → re-init
  {
    [self startPlayer:@16000 channels:@1];     // builds the right format
  }

  // 2. Queue the audio
  [self feedAudio:chunk];

  // 3. Resolve the JS promise immediately (buffer plays async)
  if (resolve) resolve(nil);
}

@end
