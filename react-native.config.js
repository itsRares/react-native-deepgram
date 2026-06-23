module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        packageImportPath: 'import com.deepgram.DeepgramPackage;',
        packageInstance: 'new DeepgramPackage()',
      },
      ios: {
        podspecPath: require('path').resolve(__dirname, 'Deepgram.podspec'),
      },
    },
  },
};
