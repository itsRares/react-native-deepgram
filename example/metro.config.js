const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '..');

module.exports = (() => {
  const config = getDefaultConfig(projectRoot);

  // Let Metro watch files outside the app (monorepo)
  config.watchFolders = [workspaceRoot];

  // Force Metro to resolve some singletons from the app (avoid duplicate React)
  const forceFromApp = (name) => path.join(projectRoot, 'node_modules', name);
  const singletons = ['react', 'react-native'];

  config.resolver = {
    ...config.resolver,
    unstable_enableSymlinks: true,
    nodeModulesPaths: [
      path.join(projectRoot, 'node_modules'),
      path.join(workspaceRoot, 'node_modules'),
    ],
    extraNodeModules: {
      ...(config.resolver?.extraNodeModules || {}),
      'react-native-deepgram': path.join(workspaceRoot, 'lib', 'module'),
      ...Object.fromEntries(singletons.map((m) => [m, forceFromApp(m)])),
    },
    // Explicitly block resolution from workspace root
    blockList: [
      new RegExp(`${workspaceRoot}/node_modules/react/.*`),
      new RegExp(`${workspaceRoot}/node_modules/react-native/.*`),
    ],
  };

  return config;
})();
