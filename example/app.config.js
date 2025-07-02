module.exports = {
  name: 'DeepgramExample',
  plugins: [
    ['react-native-deepgram', {
      microphonePermission: 'Allow $(PRODUCT_NAME) to access the microphone.'
    }],
  ],
};
