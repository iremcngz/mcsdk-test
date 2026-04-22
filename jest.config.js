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
};
