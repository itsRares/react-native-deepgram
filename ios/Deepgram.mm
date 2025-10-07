#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

@interface Deepgram : RCTEventEmitter <AVAudioPlayerDelegate>
// Recording
@property (nonatomic, strong) AVAudioEngine      *recEngine;

// Playback / TTS
@property (nonatomic, strong) AVAudioPlayer      *audioPlayer;
@property (nonatomic, strong) NSMutableData      *audioBuffer;
@property (nonatomic, assign) BOOL                isPlaying;
@property (nonatomic, assign) int                 currentSampleRate;
@property (nonatomic, assign) BOOL                audioSessionConfigured;
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
- (instancetype)init
{
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(handleAudioRouteChange:)
               name:AVAudioSessionRouteChangeNotification
             object:nil];
  }
  return self;
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)activateAudioSession
{
  if ([NSThread isMainThread]) {
    [self configureAudioSessionIfNeeded];
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      [self configureAudioSessionIfNeeded];
    });
  }
}

- (void)configureAudioSessionIfNeeded
{
  if (!self.audioSessionConfigured) {
    [self configureAudioSession];
  } else {
    NSError *activeError = nil;
    [[AVAudioSession sharedInstance]
        setActive:YES
        withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
              error:&activeError];
    if (activeError) {
      NSLog(@"[Deepgram] Failed to keep audio session active: %@",
            activeError.localizedDescription);
    }
  }
}

- (void)configureAudioSession
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;

  AVAudioSessionCategoryOptions options =
      AVAudioSessionCategoryOptionDefaultToSpeaker |
      AVAudioSessionCategoryOptionAllowBluetooth;

  if (@available(iOS 10.0, *)) {
    options |= AVAudioSessionCategoryOptionAllowBluetoothA2DP;
    error = nil;
    BOOL ok = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                              mode:AVAudioSessionModeVoiceChat
                           options:options
                             error:&error];
    if (!ok || error) {
      NSLog(@"[Deepgram] Failed to set audio session category: %@",
            error.localizedDescription);
    }
  } else {
    BOOL ok = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                       withOptions:options
                             error:&error];
    if (!ok || error) {
      NSLog(@"[Deepgram] Failed to set audio session category: %@",
            error.localizedDescription);
    }

    error = nil;
    BOOL modeOk = [session setMode:AVAudioSessionModeVoiceChat error:&error];
    if (!modeOk || error) {
      NSLog(@"[Deepgram] Failed to set audio session mode: %@",
            error.localizedDescription);
    }
  }

  error = nil;
  if (![session setPreferredSampleRate:48000 error:&error] && error) {
    NSLog(@"[Deepgram] Failed to set preferred sample rate: %@",
          error.localizedDescription);
  }

  error = nil;
  if (![session setPreferredIOBufferDuration:0.01 error:&error] && error) {
    NSLog(@"[Deepgram] Failed to set IO buffer duration: %@",
          error.localizedDescription);
  }

  if (@available(iOS 10.0, *)) {
    error = nil;
    if (![session setPreferredInputNumberOfChannels:1 error:&error] && error) {
      NSLog(@"[Deepgram] Failed to set preferred input channels: %@",
            error.localizedDescription);
    }

    error = nil;
    if (![session setPreferredOutputNumberOfChannels:1 error:&error] && error) {
      NSLog(@"[Deepgram] Failed to set preferred output channels: %@",
            error.localizedDescription);
    }
  }

  [self routeToBuiltInMic:session];

  error = nil;
  if (![session setActive:YES
               withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                     error:&error] && error) {
    NSLog(@"[Deepgram] Failed to activate audio session: %@",
          error.localizedDescription);
  }

  error = nil;
  if (![session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker
                                  error:&error] && error) {
    NSLog(@"[Deepgram] Failed to force speaker output: %@",
          error.localizedDescription);
  }

  self.audioSessionConfigured = YES;
}

- (void)routeToBuiltInMic:(AVAudioSession *)session
{
  if (!session) {
    return;
  }

  for (AVAudioSessionPortDescription *input in session.currentRoute.inputs) {
    NSString *portType = input.portType;
    BOOL isBluetoothLE = NO;
    if (@available(iOS 10.0, *)) {
      isBluetoothLE = [portType isEqualToString:AVAudioSessionPortBluetoothLE];
    }

    if ([portType isEqualToString:AVAudioSessionPortBluetoothHFP] ||
        [portType isEqualToString:AVAudioSessionPortHeadsetMic] ||
        isBluetoothLE) {
      return;
    }
  }

  for (AVAudioSessionPortDescription *port in session.availableInputs) {
    if ([port.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
      NSError *error = nil;
      if (![session setPreferredInput:port error:&error] && error) {
        NSLog(@"[Deepgram] Failed to pin built-in mic: %@",
              error.localizedDescription);
      }

      if (@available(iOS 10.0, *)) {
        AVAudioSessionDataSourceDescription *front = nil;
        for (AVAudioSessionDataSourceDescription *source in port.dataSources) {
          if ([source.orientation isEqualToString:AVAudioSessionOrientationFront]) {
            front = source;
            break;
          }
        }

        if (front) {
          NSError *dataSourceError = nil;
          if (![port setPreferredDataSource:front error:&dataSourceError] &&
              dataSourceError) {
            NSLog(@"[Deepgram] Failed to set mic data source: %@",
                  dataSourceError.localizedDescription);
          }
        }
      }

      break;
    }
  }
}

- (void)handleAudioRouteChange:(NSNotification *)note
{
  self.audioSessionConfigured = NO;
  [self activateAudioSession];
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

RCT_EXPORT_METHOD(startAudio
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self activateAudioSession];
    if (!self.audioBuffer) {
      self.audioBuffer = [[NSMutableData alloc] init];
    }
    if (self.currentSampleRate <= 0) {
      self.currentSampleRate = 16000;
    }
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
    if (reject) reject(@"audio_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopAudio
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self stopPlayer:nil rejecter:nil];
    if (resolve) resolve(nil);
  }
  @catch (NSException *e) {
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
  [self stopPlayer:nil rejecter:nil];
  [self activateAudioSession];
  
  self.audioBuffer = [[NSMutableData alloc] init];
  self.isPlaying = NO;
  self.currentSampleRate = sampleRate.intValue;
}

/**
 * Add audio data to the buffer for streaming playback.
 */
RCT_EXPORT_METHOD(feedAudio:(NSString *)b64)
{
  if (!self.audioBuffer) {
    // Use default sample rate if not set
    int defaultSampleRate = self.currentSampleRate > 0 ? self.currentSampleRate : 16000;
    [self startPlayer:@(defaultSampleRate) channels:@1];
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
  
  NSData *wavData = [self createWAVHeaderForPCMData:self.audioBuffer sampleRate:self.currentSampleRate];
  
  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithData:wavData error:&error];
  
  if (error) {
    return;
  }
  
  self.audioPlayer = player;
  self.audioPlayer.delegate = self;
  
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
  NSData *wavData = [self createWAVHeaderForPCMData:pcmData sampleRate:self.currentSampleRate];
  
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
