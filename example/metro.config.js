const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const root = path.resolve(__dirname, '..');

// `yarn start:built` (DEEPGRAM_USE_BUILT=1) bundles the compiled `lib/module`
// output instead of the TypeScript sources.
const useBuiltLib = process.env.DEEPGRAM_USE_BUILT === '1';

module.exports = withMetroConfig(getDefaultConfig(__dirname), {
  root,
  dirname: __dirname,
  conditions: useBuiltLib ? [] : ['react-native-deepgram-source'],
});
