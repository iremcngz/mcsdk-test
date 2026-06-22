const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const PACKAGE_REDIRECTS = {
  'react-native-vision-camera': 'lib/index',
  'react-native-nitro-modules': 'lib/commonjs/index',
  'react-native-nitro-image': 'lib/commonjs/index',
};

const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      const suffix = PACKAGE_REDIRECTS[moduleName];
      if (suffix) {
        return context.resolveRequest(context, moduleName + '/' + suffix, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
