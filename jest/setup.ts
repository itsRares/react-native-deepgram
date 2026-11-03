jest.mock('../src/NativeDeepgram', () => ({
  __esModule: true,
  default: require('./mockNativeDeepgram').default,
}));
