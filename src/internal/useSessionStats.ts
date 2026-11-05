import { useCallback, useEffect, useRef, useState } from 'react';
import { createEmptySessionStats } from '../types/deepgram/stats';
import type { SessionStats } from '../types/deepgram/stats';

const STATS_PUBLISH_INTERVAL_MS = 1_000;

/**
 * Session telemetry counters. Mutations via `update` never re-render; with
 * `track` enabled a timer publishes changed counters to `stats` at most once
 * per second.
 */
export function useSessionStats(track: boolean) {
  const statsRef = useRef<SessionStats>(createEmptySessionStats());
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stats, setStats] = useState<SessionStats>(createEmptySessionStats);

  const update = useCallback((mutate: (stats: SessionStats) => void) => {
    mutate(statsRef.current);
    dirtyRef.current = true;
  }, []);

  /** Stamp time-to-first-result once per connection. */
  const markFirstResult = useCallback(() => {
    const current = statsRef.current;
    if (current.firstResultMs == null && current.connectedAtMs != null) {
      current.firstResultMs = Date.now() - current.connectedAtMs;
      dirtyRef.current = true;
    }
  }, []);

  const reset = useCallback(() => {
    statsRef.current = createEmptySessionStats();
    dirtyRef.current = false;
    if (track) {
      setStats({ ...statsRef.current });
    }
  }, [track]);

  const stopPublishing = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startPublishing = useCallback(() => {
    if (!track || timerRef.current != null) {
      return;
    }
    timerRef.current = setInterval(() => {
      if (!dirtyRef.current) {
        return;
      }
      dirtyRef.current = false;
      setStats({ ...statsRef.current });
    }, STATS_PUBLISH_INTERVAL_MS);
  }, [track]);

  useEffect(() => stopPublishing, [stopPublishing]);

  const getStats = useCallback(
    (): SessionStats => ({ ...statsRef.current }),
    []
  );

  return {
    stats,
    update,
    markFirstResult,
    reset,
    startPublishing,
    stopPublishing,
    getStats,
  };
}
