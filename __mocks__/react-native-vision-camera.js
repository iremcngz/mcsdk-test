// react-native-vision-camera: native module — replaced with a no-op mock so
// components that import <Camera> (e.g. BroadcastScreen) can render under Jest.
const React = require('react');

const Camera = React.forwardRef((_props, _ref) => null);

module.exports = {
  Camera,
  useCameraDevice: () => null,
  useCameraDevices: () => [],
  useCameraPermission: () => ({
    hasPermission: true,
    requestPermission: jest.fn(async () => true),
  }),
  useCameraFormat: () => undefined,
};
