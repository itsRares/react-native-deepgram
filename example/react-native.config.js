const path = require('path');
const pkg = require('../package.json');

module.exports = {
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..'),
      platforms: {
        // Codegen fails without explicit (empty) platform entries.
        ios: {},
        android: {},
      },
    },
  },
};
