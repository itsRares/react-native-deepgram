#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>

@interface MicPermission : NSObject <RCTBridgeModule>
@end

@implementation MicPermission
RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(request,
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
    resolve(@(granted));
  }];
}
@end
