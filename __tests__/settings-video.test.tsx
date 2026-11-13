/**
 * __tests__/settings-video.test.tsx — the Video section of Settings: bitrate, frame
 * rate, key frame interval and freeze-on-loss, saved and handed to the native side.
 *
 * What the native side does with them (VideoTuning.kt, the encoder, KeyFrameGate) is
 * tested on the JVM; here only that a choice is kept and sent.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SettingsScreen } from '../src/features/settings/SettingsScreen';
import { VIDEO_TUNING_DEFAULTS, VideoTuningSettings } from '../src/core/settings';

const mockApplyTuning = jest.fn();
jest.mock('../src/core/videoSession', () => ({
  VideoSession: { applyTuning: (...a: unknown[]) => mockApplyTuning(...a) },
}));

jest.mock('../src/core/logger', () => ({
  getLogFilePaths: () => Promise.resolve([]),
  deleteLogFiles: () => Promise.resolve(),
}));

jest.mock('../src/contexts/AppContext', () => {
  const { getTranslation: translation } = require('../src/core/i18n');
  const { getThemePalette: palette } = require('../src/core/theme');
  return {
    useAppContext: () => ({
      c: palette('dark'), tr: translation('en'),
      theme: 'dark', language: 'en',
      maxFileSize: 2 * 1024 * 1024, maxFiles: 0,
      setTheme: jest.fn(), setLanguage: jest.fn(), setMaxFileSize: jest.fn(), setMaxFiles: jest.fn(),
      stayLoggedIn: false, setStayLoggedIn: jest.fn(), logout: jest.fn(),
    }),
  };
});

beforeEach(() => {
  VideoTuningSettings.save(VIDEO_TUNING_DEFAULTS);
  mockApplyTuning.mockClear();
});

async function mount() {
  render(<SettingsScreen />);
  await act(async () => {});
}

describe('VideoTuningSettings', () => {
  it('starts from the defaults chosen for a congested Wi-Fi', () => {
    expect(VIDEO_TUNING_DEFAULTS).toEqual({
      bitrateKbps: 500, frameRate: 24, keyFrameIntervalSeconds: 1, freezeOnLoss: true,
    });
  });

  it('keeps what was saved', () => {
    const v = { bitrateKbps: 300, frameRate: 15, keyFrameIntervalSeconds: 4, freezeOnLoss: false };
    VideoTuningSettings.save(v);
    expect(VideoTuningSettings.load()).toEqual(v);
  });
});

describe('Settings → Video', () => {
  it.each([
    ['settings-video-bitrate-300',  { bitrateKbps: 300 }],
    ['settings-video-fps-15',       { frameRate: 15 }],
    ['settings-video-keyframe-4',   { keyFrameIntervalSeconds: 4 }],
  ])('%s is saved and sent to the native side', async (testID, patch) => {
    await mount();
    fireEvent.press(screen.getByTestId(testID));
    const expected = { ...VIDEO_TUNING_DEFAULTS, ...patch };
    expect(VideoTuningSettings.load()).toEqual(expected);
    expect(mockApplyTuning).toHaveBeenLastCalledWith(expected);
  });

  it('turns freeze-on-loss off', async () => {
    await mount();
    fireEvent(screen.getByTestId('settings-video-freeze'), 'valueChange', false);
    expect(VideoTuningSettings.load().freezeOnLoss).toBe(false);
    expect(mockApplyTuning).toHaveBeenLastCalledWith({ ...VIDEO_TUNING_DEFAULTS, freezeOnLoss: false });
  });

  it('shows the saved choice when it opens', async () => {
    VideoTuningSettings.save({ ...VIDEO_TUNING_DEFAULTS, bitrateKbps: 1200 });
    await mount();
    // The active segment is the only one styled with the accent background.
    const active = screen.getByTestId('settings-video-bitrate-1200');
    const other = screen.getByTestId('settings-video-bitrate-500');
    expect(JSON.stringify(active.props.style)).not.toEqual(JSON.stringify(other.props.style));
  });
});
