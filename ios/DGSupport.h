#import <AudioToolbox/AudioToolbox.h>
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>

/**
 * Shared, state-free support for the Deepgram native module: logging macros,
 * error helpers and the recording-state struct. Kept in one header so the main
 * implementation and its category files (`Deepgram+AudioSession.mm`,
 * `Deepgram+Recording.mm`, `Deepgram+Playback.mm`) all share a single copy.
 */

#define DGNumberBuffers 3

#ifndef DG_ENABLE_DEBUG_LOGS
#define DG_ENABLE_DEBUG_LOGS 0
#endif

#if DG_ENABLE_DEBUG_LOGS
#define DGLogDebug(...) NSLog(__VA_ARGS__)
#else
#define DGLogDebug(...)
#endif

#define DGLogWarn(...) RCTLogWarn(__VA_ARGS__)
#define DGLogError(...) RCTLogError(__VA_ARGS__)

@class Deepgram;

/** Backing state for the AudioQueue-based microphone capture path. */
typedef struct {
  __unsafe_unretained Deepgram *mSelf;
  AudioStreamBasicDescription dataFormat;
  AudioQueueRef queue;
  AudioQueueBufferRef buffers[DGNumberBuffers];
  UInt32 bufferByteSize;
  SInt64 currentPacket;
  bool isRunning;
} DGRecordState;

/** Build a generic native error with a localized description. */
static inline NSError *DGNativeError(NSString *domain, NSInteger code,
                                     NSString *message) {
  return [NSError errorWithDomain:domain
                             code:code
                         userInfo:@{
                           NSLocalizedDescriptionKey : message
                               ?: @"Unknown Deepgram native error"
                         }];
}

/** Wrap an OSStatus failure from a named CoreAudio operation. */
static inline NSError *DGOSStatusError(NSString *operation, OSStatus status) {
  NSString *message = [NSString
      stringWithFormat:@"%@ failed with OSStatus %d", operation, (int)status];
  return DGNativeError(NSOSStatusErrorDomain, (NSInteger)status, message);
}

/**
 * Reject a promise with a guaranteed-concrete `NSError`. Passing `nil` for the
 * error synthesizes one so JS never sees a generic "unknown error from native
 * module" that hides the real cause.
 */
static inline void DGRejectPromise(RCTPromiseRejectBlock reject, NSString *code,
                                   NSString *message, NSError *error) {
  if (!reject) {
    return;
  }

  NSString *safeCode = code ?: @"deepgram_native_error";
  NSString *safeMessage = message ?: error.localizedDescription
                              ?: @"Deepgram native error";
  NSError *safeError =
      error ?: DGNativeError(@"DeepgramNativeError", 0, safeMessage);
  DGLogError(@"[Deepgram] reject: code=%@ message=%@", safeCode, safeMessage);
  reject(safeCode, safeMessage, safeError);
}
