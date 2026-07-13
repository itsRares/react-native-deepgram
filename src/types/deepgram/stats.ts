/**
 * Session telemetry counters for the live STT and Voice Agent hooks.
 * Opt in with `trackStats: true` for throttled (≤1 Hz) reactive updates via
 * the hooks' `stats` return value; the imperative `getStats()` snapshot is
 * always available and never causes re-renders.
 */
export interface SessionStats {
  /** Bytes of audio sent over the socket (decoded frame size). */
  bytesSent: number;
  /** Bytes of binary audio received over the socket (agent/TTS audio). */
  bytesReceived: number;
  /**
   * Mic frames skipped instead of sent (paused/muted, gated, or the socket
   * was not open — e.g. during a reconnect gap).
   */
  framesDropped: number;
  /** Number of reconnect attempts scheduled during the session. */
  reconnects: number;
  /** Epoch ms when the socket (most recently) opened; null before connect. */
  connectedAtMs: number | null;
  /**
   * Milliseconds from socket open to the first transcript (STT) or first
   * agent audio (Voice Agent); null until the first result arrives.
   */
  firstResultMs: number | null;
}

/** @internal Fresh zeroed counters for the start of a session. */
export const createEmptySessionStats = (): SessionStats => ({
  bytesSent: 0,
  bytesReceived: 0,
  framesDropped: 0,
  reconnects: 0,
  connectedAtMs: null,
  firstResultMs: null,
});
