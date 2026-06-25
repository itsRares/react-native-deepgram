#import "Deepgram.h"

#import <AVFoundation/AVFoundation.h>

/**
 * TTS / Voice Agent audio output through an `AVAudioPlayerNode` on the shared
 * `AVAudioEngine`. When voice processing is requested the same engine drives
 * both output and capture so the VPIO Audio Unit can cancel our own output out
 * of the captured input (hardware echo cancellation).
 */
@interface Deepgram (Playback)

- (void)stopAndDetachPlayerNode;
- (void)interruptPlayerPlayback;
- (BOOL)setupAudioEngineWithSampleRate:(int)sampleRate
                              channels:(int)channels
                 enableVoiceProcessing:(BOOL)enableVoiceProcessing
                                 error:(NSError **)outError;
- (AVAudioPCMBuffer *)createPCMBufferFromData:(NSData *)data;

@end
