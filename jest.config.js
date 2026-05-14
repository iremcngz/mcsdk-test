module.exports = {
  preset: '@react-native/jest-preset',
  // transformIgnorePatterns: whitelist packages that ship ES-module source
  // so babel-jest can transform them for the Node.js test environment.
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native' +
      '|@react-native(-community)?' +
      '|@testing-library/react-native' +
    ')/)',
  ],
  moduleNameMapper: {
    // react-native-mmkv: native module — replaced with an in-memory mock
    'react-native-mmkv': '<rootDir>/__mocks__/react-native-mmkv.js',
    // react-native-file-logger: native module — replaced with a no-op mock
    'react-native-file-logger': '<rootDir>/__mocks__/react-native-file-logger.js',
    // @op-engineering/op-sqlite: native module — replaced with an in-memory SQL mock
    '@op-engineering/op-sqlite': '<rootDir>/__mocks__/@op-engineering/op-sqlite.js',
    // react-native-get-random-values: polyfill — no-op in Node.js (already has crypto)
    'react-native-get-random-values': '<rootDir>/__mocks__/react-native-get-random-values.js',
    // @react-native-community/netinfo: native module — replaced with a static mock
    '@react-native-community/netinfo': '<rootDir>/__mocks__/@react-native-community/netinfo.js',
  },
};
