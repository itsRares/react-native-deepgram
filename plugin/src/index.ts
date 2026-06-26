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
    const bluetoothConnectPermission = 'android.permission.BLUETOOTH_CONNECT';
    const legacyBluetoothPermission = 'android.permission.BLUETOOTH';
    const { manifest } = cfg.modResults;
    const permissions = manifest['uses-permission'] ?? [];

    const ensurePermission = (permission: string) => {
      if (!permissions.some((p) => p.$?.['android:name'] === permission)) {
        permissions.push({ $: { 'android:name': permission } });
      }
    };

    ensurePermission(recordPermission);

    // Bluetooth output routing. BLUETOOTH_CONNECT is a runtime permission on
    // Android 12+ (the app requests it); the legacy BLUETOOTH permission,
    // capped at API 30, covers the SCO path on older devices.
    ensurePermission(bluetoothConnectPermission);
    if (
      !permissions.some(
        (p) => p.$?.['android:name'] === legacyBluetoothPermission
      )
    ) {
      // maxSdkVersion isn't in the typed attribute set, so assert the entry
      // shape; the manifest serializer preserves arbitrary string attributes.
      permissions.push({
        $: {
          'android:name': legacyBluetoothPermission,
          'android:maxSdkVersion': '30',
        },
      } as (typeof permissions)[number]);
    }

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
