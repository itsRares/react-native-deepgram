import {
  withPlugins,
  withAndroidManifest,
  withInfoPlist,
} from '@expo/config-plugins';
import type { ConfigPlugin } from '@expo/config-plugins';
type DeepgramPluginOptions = {
  microphonePermission?: string;
  backgroundAudio?: boolean;
  /**
   * Customize the Android foreground-service (keep-alive) notification shown
   * while background audio is active. Values are written as
   * `com.deepgram.notification.*` <meta-data> entries in the manifest.
   */
  androidNotification?: {
    /** Notification title. Default: the app's label. */
    title?: string;
    /** Notification body text. */
    text?: string;
    /** Notification channel name (visible in system settings). Default: title. */
    channelName?: string;
    /** Drawable/mipmap resource name for the small icon, e.g. 'ic_stat_audio'. */
    icon?: string;
  };
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

      // The library manifest deliberately ships DeepgramAudioService without
      // android:foregroundServiceType (so apps that don't use background audio
      // never have to justify foreground-service types in the Play Console).
      // Opting in requires merging the type back onto the service.
      const application = manifest.application?.[0];
      if (application) {
        const serviceName = 'com.deepgram.DeepgramAudioService';
        const services = (application.service ?? []) as {
          $: Record<string, string>;
        }[];
        let service = services.find(
          (s) => s.$?.['android:name'] === serviceName
        );
        if (!service) {
          service = { $: { 'android:name': serviceName } };
          services.push(service);
        }
        service.$['android:foregroundServiceType'] = 'microphone|mediaPlayback';
        application.service = services as typeof application.service;
      }
    }

    manifest['uses-permission'] = permissions;

    const notification = resolvedOptions.androidNotification;
    if (notification) {
      const application = manifest.application?.[0];
      if (application) {
        const metaData = application['meta-data'] ?? [];
        const setMetaData = (name: string, value: string | undefined) => {
          if (!value) return;
          const existing = metaData.find((m) => m.$?.['android:name'] === name);
          if (existing) {
            existing.$['android:value'] = value;
          } else {
            metaData.push({
              $: { 'android:name': name, 'android:value': value },
            });
          }
        };

        setMetaData('com.deepgram.notification.TITLE', notification.title);
        setMetaData('com.deepgram.notification.TEXT', notification.text);
        setMetaData(
          'com.deepgram.notification.CHANNEL_NAME',
          notification.channelName
        );
        setMetaData('com.deepgram.notification.ICON', notification.icon);

        application['meta-data'] = metaData;
      }
    }

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
