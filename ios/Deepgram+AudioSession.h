#import "Deepgram.h"

#import <AVFoundation/AVFoundation.h>

/**
 * Audio-session lifecycle: activation/deactivation, the category fallback
 * ladder (sensitive to OSStatus -50) and the route-change / interruption /
 * media-services-reset notification handlers.
 */
@interface Deepgram (AudioSession)

- (BOOL)activateAudioSession:(NSError **)outError;
- (void)deactivateAudioSession;
- (BOOL)configureAudioSessionIfNeeded:(NSError **)outError;
- (BOOL)configureAudioSession:(NSError **)outError;
- (BOOL)configureAudioSessionForRecording:(BOOL)needsMicrophone
                                    error:(NSError **)outError;
- (AVAudioSessionCategoryOptions)bluetoothHFPOption;
- (BOOL)applyAudioSessionCategory:(AVAudioSessionCategory)category
                             mode:(NSString *)mode
                          options:(AVAudioSessionCategoryOptions)options
                            error:(NSError **)outError;
- (void)maybeDeactivateAudioSession;
- (void)handleAudioRouteChange:(NSNotification *)note;
- (void)handleMediaServicesReset:(NSNotification *)note;
- (void)handleAudioInterruption:(NSNotification *)note;
- (void)handleEngineConfigurationChange:(NSNotification *)note;

// Audio output routing (speaker / earpiece / bluetooth / auto).
- (BOOL)applyAudioRoute:(NSString *)route error:(NSError **)outError;
- (void)applyRequestedRouteToSession;
- (NSString *)currentAudioRouteString;
- (void)emitRouteChange;

@end
