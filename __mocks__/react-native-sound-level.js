// react-native-sound-level: native module — replaced with a no-op mock.
module.exports = {
  start: jest.fn(),
  stop: jest.fn(),
  onNewFrame: null,
};
