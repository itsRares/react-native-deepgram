/**
 * Deepgram closes a streaming socket that receives neither audio nor a
 * KeepAlive frame for ~10 s (NET-0001).
 */
export const KEEPALIVE_INTERVAL_MS = 5_000;

export interface KeepAlive {
  /** Keep the socket warm until every `reason` has been released. */
  hold(reason: string): void;
  release(reason: string): void;
  isHeld(reason: string): boolean;
  clear(): void;
}

/** One shared KeepAlive timer that runs while at least one reason holds it. */
export function createKeepAlive(
  sendKeepAlive: () => void,
  intervalMs: number = KEEPALIVE_INTERVAL_MS
): KeepAlive {
  const reasons = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    hold(reason) {
      reasons.add(reason);
      if (timer == null) {
        timer = setInterval(sendKeepAlive, intervalMs);
      }
    },
    release(reason) {
      reasons.delete(reason);
      if (reasons.size === 0) {
        stop();
      }
    },
    isHeld(reason) {
      return reasons.has(reason);
    },
    clear() {
      reasons.clear();
      stop();
    },
  };
}
