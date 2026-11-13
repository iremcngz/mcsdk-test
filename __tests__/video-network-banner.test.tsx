/**
 * __tests__/video-network-banner.test.tsx — the bad-connection warning on the screens
 * that show an SDK call's video: a private video call and a group's received video.
 *
 * The verdict itself (GOOD / WEAK / LOST) is VideoNetworkMonitor's, tested on the JVM;
 * here only that the screens say it.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ReceiveScreen } from '../src/features/talk/ReceiveScreen';
import { VideoCallScreen } from '../src/features/calls/VideoCallScreen';
import { getTranslation } from '../src/core/i18n';

const en = getTranslation('en');

const mockGetStats = jest.fn();
jest.mock('../src/core/videoSession', () => ({
  VideoSession: { getStats: (...a: unknown[]) => mockGetStats(...a) },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/features/video/RemoteVideoView', () => {
  const { View } = require('react-native');
  return { RemoteVideoView: (props: object) => <View testID="remote-video" {...props} /> };
});
jest.mock('../src/features/video/LocalVideoView', () => {
  const { View } = require('react-native');
  return { LocalVideoView: (props: object) => <View testID="local-video" {...props} /> };
});

jest.mock('../src/contexts/AppContext', () => {
  const { getTranslation: translation } = require('../src/core/i18n');
  const { getThemePalette: palette } = require('../src/core/theme');
  return { useAppContext: () => ({ c: palette('dark'), tr: translation('en') }) };
});

jest.mock('../src/contexts/CallContext', () => ({
  useCallContext: () => ({
    activeCall: { isVideo: true, state: 'active', startedAt: Date.now(), contactName: 'mcuser-111' },
    endCall: jest.fn(),
    videoCameraOn: true,
    toggleVideoCamera: jest.fn(),
    videoCameraReady: false,
    videoProblem: null,
  }),
}));

function stats(networkQuality: 'GOOD' | 'WEAK' | 'LOST') {
  return {
    send: { running: true },
    receive: { running: true, width: 480, height: 640, networkQuality },
  };
}

const screens: [string, () => React.ReactElement][] = [
  ['private video call', () => <VideoCallScreen />],
  ['group receive', () => <ReceiveScreen group="Alpha" ended={false} onStop={jest.fn()} />],
];

describe.each(screens)('%s', (_name, element) => {
  async function mount(quality: 'GOOD' | 'WEAK' | 'LOST') {
    mockGetStats.mockResolvedValue(stats(quality));
    render(element());
    await act(async () => {});
  }

  it('says nothing while the connection is good', async () => {
    await mount('GOOD');
    expect(screen.queryByTestId('video-network-banner')).toBeNull();
  });

  it('warns that the picture may break up when frames are being lost', async () => {
    await mount('WEAK');
    expect(screen.getByText(en.videoNetworkWeak)).toBeTruthy();
  });

  it('says so when the picture stops coming', async () => {
    await mount('LOST');
    expect(screen.getByText(en.videoNetworkLost)).toBeTruthy();
  });
});

it('does not warn once a group transmission has ended', async () => {
  mockGetStats.mockResolvedValue(stats('LOST'));
  render(<ReceiveScreen group="Alpha" ended onStop={jest.fn()} />);
  await act(async () => {});
  expect(screen.queryByTestId('video-network-banner')).toBeNull();
  expect(screen.getByText(en.talkVideoEnded)).toBeTruthy();
});
