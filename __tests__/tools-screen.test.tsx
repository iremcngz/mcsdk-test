/**
 * __tests__/tools-screen.test.tsx — the Tools menu.
 *
 * Audio, Video and SDK Logs lost their own tabs when the bottom bar went from
 * nine tabs to seven; they are reached through this menu now. What is guarded
 * here is that each row still navigates to its screen — the screens themselves
 * have their own tests, and TOOL_SCREENS in TabNavigator is what puts a back
 * row above them.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ToolsScreen } from '../src/features/tools/ToolsScreen';
import { getTranslation } from '../src/core/i18n';

const en = getTranslation('en');
const mockSetScreen = jest.fn();
// The SDK's log lines live in the native ring; the menu asks the SDK instance
// how many there are.
let mockSdkLogCount = 0;
const mockSdk = { getSdkLogCount: jest.fn(() => Promise.resolve(mockSdkLogCount)) };
// One object, as the real context's useRef is: a fresh `{ current }` per render
// would re-run the count effect on every render.
const mockSdkRef = { current: mockSdk };
let mockLogs: { id: number }[] = [];

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView:     ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: mockSdkRef, created: true }),
}));

// The console buffers are LogContext's, not SdkContext's.
jest.mock('../src/contexts/LogContext', () => ({
  useLogContext: () => ({ logs: mockLogs }),
}));

jest.mock('../src/contexts/NavigationContext', () => ({
  useNavigation: () => ({ setScreen: mockSetScreen }),
}));

jest.mock('../src/contexts/AppContext', () => {
  const { getTranslation: translation } = require('../src/core/i18n');
  const { getThemePalette: palette } = require('../src/core/theme');
  return { useAppContext: () => ({ c: palette('dark'), tr: translation('en') }) };
});

beforeEach(() => {
  mockSetScreen.mockClear();
  mockSdk.getSdkLogCount.mockClear();
  mockSdkLogCount = 0;
  mockLogs = [];
});

describe('ToolsScreen', () => {
  it('lists the five diagnostics screens', () => {
    render(<ToolsScreen />);
    expect(screen.getByText(en.tabAudio)).toBeTruthy();
    expect(screen.getByText(en.tabVideo)).toBeTruthy();
    expect(screen.getByText(en.tabLogs)).toBeTruthy();
    expect(screen.getByText(en.tabSdkLogs)).toBeTruthy();
    expect(screen.getByText(en.tabMockCalls)).toBeTruthy();
  });

  it.each([
    ['tool-audio',     'audio'],
    ['tool-video',     'video'],
    ['tool-logs',      'logs'],
    ['tool-sdklogs',   'sdklogs'],
    ['tool-mockcalls', 'mockcalls'],
  ])('%s navigates to the %s screen', (testID, target) => {
    render(<ToolsScreen />);
    fireEvent.press(screen.getByTestId(testID));
    expect(mockSetScreen).toHaveBeenCalledWith(target);
  });

  it('shows the SDK log count on its row once there are entries', async () => {
    mockSdkLogCount = 3;
    render(<ToolsScreen />);
    expect(await screen.findByText('3')).toBeTruthy();
    // Asked once, on open: the count is a glance, not a live feed.
    expect(mockSdk.getSdkLogCount).toHaveBeenCalledTimes(1);
  });

  it('shows the app log count on the Log Console row', () => {
    mockLogs = [{ id: 1 }, { id: 2 }];
    render(<ToolsScreen />);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows no count badge while both logs are empty', async () => {
    render(<ToolsScreen />);
    await waitFor(() => expect(mockSdk.getSdkLogCount).toHaveBeenCalled());
    expect(screen.queryByText('0')).toBeNull();
  });
});
