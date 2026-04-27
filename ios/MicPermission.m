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
  // iOS 17+ deprecated `[AVAudioSession requestRecordPermission:]` in favor of
  // `[AVAudioApplication requestRecordPermissionWithCompletionHandler:]`.
  // Resolve the new API dynamically so we keep working on older iOS versions
  // without raising a deprecation warning when building against newer SDKs.
  Class audioApplicationClass = NSClassFromString(@"AVAudioApplication");
  SEL newSelector = NSSelectorFromString(@"requestRecordPermissionWithCompletionHandler:");

  if (audioApplicationClass && [audioApplicationClass respondsToSelector:newSelector]) {
    void (^handler)(BOOL) = ^(BOOL granted) {
      resolve(@(granted));
    };
    NSMethodSignature *signature = [audioApplicationClass methodSignatureForSelector:newSelector];
    NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:signature];
    invocation.target = audioApplicationClass;
    invocation.selector = newSelector;
    [invocation setArgument:&handler atIndex:2];
    [invocation invoke];
    return;
  }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
    resolve(@(granted));
  }];
#pragma clang diagnostic pop
}
@end
