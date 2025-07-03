module.exports = {
  name: 'DeepgramExample',
  android: {
    package: 'com.itsrares.deepgramexample',
  },
  ios: {
    bundleIdentifier: 'com.itsrares.deepgramexample',
  },
  plugins: [
    [
      'react-native-deepgram',
      {
        microphonePermission:
          'This app needs microphone access for speech recognition',
      },
    ],
  ],
};
