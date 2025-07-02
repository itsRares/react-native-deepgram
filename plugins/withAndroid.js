const { withMainApplication, withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

function addPackage(src) {
  const pkgImport = 'import com.deepgram.DeepgramPackage;';
  const pkgInstance = 'packages.add(new DeepgramPackage());';

  if (!src.includes(pkgImport)) {
    src = src.replace(/^(package[\s\S]*?;)/, `$1\n${pkgImport}`);
  }

  if (!src.includes(pkgInstance)) {
    src = src.replace(
      /(new PackageList\(this\).getPackages\(\);)/,
      `$1\n            ${pkgInstance}`
    );
  }

  return src;
}

const withAndroidDeepgram = (config, options = {}) => {
  config = withMainApplication(config, cfg => {
    if (cfg.modResults.language === 'java' || cfg.modResults.language === 'kt') {
      cfg.modResults.contents = addPackage(cfg.modResults.contents);
    }
    return cfg;
  });

  config = withAndroidManifest(config, cfg => {
    const record = 'android.permission.RECORD_AUDIO';
    const permissions = cfg.modResults.manifest['uses-permission'] || [];
    if (!permissions.some(p => p.$ && p.$['android:name'] === record)) {
      permissions.push({ $: { 'android:name': record } });
      cfg.modResults.manifest['uses-permission'] = permissions;
    }
    return cfg;
  });

  return config;
};

module.exports = withAndroidDeepgram;
