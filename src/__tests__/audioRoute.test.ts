import { NativeModules } from 'react-native';

const mockSetAudioRoute = jest.fn((_route: string) => Promise.resolve());
const mockGetAudioRoute = jest.fn(() => Promise.resolve('earpiece'));

jest.mock('../NativeDeepgram', () => {
  const actual = jest.requireActual('../NativeDeepgram');
  return {
    ...actual,
    Deepgram: {
      setAudioRoute: (route: string) => mockSetAudioRoute(route),
      getAudioRoute: () => mockGetAudioRoute(),
    },
  };
});

import {
  setAudioRoute,
  getAudioRoute,
  addAudioRouteChangeListener,
} from '../audioRoute';
import { DeepgramError } from '../types/errors';

describe('audioRoute', () => {
  beforeAll(() => {
    (NativeModules as Record<string, unknown>).Deepgram = {
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
  });

  beforeEach(() => {
    mockSetAudioRoute.mockClear();
    mockGetAudioRoute.mockClear();
  });

  it('forwards the requested route to the native module', async () => {
    await setAudioRoute('speaker');
    expect(mockSetAudioRoute).toHaveBeenCalledWith('speaker');
  });

  it('returns the active route from the native module', async () => {
    await expect(getAudioRoute()).resolves.toBe('earpiece');
  });

  it('wraps native rejections in DeepgramError with the typed code', async () => {
    mockSetAudioRoute.mockRejectedValueOnce(
      Object.assign(new Error('Unknown audio route'), { code: 'invalid_data' })
    );
    const err = await setAudioRoute('speaker').catch((e) => e);
    expect(err).toBeInstanceOf(DeepgramError);
    expect(err.code).toBe('invalid_data');
  });

  it('subscribes and unsubscribes route-change listeners', () => {
    const sub = addAudioRouteChangeListener(() => {});
    expect(typeof sub.remove).toBe('function');
    expect(() => sub.remove()).not.toThrow();
  });
});

describe('audioRoute error wrapping', () => {
  it('produces DeepgramError instances', async () => {
    mockGetAudioRoute.mockRejectedValueOnce(new Error('boom'));
    const err = await getAudioRoute().catch((e) => e);
    expect(err).toBeInstanceOf(DeepgramError);
  });
});
