/**
 * __tests__/talk.test.tsx — UI tests for the TalkScreen feature.
 */

import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';

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
      talkMenuStartAlert: 'Start Alert',
      talkMenuStartImminentPeril: 'Start Imminent Peril',
      talkMenuStartEmergency: 'Start Emergency',
      talkMenuGroupDetails: 'Group Details',
      talkMenuMuteOff: 'Mute Off',
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
      talkMessagesTitle: 'Messages',
      talkMessagesEmpty: 'No messages yet.',
      talkMessagesInputPlaceholder: 'Type a message…',
      talkMessagesSend: 'Send',
      talkMessagesFile: 'Attach File',
      talkMessagesImage: 'Attach Image',
      talkMessagesCamera: 'Camera',
      talkModeReceive: 'Receive',
      talkModeTransmit: 'Transmit',
      talkModeMessages: 'Messages',
      talkBtnStartCall: 'Start Call',
      talkBtnEndCall: 'End Call',
      talkMockPanelTitle: 'Mock Controls',
      talkMockAccept: 'Grant push',
      talkMockOccupy: 'Other talking',
      talkMockReset: 'Reset',
    },
  }),
}));

import { TalkScreen } from '../src/features/talk/TalkScreen';

function getStyle(el: any) {
  return Array.isArray(el.props.style) ? el.props.style : [el.props.style];
}

function hasBackground(el: any, color: string) {
  return getStyle(el).some(s => s.backgroundColor === color);
}

describe('TalkScreen — visual state and actions', () => {
  it('renders the group selector and default selected group', () => {
    render(<TalkScreen />);
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group1');
  });

  it('switches selected group when a group pill is pressed', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-group4'));
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group4');
  });

  it('shows idle push-button before any action', () => {
    render(<TalkScreen />);
    const button = screen.getByTestId('talk-push-button');
    expect(hasBackground(button, mockPalette.surface)).toBe(true);
  });

  it('does not start talk when no call is active', () => {
    render(<TalkScreen />);
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Idle');
  });

  it('accepts push once call is active and shows granted status after loading', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));

    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
  });

  it('turns the push-to-talk button dark when a call is active', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Call active');
    const button = screen.getByTestId('talk-push-button');
    expect(hasBackground(button, '#0f172a')).toBe(true);
  });

  it('shows the push-to-talk button as dark after SDK accepts push during a call', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
    const button = screen.getByTestId('talk-push-button');
    expect(hasBackground(button, '#0f172a')).toBe(true);
  });

  it('starts talking while holding push-to-talk after acceptance', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');

    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Talking');

    fireEvent(screen.getByTestId('talk-push-button'), 'pressOut');
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
  });

  it('updates mode selection when transmit is pressed', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-mode-transmit'));
    const button = screen.getByTestId('talk-mode-transmit');
    expect(hasBackground(button, mockPalette.accent)).toBe(true);
  });

  it('shows group avatar blue when call active and idle', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    const avatar = screen.getByTestId('talk-group-group1');
    expect(hasBackground(avatar, mockPalette.primary)).toBe(true);
  });

  it('shows group avatar red when occupied', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-occupy'));
    const avatar = screen.getByTestId('talk-group-group1');
    expect(hasBackground(avatar, mockPalette.error)).toBe(true);
  });

  it('shows group avatar green while talking', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');
    act(() => { jest.advanceTimersByTime(500); });
    const avatar = screen.getByTestId('talk-group-group1');
    expect(hasBackground(avatar, mockPalette.success)).toBe(true);
  });

  it('handles multi-group calls independently', () => {
    render(<TalkScreen />);

    // Start call on group1
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    const g1 = screen.getByTestId('talk-group-group1');
    expect(hasBackground(g1, mockPalette.primary)).toBe(true);

    // Switch to group2 and start call there too
    fireEvent.press(screen.getByTestId('talk-group-group2'));
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    const g2 = screen.getByTestId('talk-group-group2');
    expect(hasBackground(g2, mockPalette.primary)).toBe(true);

    // group1 should still be blue
    expect(hasBackground(g1, mockPalette.primary)).toBe(true);

    // Occupy group2 → group2 red, group1 stays blue
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-occupy'));
    expect(hasBackground(g2, mockPalette.error)).toBe(true);
    expect(hasBackground(g1, mockPalette.primary)).toBe(true);
  });

  it('switching groups restores per-group call state', () => {
    render(<TalkScreen />);

    // Start call on group1, occupy it
    fireEvent.press(screen.getByTestId('talk-start-button'));
    act(() => { jest.advanceTimersByTime(600); });
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-occupy'));
    const g1 = screen.getByTestId('talk-group-group1');
    expect(hasBackground(g1, mockPalette.error)).toBe(true);

    // Switch to group2 (no call) → status should be Idle
    fireEvent.press(screen.getByTestId('talk-group-group2'));
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Idle');

    // Switch back to group1 → should restore occupied/red state
    fireEvent.press(screen.getByTestId('talk-group-group1'));
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Other speaking');
    expect(hasBackground(g1, mockPalette.error)).toBe(true);
  });

  it('shows incoming call badge and auto-accepts after 3s', async () => {
    render(<TalkScreen />);

    // Open mock panel, toggle incoming call for group3
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-incoming-group3'));

    // Badge should appear
    await waitFor(() => {
      expect(screen.getByTestId('talk-incoming-badge-group3')).toBeTruthy();
    });

    // Advance 3s to trigger auto-accept
    act(() => { jest.advanceTimersByTime(3000); });

    await waitFor(() => {
      expect(screen.queryByTestId('talk-incoming-badge-group3')).toBeNull();
      const g3 = screen.getByTestId('talk-group-group3');
      expect(hasBackground(g3, mockPalette.primary)).toBe(true);
    });
  });

  it('moves incoming call group to front of ordered groups', async () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-incoming-group6'));

    await waitFor(() => {
      const labels = screen.getAllByText(/^group\d+$/);
      expect(labels[0]).toHaveTextContent('group6');
    });
  });

  it('toggles group action menu', () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-menu-toggle'));
    expect(screen.getByTestId('talk-group-menu-alert')).toBeTruthy();
    expect(screen.getByTestId('talk-group-menu-mute')).toBeTruthy();

    fireEvent.press(screen.getByTestId('talk-group-menu-mute'));
    expect(screen.queryByTestId('talk-group-menu-alert')).toBeNull();
  });

  it('shows selected group label as active', () => {
    render(<TalkScreen />);
    const labels = screen.getAllByText('group1');
    // First match is the group label below the avatar
    const label = labels[0];
    const style = Array.isArray(label.props.style) ? label.props.style : [label.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ color: mockPalette.textPrimary })]));
  });

  it('shows incoming badge with pointerEvents none', async () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-incoming-group3'));

    await waitFor(() => {
      const badge = screen.getByTestId('talk-incoming-badge-group3');
      expect(badge?.props.pointerEvents).toBe('none');
    });
  });

  it('shows inactive group label with muted color', () => {
    render(<TalkScreen />);
    // group2 is not selected by default
    const label = screen.getByText('group2');
    const style = Array.isArray(label.props.style) ? label.props.style : [label.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ color: mockPalette.textSecondary })]));
  });

  it('incoming badge disappears after auto-accept', async () => {
    render(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-incoming-group5'));

    // Before auto-accept: badge exists
    await waitFor(() => {
      expect(screen.getByTestId('talk-incoming-badge-group5')).toBeTruthy();
    });

    // After 3s auto-accept: badge removed
    act(() => { jest.advanceTimersByTime(3000); });
    await waitFor(() => {
      expect(screen.queryByTestId('talk-incoming-badge-group5')).toBeNull();
    });
  });

  it('messages button opens messages for data groups', () => {
    render(<TalkScreen />);
    // group3 is a data group
    fireEvent.press(screen.getByTestId('talk-group-group3'));
    fireEvent.press(screen.getByTestId('talk-mode-messages'));

    // MessagesScreen should render (the TalkScreen should unmount)
    expect(screen.queryByTestId('talk-push-button')).toBeNull();
  });

  it('messages button disabled for non-data groups', () => {
    render(<TalkScreen />);
    // group1 is not a data group
    const msgBtn = screen.getByTestId('talk-mode-messages');
    const style = Array.isArray(msgBtn.props.style) ? msgBtn.props.style : [msgBtn.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ opacity: 0.35 })]));
  });
});
