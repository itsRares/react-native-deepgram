#import "Deepgram.h"
#import <AVFoundation/AVFoundation.h>

@interface Deepgram ()
@property (nonatomic, strong) AVAudioEngine *engine;
@property (nonatomic, strong) AVAudioPlayerNode *player;
@end

@implementation Deepgram
RCT_EXPORT_MODULE();

/* ------------------------------------------------------------------ */
/*  React-Native boilerplate                                          */
/* ------------------------------------------------------------------ */

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents
{
  // Single outbound event: base-64-encoded PCM captured from the mic
  return @[ @"DeepgramAudioPCM" ];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

- (void)ensureAudioSession
{
  AVAudioSession *session = [AVAudioSession sharedInstance];

  // Play & record, default to the speaker
  [session setCategory:AVAudioSessionCategoryPlayAndRecord
           withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker
                 error:nil];

  // Hardware sample-rate is 48 kHz on all modern iPhones; no override
  // (removing the previous 16 kHz preference eliminates the mismatch warning)

  [session setActive:YES error:nil];
}

- (void)ensurePlayer
{
  if (!self.engine) self.engine = [[AVAudioEngine alloc] init];

  if (!self.player) {
    BOOL wasRunning = self.engine.isRunning;
    if (wasRunning) [self.engine stop]; 

    self.player = [[AVAudioPlayerNode alloc] init];
    [self.engine attachNode:self.player];
    [self.engine connect:self.player
                      to:self.engine.mainMixerNode
                  format:nil];

    if (wasRunning) {
      [self.engine prepare];
      [self.engine startAndReturnError:nil]; 
    }
  }
}


/* ------------------------------------------------------------------ */
/*  Recording – 48 000 Hz / Float-32                                   */
/* ------------------------------------------------------------------ */

RCT_EXPORT_METHOD(startRecording
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    if (!self.engine) self.engine = [[AVAudioEngine alloc] init];
    [self ensureAudioSession];

    AVAudioInputNode *input = self.engine.inputNode;
    // Tap in the **hardware format** (≈ 48 kHz, Float-32)
    AVAudioFormat *hwFormat = [input outputFormatForBus:0];

    [input removeTapOnBus:0];   // clean previous taps

    __weak __typeof(self) weakSelf = self;
    [input installTapOnBus:0
                bufferSize:1024
                    format:hwFormat
                     block:^(AVAudioPCMBuffer *buf, AVAudioTime *when) {
                       if (!weakSelf) return;

                       // buf.floatChannelData[0] → NSData (Float32 little-endian)
                       NSData *pcm =
                         [NSData dataWithBytes:buf.floatChannelData[0]
                                         length:buf.frameLength * sizeof(float)];
                       NSString *b64 =
                         [pcm base64EncodedStringWithOptions:0];

                       [weakSelf sendEventWithName:@"DeepgramAudioPCM"
                                              body:@{ @"b64": b64 }];
                     }];

    [self.engine prepare];
    [self.engine startAndReturnError:nil];
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
    [self.engine.inputNode removeTapOnBus:0];
    [self.engine stop];
    self.engine = nil;
    resolve(nil);
  }
  @catch (NSException *e) {
    reject(@"record_stop_error", e.reason, nil);
  }
}

/* ------------------------------------------------------------------ */
/*  Playback                                                          */
/* ------------------------------------------------------------------ */

RCT_EXPORT_METHOD(startAudio
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self ensurePlayer];
    [self.player play];
    resolve(nil);
  }
  @catch (NSException *e) {
    reject(@"audio_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopAudio
                  :(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self.player stop];
    [self.engine stop];
    self.player = nil;
    self.engine = nil;
    resolve(nil);
  }
  @catch (NSException *e) {
    reject(@"audio_stop_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(playAudioChunk
                  :(NSString *)chunk
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self ensurePlayer];

    // base-64 string → NSData
    NSData *data =
      [[NSData alloc] initWithBase64EncodedString:chunk options:0];
    if (!data) {
      reject(@"decode_error", @"invalid base64", nil);
      return;
    }

    AVAudioFormat *pcm16 =
      [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                       sampleRate:16000
                                         channels:1
                                      interleaved:YES];

    uint32_t frames = (uint32_t)(data.length / 2);
    AVAudioPCMBuffer *buffer =
      [[AVAudioPCMBuffer alloc] initWithPCMFormat:pcm16
                                    frameCapacity:frames];
    buffer.frameLength = frames;

    memcpy(buffer.int16ChannelData[0], data.bytes, data.length);
    [self.player scheduleBuffer:buffer completionHandler:nil];

    resolve(nil);
  }
  @catch (NSException *e) {
    reject(@"play_error", e.reason, nil);
  }
}

@end
