#import "DGSupport.h"
#import "Deepgram.h"

#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioQueue.h>
#import <React/RCTEventEmitter.h>

#include <atomic>

/**
 * Shared instance state for the `Deepgram` module. The class is deliberately
 * kept as a single unit (rather than split into collaborator objects) because
 * the audio session, the `AVAudioEngine` and the record/playback state are
 * mutually dependent — the session configuration, for example, has to reason
 * about recording and playback at the same time.
 *
 * Behaviour is split across category files for readability; each declares its
 * own methods in a matching category header:
 *   - Deepgram+AudioSession.h / .mm : audio session lifecycle
 *   - Deepgram+Recording.h    / .mm : microphone capture
 *   - Deepgram+Playback.h     / .mm : TTS / Voice Agent playback
 *
 * Only the shared state lives here, in a class extension, so it auto-synthesizes
 * in the primary `@implementation` while remaining visible to every category.
 */
@interface Deepgram () {
@protected
  DGRecordState _recordState;
  std::atomic<int> _scheduledBufferCount;
  std::atomic<int> _playbackGeneration;
}

// Recording
@property(nonatomic, strong) NSMutableData *pendingPCMBuffer;
@property(nonatomic, strong) dispatch_queue_t emitterQueue;
@property(nonatomic, assign) NSUInteger chunkSizeBytes;
@property(atomic, assign) BOOL hasListeners;
@property(atomic, assign) BOOL appIsActive;

// Microphone metering (audio-level events). Purely additive — when
// `meteringEnabled` is YES the recording sink computes a normalized RMS
// amplitude (0..1) and emits a `DeepgramAudioLevel` event at most once per
// `meteringIntervalSeconds`. `lastMeterEmitTime` is a CACurrentMediaTime()
// timestamp used to throttle emission.
@property(atomic, assign) BOOL meteringEnabled;
@property(atomic, assign) NSTimeInterval meteringIntervalSeconds;
@property(atomic, assign) NSTimeInterval lastMeterEmitTime;

// Record-to-file. When `recordToFileEnabled` is YES the shared
// capture sink tees every captured 16 kHz PCM16 mono buffer into a WAV file
// alongside the live Deepgram stream. The RIFF/`data` sizes (and the final
// sample rate) are patched into the 44-byte header when recording stops.
// Writes happen on the capture thread (single producer); finalization runs
// after the capture queue/engine has been stopped, so no lock is required.
@property(nonatomic, strong) NSFileHandle *recordFileHandle;
@property(nonatomic, copy) NSString *recordFilePath;
@property(atomic, assign) BOOL recordToFileEnabled;
@property(atomic, assign) unsigned long long recordFileDataBytes;

// User-requested audio output route: `speaker` / `earpiece` / `bluetooth` /
// `auto` (nil means `auto`). Re-applied after every session (re)configuration
// so it survives playback/recording restarts.
@property(atomic, copy) NSString *requestedAudioRoute;

// Playback / TTS (AVAudioEngine-based with echo cancellation)
@property(nonatomic, strong) AVAudioEngine *audioEngine;
@property(nonatomic, strong) AVAudioPlayerNode *playerNode;
@property(nonatomic, strong) AVAudioFormat *playbackFormat;
@property(atomic, assign) BOOL isPlaying;
@property(atomic, assign) int currentSampleRate;
@property(nonatomic, assign) BOOL audioSessionConfigured;
// YES while we're capturing the microphone through `audioEngine.inputNode`
// (Voice Agent / duplex). When YES, the AudioQueue path is bypassed and the
// session must use VoiceChat mode so Apple's Voice-Processing I/O Audio Unit
// engages and performs hardware echo cancellation.
@property(atomic, assign) BOOL engineCaptureActive;
@property(atomic, assign) BOOL voiceProcessingRequested;
@property(atomic, assign) BOOL audioQueueCaptureRequested;
@property(nonatomic, strong) AVAudioConverter *captureConverter;
@property(nonatomic, strong) AVAudioFormat *captureOutputFormat;

// Exported workers implemented in Deepgram.mm (via RCT_EXPORT_METHOD) but
// invoked from other methods before their textual definition. Declared here so
// those call sites don't trip -Wundeclared-selector.
- (void)startPlayer:(nonnull NSNumber *)sampleRate
           channels:(nonnull NSNumber *)channels;
- (void)stopPlayer:(nullable RCTPromiseResolveBlock)resolve
          rejecter:(nullable RCTPromiseRejectBlock)reject;

@end
