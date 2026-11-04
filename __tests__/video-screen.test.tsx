/**
 * __tests__/video-screen.test.tsx — the Video tab's control flow.
 *
 * The native side is stubbed: what the camera, encoder and decoder really do is
 * checked between two phones.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { VideoScreen } from '../src/features/video/VideoScreen';
import { getTranslation } from '../src/core/i18n';
import { getThemePalette } from '../src/core/theme';

const en = getTranslation('en');

const mockStartSend = jest.fn();
const mockStopSend = jest.fn();
const mockStartReceive = jest.fn();
const mockStopReceive = jest.fn();
const mockGetStats = jest.fn();
const mockPermission = jest.fn();

jest.mock('../src/core/videoSession', () => ({
  VideoSession: {
    isSupported: true,
    startSend: (...a: unknown[]) => mockStartSend(...a),
    stopSend: (...a: unknown[]) => mockStopSend(...a),
    startReceive: (...a: unknown[]) => mockStartReceive(...a),
    stopReceive: (...a: unknown[]) => mockStopReceive(...a),
    getStats: (...a: unknown[]) => mockGetStats(...a),
  },
}));

jest.mock('../src/core/permissions', () => ({
  ensureCameraPermission: (...a: unknown[]) => mockPermission(...a),
}));

jest.mock('../src/features/video/RemoteVideoView', () => {
  const { View } = require('react-native');
  return { RemoteVideoView: (props: object) => <View testID="remote-video" {...props} /> };
});

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ ipInfo: { ip: '10.0.0.9', type: 'wifi' } }),
}));

jest.mock('../src/contexts/AppContext', () => {
  const { getTranslation: translation } = require('../src/core/i18n');
  const { getThemePalette: palette } = require('../src/core/theme');
  return { useAppContext: () => ({ c: palette('dark'), tr: translation('en') }) };
});

const idleSend = {
  running: false,
  width: 0,
  height: 0,
  framesEncoded: 0,
  keyFrames: 0,
  bytes: 0,
  keyFramesWithoutConfig: 0,
  seconds: 0,
  profileLevelId: null,
  packetsSent: 0,
  sendErrors: 0,
  target: null,
  error: null,
};

const idleReceive = {
  running: false,
  width: 0,
  height: 0,
  packetsReceived: 0,
  packetsLost: 0,
  framesReceived: 0,
  framesDiscarded: 0,
  framesDecoded: 0,
  framesLate: 0,
  keyFramesRequested: 0,
  drawSeconds: 0,
  networkQuality: 'GOOD',
  error: null,
};

const idle = { send: idleSend, receive: idleReceive };

const sending = {
  ...idle,
  send: {
    ...idleSend,
    running: true,
    width: 640,
    height: 480,
    framesEncoded: 241,
    keyFrames: 6,
    bytes: 1_000_000,
    seconds: 10,
    profileLevelId: '42c016',
    packetsSent: 900,
    target: '10.0.0.2:5006',
  },
};

const receiving = {
  ...idle,
  receive: {
    ...idleReceive,
    running: true,
    width: 640,
    height: 480,
    packetsReceived: 900,
    framesReceived: 241,
    framesDecoded: 241,
    drawSeconds: 10,
  },
};

async function mount() {
  render(<VideoScreen />);
  await act(async () => {});
}

async function press(label: string) {
  fireEvent.press(screen.getByText(label));
  await act(async () => {});
}

const peerInput = () => screen.getByPlaceholderText('192.168.1.20');

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStats.mockResolvedValue(idle);
  mockPermission.mockResolvedValue('granted');
  mockStartSend.mockResolvedValue(undefined);
  mockStopSend.mockResolvedValue(undefined);
  mockStartReceive.mockResolvedValue(undefined);
  mockStopReceive.mockResolvedValue(undefined);
});

describe('VideoScreen', () => {
  it("shows this phone's address, which the other phone needs", async () => {
    await mount();
    expect(screen.getByText('10.0.0.9')).toBeTruthy();
  });

  it('sends to the typed peer after asking for the camera', async () => {
    await mount();
    fireEvent.changeText(peerInput(), ' 10.0.0.2 ');
    mockGetStats.mockResolvedValue(sending);
    await press(en.videoSend);
    expect(mockPermission).toHaveBeenCalled();
    expect(mockStartSend).toHaveBeenCalledWith('10.0.0.2', 5006);
    expect(screen.getByText(en.videoStopSend)).toBeTruthy();
  });

  it('cannot send without a peer', async () => {
    await mount();
    await press(en.videoSend);
    expect(mockStartSend).not.toHaveBeenCalled();
  });

  it('does not send without the permission and says why', async () => {
    mockPermission.mockResolvedValue('denied');
    await mount();
    fireEvent.changeText(peerInput(), '10.0.0.2');
    await press(en.videoSend);
    expect(mockStartSend).not.toHaveBeenCalled();
    expect(screen.getByText(en.videoPermissionDenied)).toBeTruthy();
  });

  it('points to settings when the permission is blocked', async () => {
    mockPermission.mockResolvedValue('blocked');
    await mount();
    fireEvent.changeText(peerInput(), '10.0.0.2');
    await press(en.videoSend);
    expect(screen.getByText(en.videoPermissionBlocked)).toBeTruthy();
  });

  it('shows why sending failed to start', async () => {
    mockStartSend.mockRejectedValue(new Error('the camera was taken away'));
    await mount();
    fireEvent.changeText(peerInput(), '10.0.0.2');
    await press(en.videoSend);
    expect(screen.getByText('the camera was taken away')).toBeTruthy();
    expect(screen.getByText(en.videoSend)).toBeTruthy();
  });

  it('stops sending', async () => {
    mockGetStats.mockResolvedValue(sending);
    await mount();
    mockGetStats.mockResolvedValue(idle);
    await press(en.videoStopSend);
    expect(mockStopSend).toHaveBeenCalled();
  });

  it('receiving needs no peer and shows the picture', async () => {
    await mount();
    expect(screen.queryByTestId('remote-video')).toBeNull();
    mockGetStats.mockResolvedValue(receiving);
    await press(en.videoReceive);
    expect(mockStartReceive).toHaveBeenCalledWith(5006);
    expect(screen.getByTestId('remote-video')).toBeTruthy();
    expect(mockPermission).not.toHaveBeenCalled();
  });

  it('gives the picture no background, which would paint over it', async () => {
    mockGetStats.mockResolvedValue(receiving);
    await mount();
    const style = StyleSheet.flatten(screen.getByTestId('remote-video').props.style);
    expect(style.backgroundColor).toBeUndefined();
  });

  it('stops receiving and takes the picture away', async () => {
    mockGetStats.mockResolvedValue(receiving);
    await mount();
    mockGetStats.mockResolvedValue(idle);
    await press(en.videoStopReceive);
    expect(mockStopReceive).toHaveBeenCalled();
    expect(screen.queryByTestId('remote-video')).toBeNull();
  });

  it('picks a running stream back up after the tab was left', async () => {
    mockGetStats.mockResolvedValue({ send: sending.send, receive: receiving.receive });
    await mount();
    expect(screen.getByText(en.videoStopSend)).toBeTruthy();
    expect(screen.getByText(en.videoStopReceive)).toBeTruthy();
    expect(mockStartSend).not.toHaveBeenCalled();
  });

  it("derives the sender's frame rate and bitrate from the counters", async () => {
    mockGetStats.mockResolvedValue(sending);
    await mount();
    expect(screen.getByText('24.0')).toBeTruthy();
    expect(screen.getByText('800 kbps')).toBeTruthy();
    expect(screen.getByText('10.0.0.2:5006')).toBeTruthy();
  });

  it('says nothing about a healthy network', async () => {
    mockGetStats.mockResolvedValue(receiving);
    await mount();
    expect(screen.queryByText(en.videoNetworkWeak)).toBeNull();
    expect(screen.queryByText(en.videoNetworkLost)).toBeNull();
  });

  it('warns the viewer about a weak network', async () => {
    mockGetStats.mockResolvedValue({
      ...receiving,
      receive: { ...receiving.receive, networkQuality: 'WEAK' },
    });
    await mount();
    expect(screen.getByText(en.videoNetworkWeak)).toBeTruthy();
  });

  it('says so when the picture stops coming', async () => {
    mockGetStats.mockResolvedValue({
      ...receiving,
      receive: { ...receiving.receive, networkQuality: 'LOST' },
    });
    await mount();
    expect(screen.getByText(en.videoNetworkLost)).toBeTruthy();
  });

  it('does not warn a phone that is only sending', async () => {
    mockGetStats.mockResolvedValue({
      send: sending.send,
      receive: { ...idleReceive, networkQuality: 'WEAK' },
    });
    await mount();
    expect(screen.queryByText(en.videoNetworkWeak)).toBeNull();
  });

  it('warns about lost packets', async () => {
    mockGetStats.mockResolvedValue({
      ...receiving,
      receive: { ...receiving.receive, packetsLost: 37 },
    });
    await mount();
    const color = StyleSheet.flatten(screen.getByText('37').props.style).color;
    expect(color).toBe(getThemePalette('dark').error);
  });

  it.each([
    ['42e01f', false],
    ['42c016', false], // what the A20's encoder really writes at 640x480
    ['42c028', true], // level 4.0, past the SDK's 3.1
    ['428016', true], // baseline but not constrained
    ['640016', true], // high profile
  ])('judges profile %s against the SDK format', async (profileLevelId, warns) => {
    mockGetStats.mockResolvedValue({ ...sending, send: { ...sending.send, profileLevelId } });
    await mount();
    const color = StyleSheet.flatten(screen.getByText(profileLevelId).props.style).color;
    expect(color === getThemePalette('dark').error).toBe(warns);
  });
});
