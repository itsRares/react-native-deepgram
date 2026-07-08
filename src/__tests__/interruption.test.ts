const listeners: Record<string, ((payload: unknown) => void)[]> = {};
const mockRemove = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { Deepgram: {} },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (event: string, cb: (payload: unknown) => void) => {
      (listeners[event] ??= []).push(cb);
      return {
        remove: () => {
          mockRemove();
          const arr = listeners[event] ?? [];
          const idx = arr.indexOf(cb);
          if (idx >= 0) arr.splice(idx, 1);
        },
      };
    },
  })),
}));

import { addInterruptionListener } from '../interruption';
import type { DeepgramInterruptionEvent } from '../interruption';

const emit = (payload: unknown) => {
  for (const cb of [...(listeners.DeepgramInterruption ?? [])]) cb(payload);
};

describe('interruption', () => {
  beforeEach(() => {
    mockRemove.mockClear();
    delete listeners.DeepgramInterruption;
  });

  it('delivers began/ended/stopped events to the listener', () => {
    const received: DeepgramInterruptionEvent[] = [];
    const sub = addInterruptionListener((e) => received.push(e));

    emit({ type: 'began', reason: 'focusLoss' });
    emit({ type: 'ended', shouldResume: true });
    emit({ type: 'stopped', reason: 'focusLossPermanent' });

    expect(received).toEqual([
      { type: 'began', reason: 'focusLoss' },
      { type: 'ended', shouldResume: true },
      { type: 'stopped', reason: 'focusLossPermanent' },
    ]);
    sub.remove();
  });

  it('ignores malformed payloads', () => {
    const listener = jest.fn();
    const sub = addInterruptionListener(listener);

    emit(undefined);
    emit({});
    emit({ reason: 'focusLoss' });

    expect(listener).not.toHaveBeenCalled();
    sub.remove();
  });

  it('stops delivering after remove()', () => {
    const listener = jest.fn();
    const sub = addInterruptionListener(listener);
    sub.remove();

    emit({ type: 'began', reason: 'unknown' });

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
