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
  },
};
