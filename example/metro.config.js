const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(__dirname, '..');

// Toggle this (or set DEEPGRAM_USE_BUILT=1) when you want to verify the
// published JS build (`lib/module`) instead of TypeScript sources. The default
// points Metro at `src/` so any change in the library's TypeScript files is
// hot-reloaded into the example app — no `yarn build` step required.
const useBuiltLib = process.env.DEEPGRAM_USE_BUILT === '1';
const libraryEntry = useBuiltLib
  ? path.join(workspaceRoot, 'lib', 'module', 'index.js')
  : path.join(workspaceRoot, 'src', 'index.ts');

module.exports = (() => {
  const config = getDefaultConfig(projectRoot);

  // Let Metro watch files outside the app (monorepo). Also watch the
  // library's `src` so file edits trigger Fast Refresh.
  config.watchFolders = [workspaceRoot];

  // Force Metro to resolve some singletons from the app (avoid duplicate React)
  const forceFromApp = (name) => path.join(projectRoot, 'node_modules', name);
  const singletons = ['react', 'react-native'];

  // Override the resolver so `react-native-deepgram` always points at our
  // chosen entry, regardless of any node_modules symlinks created for the
  // Expo config-plugin resolver. Without this override, Metro would follow
  // the symlink at `example/node_modules/react-native-deepgram` to the repo
  // root and read its `package.json` `main` (`lib/commonjs/index.js`), which
  // is then blocked by `blockList` below — causing a resolution failure.
  const upstreamResolveRequest = config.resolver?.resolveRequest;
  const resolveRequest = (context, moduleName, platform) => {
    if (
      moduleName === 'react-native-deepgram' ||
      moduleName.startsWith('react-native-deepgram/')
    ) {
      // For deep imports like `react-native-deepgram/app.plugin.js`, fall
      // back to the workspace root so subpath access still works.
      if (moduleName !== 'react-native-deepgram') {
        const sub = moduleName.slice('react-native-deepgram/'.length);
        return {
          type: 'sourceFile',
          filePath: path.join(workspaceRoot, sub),
        };
      }
      return { type: 'sourceFile', filePath: libraryEntry };
    }
    if (upstreamResolveRequest) {
      return upstreamResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };

  config.resolver = {
    ...config.resolver,
    unstable_enableSymlinks: true,
    nodeModulesPaths: [
      path.join(projectRoot, 'node_modules'),
      path.join(workspaceRoot, 'node_modules'),
    ],
    extraNodeModules: {
      ...(config.resolver?.extraNodeModules || {}),
      ...Object.fromEntries(singletons.map((m) => [m, forceFromApp(m)])),
    },
    resolveRequest,
    // Explicitly block resolution from workspace root
    blockList: [
      new RegExp(`${workspaceRoot}/node_modules/react/.*`),
      new RegExp(`${workspaceRoot}/node_modules/react-native/.*`),
      // When dev-loading from src, ignore the prebuilt lib so Metro doesn't
      // try to crawl it (and so stale builds can't shadow live edits).
      ...(useBuiltLib ? [] : [new RegExp(`${workspaceRoot}/lib/.*`)]),
    ],
  };

  return config;
})();
