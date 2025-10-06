import {
  withPlugins,
  withAndroidManifest,
  withInfoPlist,
} from '@expo/config-plugins';
import type { ConfigPlugin } from '@expo/config-plugins';
type DeepgramPluginOptions = {
  microphonePermission?: string;
};

const withAndroidDeepgram: ConfigPlugin<DeepgramPluginOptions | void> = (
  config
) => {
  return withAndroidManifest(config, (cfg) => {
    const recordPermission = 'android.permission.RECORD_AUDIO';
    const { manifest } = cfg.modResults;
    const permissions = manifest['uses-permission'] ?? [];

    if (!permissions.some((p) => p.$?.['android:name'] === recordPermission)) {
      permissions.push({ $: { 'android:name': recordPermission } });
      manifest['uses-permission'] = permissions;
    }

    return cfg;
  });
};

const withIosDeepgram: ConfigPlugin<DeepgramPluginOptions> = (
  config,
  options = {}
) => {
  const message =
    options.microphonePermission ??
    'Allow $(PRODUCT_NAME) to access the microphone';
  const fallbackPermissionMessage =
    'Allow $(PRODUCT_NAME) to access your microphone.';

  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSMicrophoneUsageDescription =
      cfg.modResults.NSMicrophoneUsageDescription || message;
    if (options.microphonePermission) {
      cfg.modResults.NSMicrophoneUsageDescription =
        options.microphonePermission;
    } else if (!cfg.modResults.NSMicrophoneUsageDescription) {
      cfg.modResults.NSMicrophoneUsageDescription = fallbackPermissionMessage;
    }

    return cfg;
  });
};

const withDeepgram: ConfigPlugin<DeepgramPluginOptions | void> = (
  config,
  options
) =>
  withPlugins(config, [
    [withAndroidDeepgram, options],
    [withIosDeepgram, options],
  ]);

export default withDeepgram;
