#import "DGSupport.h"
#import "Deepgram.h"

#import <AudioToolbox/AudioQueue.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Microphone capture. Two capture paths live in the implementation: the
 * AudioQueue path (STT-only, no echo cancellation) and the `AVAudioEngine`
 * path (Voice Agent / duplex, with VPIO hardware AEC).
 */
@interface Deepgram (Recording)

- (void)emitPCMChunk:(NSData *)chunk sampleRate:(int)sampleRate;
- (void)appendPCMDataAndEmitIfNeeded:(NSData *)pcmData;
- (void)flushPendingPCM;
- (void)cleanupRecordingQueue;
- (BOOL)startEngineCaptureAndReturnError:(NSError **)outError;
- (void)stopEngineCapture;

- (BOOL)beginRecordingToFileIfRequested:(nullable NSDictionary *)options
                                  error:(NSError *_Nullable *_Nullable)outError;
- (nullable NSString *)finishRecordingToFile;
- (void)discardRecordingFile;

@end

/**
 * AudioQueue input callback. Defined in `Deepgram+Recording.mm`; referenced by
 * `startRecording` in `Deepgram.mm`, so it must have external linkage.
 * `inPacketDesc` is NULL for constant-bit-rate formats such as LPCM.
 */
extern void DGHandleInputBuffer(
    void *inUserData, AudioQueueRef inAQ, AudioQueueBufferRef inBuffer,
    const AudioTimeStamp *inStartTime, UInt32 inNumPackets,
    const AudioStreamPacketDescription *_Nullable inPacketDesc);

NS_ASSUME_NONNULL_END
