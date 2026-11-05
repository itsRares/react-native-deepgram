import { DeviceEventEmitter } from 'react-native';
import NativeDeepgram from '../NativeDeepgram';
import {
  setAudioRoute,
  getAudioRoute,
  addAudioRouteChangeListener,
} from '../audioRoute';
import { DeepgramError } from '../types/errors';

const mockSetAudioRoute = jest.mocked(NativeDeepgram!.setAudioRoute);
const mockGetAudioRoute = jest.mocked(NativeDeepgram!.getAudioRoute);

describe('audioRoute', () => {
  beforeEach(() => {
    mockSetAudioRoute.mockClear();
    mockGetAudioRoute.mockClear();
  });

  it('forwards the requested route to the native module', async () => {
    await setAudioRoute('speaker');
    expect(mockSetAudioRoute).toHaveBeenCalledWith('speaker');
  });

  it('returns the active route from the native module', async () => {
    mockGetAudioRoute.mockResolvedValueOnce('earpiece');
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

  it('delivers route changes until the subscription is removed', () => {
    const listener = jest.fn();
    const sub = addAudioRouteChangeListener(listener);

    DeviceEventEmitter.emit('onAudioRouteChange', { route: 'bluetooth' });
    sub.remove();
    DeviceEventEmitter.emit('onAudioRouteChange', { route: 'speaker' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('bluetooth');
  });
});

describe('audioRoute error wrapping', () => {
  it('produces DeepgramError instances', async () => {
    mockGetAudioRoute.mockRejectedValueOnce(new Error('boom'));
    const err = await getAudioRoute().catch((e) => e);
    expect(err).toBeInstanceOf(DeepgramError);
  });
});
