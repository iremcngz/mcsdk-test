/**
 * __tests__/talk.test.tsx — UI tests for the TalkScreen feature.
 */

import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react-native';

jest.useFakeTimers();

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView:     ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-sound-level', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  onNewFrame: undefined,
}), { virtual: true });

const mockPalette = {
  bg:              '#0b1220',
  surface:         '#111b2f',
  accent:          '#5ec6ff',
  inputBg:         '#0d1f36',
  border:          '#1b2b45',
  logBg:           '#09111f',
  textPrimary:     '#eef2ff',
  textSecondary:   '#a8b8d4',
  textMuted:       '#758399',
  textOnAccent:    '#0b1220',
  primary:         '#3b82f6',
  secondary:       '#8b5cf6',
  success:         '#22c55e',
  warn:            '#f59e0b',
  error:           '#f43f5e',
  presenceOffline: '#7c8a9e',
  sdkLog:          '#7dd3fc',
  valueText:       '#facc15',
  tableRowBg:      '#0f1b38',
  tableRowAltBg:   '#121f43',
  tableHeadBg:     '#14273f',
  errorBoxBg:      '#221a1f',
};

jest.mock('../src/contexts/AppContext', () => ({
  useAppContext: () => ({
    c: mockPalette,
    tr: {
      talkGroupsTitle: 'Groups',
      talkSelectedGroup: 'Selected group',
      talkButton: 'Push to talk',
      talkButtonHold: 'Hold to talk',
      talkSpeakerYou: 'You',
      talkHoldHint: 'Press and hold while speaking',
      talkNoCallHint: 'Start call to enable push-to-talk',
      talkOccupiedBy: (speaker: string) => `${speaker} is speaking`,
      talkStatusIdle: 'Idle',
      talkStatusAccepted: 'Push granted',
      talkStatusOccupied: 'Other speaking',
      talkStatusActive: 'Call active',
      talkStatusTalking: 'Talking',
      talkModeReceive: 'Receive',
      talkModeTransmit: 'Transmit',
      talkModeMessages: 'Messages',
      talkBtnStartCall: 'Start Call',
      talkBtnEndCall: 'End Call',
      talkMockPanelTitle: 'Mock Controls',
      talkMockAccept: 'Grant push',
      talkMockOccupy: 'Other talking',
      talkMockReset: 'Reset',
      talkMicEnable: 'Enable microphone',
      talkMicEnabled: 'Microphone enabled',
      talkMicDenied: 'Microphone permission denied',
      talkMicDisabledHint: 'Enable microphone to send audio',
    },
  }),
}));

import { TalkScreen } from '../src/features/talk/TalkScreen';

describe('TalkScreen — visual state and actions', () => {
  it('renders the group selector and default selected group', () => {
    render(<TalkScreen />);

    expect(screen.getByText('Groups')).toBeTruthy();
    expect(screen.getByText('group1')).toBeTruthy();
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('Selected group: group1');
  });

  it('switches selected group when a group pill is pressed', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-group4'));
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('Selected group: group4');
  });

  it('shows grey idle push-button before any action', () => {
    render(<TalkScreen />);
    const button = screen.getByTestId('talk-push-button');
    const style = Array.isArray(button.props.style) ? button.props.style : [button.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: mockPalette.border })]));
  });

  it('does not start talk when no call is active', () => {
    render(<TalkScreen />);
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Idle');
    expect(screen.getByText('Push to talk')).toBeTruthy();
  });

  it('accepts push once call is active and shows granted status after loading', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    fireEvent.press(screen.getByTestId('talk-mic-button'));
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));

    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
    expect(screen.getByText('Press and hold while speaking')).toBeTruthy();
  });

  it('turns the push-to-talk button blue when a call is active', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Call active');
    const button = screen.getByTestId('talk-push-button');
    const style = Array.isArray(button.props.style) ? button.props.style : [button.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: mockPalette.primary })]));
  });

  it('shows the push-to-talk button as accepted and green when SDK accepts push during a call', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    // After SDK accepts, status text shows Push granted
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
    // Button is mavi (active) since user released
    const button = screen.getByTestId('talk-push-button');
    const style = Array.isArray(button.props.style) ? button.props.style : [button.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: mockPalette.primary })]));
  });

  it('starts talking while holding push-to-talk after acceptance', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => {
      jest.advanceTimersByTime(600);
    });
    fireEvent.press(screen.getByTestId('talk-mic-button'));
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');

    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Talking');
    expect(screen.getByText('Hold to talk')).toBeTruthy();

    fireEvent(screen.getByTestId('talk-push-button'), 'pressOut');
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
  });

  it('updates mode selection when transmit is pressed', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-mode-transmit'));
    const button = screen.getByTestId('talk-mode-transmit');
    const style = Array.isArray(button.props.style) ? button.props.style : [button.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: mockPalette.accent })]));
  });
});
