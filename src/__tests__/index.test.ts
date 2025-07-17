import { configure } from '../index';

describe('react-native-deepgram', () => {
  it('should export configure function', () => {
    expect(typeof configure).toBe('function');
  });

  it('should configure with API key', () => {
    expect(() => {
      configure({ apiKey: 'test-key' });
    }).not.toThrow();
  });
});
