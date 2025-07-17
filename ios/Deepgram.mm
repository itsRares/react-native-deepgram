#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface Deepgram : RCTEventEmitter <AVAudioPlayerDelegate>
// Recording
@property (nonatomic, strong) AVAudioEngine      *recEngine;

// Playback / TTS
@property (nonatomic, strong) AVAudioPlayer      *audioPlayer;
@property (nonatomic, strong) NSMutableData      *audioBuffer;
@property (nonatomic, assign) BOOL                isPlaying;
@end

@implementation Deepgram
RCT_EXPORT_MODULE();

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
  
  [s setCategory:AVAudioSessionCategoryPlayAndRecord
     withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker | 
                AVAudioSessionCategoryOptionAllowBluetooth
           error:&error];
  
  [s setActive:YES error:&error];
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
  [self stopPlayer:nil rejecter:nil];
  [self activateAudioSession];
  
  self.audioBuffer = [[NSMutableData alloc] init];
  self.isPlaying = NO;
}

/**
 * Add audio data to the buffer for streaming playback.
 */
RCT_EXPORT_METHOD(feedAudio:(NSString *)b64)
{
  if (!self.audioBuffer) {
    [self startPlayer:@16000 channels:@1];
  }
  
  NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:b64 options:0];
  if (!pcmData || pcmData.length == 0) {
    return;
  }
  
  [self.audioBuffer appendData:pcmData];
  
  if (!self.isPlaying && self.audioBuffer.length > 1000) {
    [self playAccumulatedAudio];
  }
}

/**
 * Play accumulated audio buffer for streaming.
 */
- (void)playAccumulatedAudio {
  if (!self.audioBuffer || self.audioBuffer.length == 0) {
    return;
  }
  
  NSData *wavData = [self createWAVHeaderForPCMData:self.audioBuffer sampleRate:16000];
  
  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:wavData error:&error];
  
  if (error) {
    return;
  }
  
  self.audioPlayer = player;
  self.audioPlayer.delegate = (id<AVAudioPlayerDelegate>)self;
  
  self.isPlaying = YES;
  [player prepareToPlay];
  BOOL success = [player play];
  
  if (success) {
    [self.audioBuffer setLength:0];
  } else {
    self.isPlaying = NO;
  }
}

/**
 * Play PCM data immediately using AVAudioPlayer.
 */
- (void)playPCMData:(NSData *)pcmData {
  NSData *wavData = [self createWAVHeaderForPCMData:pcmData sampleRate:16000];
  
  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:wavData error:&error];
  
  if (error) {
    return;
  }
  
  self.audioPlayer = player;
  [player prepareToPlay];
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
    if (self.audioPlayer) {
      [self.audioPlayer stop];
      self.audioPlayer = nil;
    }
    
    self.audioBuffer = nil;
    self.isPlaying = NO;
    

    
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    NSLog(@"[Deepgram] Error stopping player: %@", e.reason);
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
    NSData *pcmData = [[NSData alloc] initWithBase64EncodedString:chunk options:0];
    if (!pcmData) {
      if (reject) reject(@"invalid_data", @"Failed to decode audio data", nil);
      return;
    }
    
    [self playPCMData:pcmData];
    
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    if (reject) reject(@"playback_error", e.reason, nil);
  }
}

/* ================================================================== */
/*  3.  AVAUDIOPLAYER DELEGATE METHODS                                */
/* ================================================================== */

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag {
  self.isPlaying = NO;
  
  if (self.audioBuffer && self.audioBuffer.length > 0) {
    [self playAccumulatedAudio];
  }
}

- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer *)player error:(NSError *)error {
  self.isPlaying = NO;
}

@end
