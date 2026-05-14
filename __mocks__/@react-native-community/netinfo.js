/**
 * __mocks__/@react-native-community/netinfo.js
 *
 * Minimal mock for @react-native-community/netinfo used in Jest.
 * Simulates a Wi-Fi connection with a static IP address.
 * addEventListener is a no-op — tests that need IP-change simulation
 * should mock this module locally with jest.mock().
 */

const mockNetInfo = {
  addEventListener: jest.fn(() => () => {}), // returns unsubscribe fn
  fetch: jest.fn().mockResolvedValue({
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: { ipAddress: '192.168.1.100' },
  }),
  useNetInfo: jest.fn().mockReturnValue({
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: { ipAddress: '192.168.1.100' },
  }),
};

module.exports = { ...mockNetInfo, default: mockNetInfo };
