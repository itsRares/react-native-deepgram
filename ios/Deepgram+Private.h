#import "DGSupport.h"
#import "Deepgram.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>

#include <atomic>

/**
 * Shared instance state for the `Deepgram` module. Deliberately one class:
 * the audio session, `AVAudioEngine`, and record/playback state are mutually
 * dependent. Behaviour is split across category files — Deepgram+AudioSession
 * (session lifecycle), +Recording (mic capture), +Playback (TTS / Voice Agent
 * playback) — each with a matching header. Only the shared state lives here,
 * in a class extension, so it auto-synthesizes in the primary
 * `@implementation` while remaining visible to every category.
 */
NS_ASSUME_NONNULL_BEGIN

@interface Deepgram () {
@protected
  DGRecordState _recordState;
  std::atomic<int> _scheduledBufferCount;
  std::atomic<int> _playbackGeneration;
}

// Recording
@property(nonatomic, strong, nullable) NSMutableData *pendingPCMBuffer;
@property(nonatomic, strong) dispatch_queue_t emitterQueue;
// Serial queue for every spec method and system notification, so session /
// engine state is never mutated from two threads at once.
@property(nonatomic, strong) dispatch_queue_t audioQueue;
@property(nonatomic, strong) NSMutableArray<id<NSObject>> *notificationTokens;
@property(nonatomic, assign) NSUInteger chunkSizeBytes;
@property(atomic, assign) BOOL appIsActive;
// Rate of the emitted mic PCM; independent of the playback rate below.
@property(atomic, assign) int captureSampleRate;

// Microphone metering: when enabled, the recording sink computes a normalized
// RMS amplitude (0..1) and emits `onAudioLevel` at most once per
// interval (`lastMeterEmitTime` throttles via CACurrentMediaTime()).
@property(atomic, assign) BOOL meteringEnabled;
@property(atomic, assign) NSTimeInterval meteringIntervalSeconds;
@property(atomic, assign) NSTimeInterval lastMeterEmitTime;

// Record-to-file: when enabled, the capture sink tees every 16 kHz PCM16 mono
// buffer into a WAV file alongside the live stream; RIFF/`data` sizes are
// patched into the header on stop. Writes happen on the capture thread and
// finalization runs after capture has stopped, so no lock is required.
@property(nonatomic, strong, nullable) NSFileHandle *recordFileHandle;
@property(nonatomic, copy, nullable) NSString *recordFilePath;
@property(atomic, assign) BOOL recordToFileEnabled;
@property(atomic, assign) unsigned long long recordFileDataBytes;

// Playback / TTS (AVAudioEngine-based with echo cancellation)
@property(nonatomic, strong, nullable) AVAudioEngine *audioEngine;
@property(nonatomic, strong, nullable) AVAudioPlayerNode *playerNode;
@property(nonatomic, strong, nullable) AVAudioFormat *playbackFormat;
@property(atomic, assign) BOOL isPlaying;
// Playback (player node) sample rate.
@property(atomic, assign) int currentSampleRate;
@property(nonatomic, assign) BOOL audioSessionConfigured;
// YES while capturing via `audioEngine.inputNode` (Voice Agent / duplex):
// bypasses the AudioQueue path and requires VoiceChat mode so Apple's VPIO
// unit engages hardware echo cancellation.
@property(atomic, assign) BOOL engineCaptureActive;
@property(atomic, assign) BOOL voiceProcessingRequested;
@property(atomic, assign) BOOL audioQueueCaptureRequested;
// YES between interruption Began and Ended. While set, `setActive:YES` is
// doomed (phone call / Siri holds the hardware) — route/config handlers must
// not reactivate; the interruption-ended handler does.
@property(atomic, assign) BOOL sessionInterrupted;

// Last explicit route request from JS (`speaker`/`earpiece`/`bluetooth`);
// nil means `auto`. Shapes the category-option ladder (BT HFP only on the
// AEC/VoiceChat path when explicitly requested — auto-routing the duplex
// agent onto BT defeats VPIO echo cancellation), is applied once per
// successful configuration, and is *adopted from* external route changes
// rather than re-asserted against them.
@property(atomic, copy, nullable) NSString *requestedAudioRoute;
@property(nonatomic, strong, nullable) AVAudioConverter *captureConverter;
@property(nonatomic, strong, nullable) AVAudioFormat *captureOutputFormat;

// Spec methods invoked before their textual definition in Deepgram.mm;
// declared here to avoid -Wundeclared-selector.
- (void)startPlayer:(double)sampleRate channels:(double)channels;
- (void)stopPlayer:(nullable RCTPromiseResolveBlock)resolve
            reject:(nullable RCTPromiseRejectBlock)reject;

@end

NS_ASSUME_NONNULL_END
