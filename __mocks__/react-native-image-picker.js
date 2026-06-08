module.exports = {
  launchCamera: jest.fn((_options, callback) => callback({ didCancel: true })),
  launchImageLibrary: jest.fn((_options, callback) => callback({ didCancel: true })),
};
