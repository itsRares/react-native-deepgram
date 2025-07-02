const { withMainApplication } = require('@expo/config-plugins');

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

module.exports = function withDeepgramPackage(config) {
  return withMainApplication(config, (cfg) => {
    if (
      cfg.modResults.language === 'java' ||
      cfg.modResults.language === 'kt'
    ) {
      cfg.modResults.contents = addPackage(cfg.modResults.contents);
    }
    return cfg;
  });
};
