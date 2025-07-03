import {
  withPlugins,
  withMainApplication,
  withAndroidManifest,
  withInfoPlist,
} from '@expo/config-plugins';
import type { ConfigPlugin } from '@expo/config-plugins';

type DeepgramPluginOptions = {
  microphonePermission?: string;
};

const addAndroidPackage = (src: string) => {
  const pkgImport = 'import com.deepgram.DeepgramPackage;';
  const pkgInstance = 'packages.add(new DeepgramPackage());';

  if (!src.includes(pkgImport)) {
    src = src.replace(/^(package[\s\S]*?;)/, `$1\n${pkgImport}`);
  }

  if (!src.includes(pkgInstance)) {
    src = src.replace(
      /(new PackageList\(this\).getPackages\(\);)/,
      `$1\n        ${pkgInstance}`
    );
  }

  return src;
};

const withAndroidDeepgram: ConfigPlugin<DeepgramPluginOptions | void> = (
  config,
  _options = {}
) => {
  config = withMainApplication(config, (cfg) => {
    if (
      cfg.modResults.language === 'java' ||
      cfg.modResults.language === 'kt'
    ) {
      cfg.modResults.contents = addAndroidPackage(cfg.modResults.contents);
    }
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const recordPermission = 'android.permission.RECORD_AUDIO';
    const { manifest } = cfg.modResults;
    const permissions = manifest['uses-permission'] ?? [];

    if (!permissions.some((p) => p.$?.['android:name'] === recordPermission)) {
      permissions.push({ $: { 'android:name': recordPermission } });
      manifest['uses-permission'] = permissions;
    }

    return cfg;
  });

  return config;
};

const withIosDeepgram: ConfigPlugin<DeepgramPluginOptions> = (
  config,
  options: DeepgramPluginOptions = {}
) => {
  const message =
    options.microphonePermission ??
    'Allow $(PRODUCT_NAME) to access the microphone';

  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSMicrophoneUsageDescription =
      cfg.modResults.NSMicrophoneUsageDescription || message;
    return cfg;
  });
};

const withDeepgram: ConfigPlugin<DeepgramPluginOptions | void> = (
  config,
  options = {}
) =>
  withPlugins(config, [
    [withAndroidDeepgram, options],
    [withIosDeepgram, options],
  ]);

export default withDeepgram;
