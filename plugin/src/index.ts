import {
  withPlugins,
  withAndroidManifest,
  withInfoPlist,
} from '@expo/config-plugins';
import type { ConfigPlugin } from '@expo/config-plugins';
type DeepgramPluginOptions = {
  microphonePermission?: string;
  backgroundAudio?: boolean;
};

const withAndroidDeepgram: ConfigPlugin<DeepgramPluginOptions | void> = (
  config,
  options = {}
) => {
  const resolvedOptions = (options ?? {}) as DeepgramPluginOptions;

  return withAndroidManifest(config, (cfg) => {
    const recordPermission = 'android.permission.RECORD_AUDIO';
    const foregroundServicePermission = 'android.permission.FOREGROUND_SERVICE';
    const foregroundMicPermission =
      'android.permission.FOREGROUND_SERVICE_MICROPHONE';
    const foregroundPlaybackPermission =
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK';
    const { manifest } = cfg.modResults;
    const permissions = manifest['uses-permission'] ?? [];

    const ensurePermission = (permission: string) => {
      if (!permissions.some((p) => p.$?.['android:name'] === permission)) {
        permissions.push({ $: { 'android:name': permission } });
      }
    };

    ensurePermission(recordPermission);

    if (resolvedOptions.backgroundAudio !== false) {
      ensurePermission(foregroundServicePermission);
      ensurePermission(foregroundMicPermission);
      ensurePermission(foregroundPlaybackPermission);
    }

    manifest['uses-permission'] = permissions;

    return cfg;
  });
};

const withIosDeepgram: ConfigPlugin<DeepgramPluginOptions> = (
  config,
  options = {}
) => {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSMicrophoneUsageDescription =
      options.microphonePermission ??
      cfg.modResults.NSMicrophoneUsageDescription ??
      'Allow $(PRODUCT_NAME) to access the microphone';

    if (options.backgroundAudio !== false) {
      const modes: string[] = cfg.modResults.UIBackgroundModes ?? [];
      if (!modes.includes('audio')) {
        modes.push('audio');
      }
      cfg.modResults.UIBackgroundModes = modes;
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
