const { withInfoPlist } = require('@expo/config-plugins');

const withIosDeepgram = (config, options = {}) => {
  const message = options.microphonePermission || 'Allow $(PRODUCT_NAME) to access the microphone';
  return withInfoPlist(config, cfg => {
    cfg.modResults.NSMicrophoneUsageDescription = cfg.modResults.NSMicrophoneUsageDescription || message;
    return cfg;
  });
};

module.exports = withIosDeepgram;
