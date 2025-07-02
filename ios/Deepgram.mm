#import "Deepgram.h"
#import <AVFoundation/AVFoundation.h>

@interface Deepgram()
@property(nonatomic,strong) AVAudioEngine *engine;
@property(nonatomic,strong) AVAudioPlayerNode *player;
@end

@implementation Deepgram

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"DeepgramAudioPCM"];
}

#pragma mark - Recording

RCT_EXPORT_METHOD(startRecording:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    if (!self.engine) {
      self.engine = [[AVAudioEngine alloc] init];
    }
    AVAudioInputNode *input = self.engine.inputNode;
    AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
    [input removeTapOnBus:0];
    __weak __typeof(self) weakSelf = self;
    [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
      if (!weakSelf) return;
      NSUInteger frames = buffer.frameLength;
      int16_t *samples = buffer.int16ChannelData[0];
      NSMutableArray *array = [NSMutableArray arrayWithCapacity:frames * 2];
      for (NSUInteger i = 0; i < frames; i++) {
        [array addObject:@(samples[i] & 0xFF)];
        [array addObject:@((samples[i] >> 8) & 0xFF)];
      }
      [weakSelf sendEventWithName:@"DeepgramAudioPCM" body:@{ @"data": array }];
    }];
    [self.engine prepare];
    [self.engine startAndReturnError:nil];
    resolve(nil);
  } @catch (NSException *e) {
    reject(@"record_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopRecording:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self.engine.inputNode removeTapOnBus:0];
    [self.engine stop];
    self.engine = nil;
    resolve(nil);
  } @catch (NSException *e) {
    reject(@"record_stop_error", e.reason, nil);
  }
}

#pragma mark - Playback

- (void)ensurePlayer
{
  if (!self.engine) {
    self.engine = [[AVAudioEngine alloc] init];
  }
  if (!self.player) {
    self.player = [[AVAudioPlayerNode alloc] init];
    [self.engine attachNode:self.player];
    AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
    [self.engine connect:self.player to:self.engine.mainMixerNode format:format];
    [self.engine prepare];
    [self.engine startAndReturnError:nil];
  }
}

RCT_EXPORT_METHOD(startAudio:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self ensurePlayer];
    [self.player play];
    resolve(nil);
  } @catch (NSException *e) {
    reject(@"audio_start_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(stopAudio:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self.player stop];
    [self.engine stop];
    self.player = nil;
    self.engine = nil;
    resolve(nil);
  } @catch (NSException *e) {
    reject(@"audio_stop_error", e.reason, nil);
  }
}

RCT_EXPORT_METHOD(playAudioChunk:(NSString *)chunk resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  @try {
    [self ensurePlayer];
    NSData *data = [[NSData alloc] initWithBase64EncodedString:chunk options:0];
    if (!data) { reject(@"decode_error", @"invalid base64", nil); return; }
    AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:(uint32_t)(data.length / 2)];
    buffer.frameLength = buffer.frameCapacity;
    memcpy(buffer.int16ChannelData[0], data.bytes, data.length);
    [self.player scheduleBuffer:buffer completionHandler:nil];
    resolve(nil);
  } @catch (NSException *e) {
    reject(@"play_error", e.reason, nil);
  }
}

@end
