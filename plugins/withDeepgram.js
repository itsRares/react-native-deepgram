const { withPlugins } = require('@expo/config-plugins');
const withAndroidDeepgram = require('./withAndroid');
const withIosDeepgram = require('./withIos');

const withDeepgram = (config, options) => {
  return withPlugins(config, [
    [withAndroidDeepgram, options],
    [withIosDeepgram, options],
  ]);
};

module.exports = withDeepgram;
