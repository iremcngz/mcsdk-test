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

jest.mock('../src/core/permissions', () => ({
  ensureMicPermission: jest.fn(async () => 'granted'),
}));

// A group call's audio is TalkContext's (talk-group-audio.test). The level
// meter is refused the mic — the call's pipeline holds it — so it stays off and
// updates nothing after a test's act() has ended.
jest.mock('../src/core/mediaSession', () => ({
  MediaSession: {
    startCallAudio: jest.fn(async () => true),
    stopCallAudio: jest.fn(async () => {}),
    setTransmitEnabled: jest.fn(),
    setPlaybackMuted: jest.fn(),
    setRoute: jest.fn(),
    claimMicForMeter: jest.fn(async () => false),
    releaseMicForMeter: jest.fn(),
  },
}));

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
    theme: 'dark',
    tr: {
      talkGroupsTitle: 'Groups',
      talkSelectedGroup: 'Selected group',
      talkMenuStartAlert: 'Start Alert',
      talkMenuStartImminentPeril: 'Start Imminent Peril',
      talkMenuStartEmergency: 'Start Emergency',
      talkMenuGroupDetails: 'Group Details',
      talkMenuMuteOff: 'Mute Off',
      talkMenuMuteOn: 'Mute On',
      talkGroupMutedHint: 'Group audio muted',
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
      talkAffEdit: 'Edit groups',
      talkAffTitle: 'Group Affiliation',
      talkAffSubtitle: 'Choose groups and which services to affiliate them to',
      talkAffEmpty: 'No provisioned groups.',
      talkAffNotRegistered: 'The group list arrives once registration completes.',
      talkAffNoneAffiliated: 'No affiliated groups — use edit to add some.',
      talkAffSelectAll: 'Select all',
      talkAffClearAll: 'Clear',
      talkAffApply: 'Apply',
      talkAffCancel: 'Cancel',
      talkAffNoChanges: 'No changes',
      talkAffDiffAdd: (n: number) => `+${n} affiliate`,
      talkAffDiffRemove: (n: number) => `−${n} deaffiliate`,
      talkAffDiffChange: (n: number) => `${n} service change${n === 1 ? '' : 's'}`,
      talkAffCount: (a: number, t: number) => `${a}/${t} groups affiliated`,
      talkSvcPtt: 'PTT',
      talkSvcVideo: 'Video',
      talkSvcData: 'Data',
      talkAffServicesHint: 'Services the group supports',
      talkCallStartFailed: 'The group call could not be set up',
      floorDeniedOtherTalker: 'Someone else has the floor',
    },
  }),
}));

// TalkContext subscribes to the SDK via SdkContext, which reaches the TurboModule
// (unavailable under Jest). Stub SdkContext with a fake SDK, then drive the two
// group callbacks by hand so each test can stage the exact group set it needs.
//
// Default: group1..group7 supported and affiliated on all three services — the
// set the pre-existing TalkScreen tests assert on.

interface MockGroup {
  groupId: string;
  name: string;
  isPtt: boolean;
  isVideo: boolean;
  isData: boolean;
}

const groupsListeners = new Set<(e: { groups: MockGroup[] }) => void>();
const affListeners = new Set<(e: { groups: MockGroup[] }) => void>();
const identityListeners = new Set<(e: any) => void>();

const allGroups = (): MockGroup[] =>
  ['group1', 'group2', 'group3', 'group4', 'group5', 'group6', 'group7']
    .map(groupId => ({ groupId, name: groupId, isPtt: true, isVideo: true, isData: true }));

type Handler = (e: any) => void;
const callListeners = {
  incoming:   new Set<Handler>(),
  updated:    new Set<Handler>(),
  terminated: new Set<Handler>(),
  floor:      new Set<Handler>(),
  error:      new Set<Handler>(),
};
const sub = (set: Set<Handler>) => (h: Handler) => {
  set.add(h);
  return { remove: () => set.delete(h) };
};

const mockSdk = {
  affiliate: jest.fn(),
  deaffiliate: jest.fn(),
  onGroupsUpdated: (h: (e: { groups: MockGroup[] }) => void) => {
    groupsListeners.add(h);
    return { remove: () => groupsListeners.delete(h) };
  },
  onAffiliationsUpdated: (h: (e: { groups: MockGroup[] }) => void) => {
    affListeners.add(h);
    return { remove: () => affListeners.delete(h) };
  },
  onIdentityUpdated: (h: (e: any) => void) => {
    identityListeners.add(h);
    return { remove: () => identityListeners.delete(h) };
  },
  // Group calls: the commands are recorded, the events driven by hand below.
  startGroupCall: jest.fn(),
  terminateCall:  jest.fn(),
  requestFloor:   jest.fn(),
  releaseFloor:   jest.fn(),
  onIncomingCall:   sub(callListeners.incoming),
  onCallUpdated:    sub(callListeners.updated),
  onCallTerminated: sub(callListeners.terminated),
  onFloorUpdated:   sub(callListeners.floor),
  onSdkError:       sub(callListeners.error),
};

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
}));

/** Pushes both lists, as the SDK does once registration completes. */
function emitGroups(supported: MockGroup[], affiliated: MockGroup[] = supported) {
  act(() => {
    groupsListeners.forEach(l => l({ groups: supported.map(g => ({ ...g })) }));
    affListeners.forEach(l => l({ groups: affiliated.map(g => ({ ...g })) }));
  });
}

beforeEach(() => {
  mockSdk.affiliate.mockClear();
  mockSdk.deaffiliate.mockClear();
  mockSdk.startGroupCall.mockClear();
  mockSdk.terminateCall.mockClear();
  mockSdk.requestFloor.mockClear();
  mockSdk.releaseFloor.mockClear();
});

const fire = (set: Set<Handler>, e: any) => act(() => { set.forEach(h => h(e)); });

/** The SDK reporting group [group]'s call, as CallInfo. */
function callUpdate(group: string, state: string, over: Partial<any> = {}) {
  fire(callListeners.updated, {
    callId: `call-${group}`, type: 'GROUP', state, outgoing: true,
    isEmergency: false, isImminentPeril: false, callerId: '', calleeId: '',
    groupId: group, ...over,
  });
}

/** The SDK's floor update for group [group]'s call. */
function floorUpdate(group: string, status: string, over: Partial<any> = {}) {
  fire(callListeners.floor, {
    callId: `call-${group}`, ownerId: '', status, queuePosition: 0,
    denyReason: 'UNKNOWN', revokeReason: 'UNKNOWN', talkers: [], ...over,
  });
}

/** Start, as the user presses it, and the SDK bringing the call up. */
function startCall(group = 'group1') {
  fireEvent.press(screen.getByTestId('talk-start-button'));
  callUpdate(group, 'CALLING');
  callUpdate(group, 'ACTIVE');
}

/** A simulated call from the mock panel, which has no SDK behind it. */
function mockStart() {
  fireEvent.press(screen.getByTestId('talk-mock-toggle'));
  fireEvent.press(screen.getByTestId('talk-mock-start'));
  fireEvent.press(screen.getByTestId('talk-mock-close'));
}

import { TalkScreen } from '../src/features/talk/TalkScreen';
import { TalkContextProvider } from '../src/contexts/TalkContext';

/**
 * Renders inside TalkContextProvider and immediately delivers the group lists,
 * mirroring the SDK pushing them once registration completes. Pass explicit
 * lists to stage a different set; pass null to render with no groups at all.
 */
function renderWithTalkCtx(
  ui: React.ReactElement,
  supported: MockGroup[] | null = allGroups(),
  affiliated?: MockGroup[],
) {
  const result = render(<TalkContextProvider>{ui}</TalkContextProvider>);
  if (supported) emitGroups(supported, affiliated ?? supported);
  return result;
}

function getStyle(el: any) {
  return Array.isArray(el.props.style) ? el.props.style : [el.props.style];
}

function hasBackground(el: any, color: string) {
  return getStyle(el).some(s => s.backgroundColor === color);
}

describe('TalkScreen — visual state and actions', () => {
  it('renders the group selector and default selected group', () => {
    renderWithTalkCtx(<TalkScreen />);
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group1');
  });

  it('switches selected group when a group pill is pressed', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-group4'));
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group4');
  });

  it('shows idle push-button before any action', () => {
    renderWithTalkCtx(<TalkScreen />);
    const button = screen.getByTestId('talk-push-button');
    // Idle (no active call) → button uses the muted color.
    expect(hasBackground(button, mockPalette.textMuted)).toBe(true);
  });

  it('does not start talk when no call is active', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');
    // With no active call the status label is empty (nothing to show).
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('');
  });

  it('shows the mock panel\'s grant on a simulated call', () => {
    renderWithTalkCtx(<TalkScreen />);
    mockStart();
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));

    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
  });

  it('turns the push-to-talk button dark when a call is active', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Call active');
    const button = screen.getByTestId('talk-push-button');
    // Active call in dark theme → button uses the dark bg color.
    expect(hasBackground(button, mockPalette.bg)).toBe(true);
  });

  it('keeps the button dark after the mock panel grants push', () => {
    renderWithTalkCtx(<TalkScreen />);
    mockStart();
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
    const button = screen.getByTestId('talk-push-button');
    // Accepted (not yet talking) in dark theme → still the dark bg color.
    expect(hasBackground(button, mockPalette.bg)).toBe(true);
  });

  it('starts talking while holding push-to-talk after acceptance', () => {
    renderWithTalkCtx(<TalkScreen />);
    mockStart();
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-accept'));
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');

    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Talking');

    fireEvent(screen.getByTestId('talk-push-button'), 'pressOut');
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Push granted');
  });

  it('opens the broadcast screen when transmit is pressed', () => {
    renderWithTalkCtx(<TalkScreen />);
    // Start call first
    startCall();

    // Transmit now switches to the full-screen BroadcastScreen, so the
    // TalkScreen (and its push button) unmounts.
    fireEvent.press(screen.getByTestId('talk-mode-transmit'));
    expect(screen.queryByTestId('talk-push-button')).toBeNull();
  });

  it('shows group avatar blue when call active and idle', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    const avatar = screen.getByTestId('talk-group-group1');
    expect(hasBackground(avatar, mockPalette.primary)).toBe(true);
  });

  it('shows group avatar red when occupied', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    floorUpdate('group1', 'TAKEN', { ownerId: 'sip:mcptt.mcuser-222@x' });
    const avatar = screen.getByTestId('talk-group-group1');
    expect(hasBackground(avatar, mockPalette.error)).toBe(true);
  });

  it('shows group avatar green while talking', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent(screen.getByTestId('talk-push-button'), 'pressIn');
    floorUpdate('group1', 'GRANTED');
    const avatar = screen.getByTestId('talk-group-group1');
    expect(hasBackground(avatar, mockPalette.success)).toBe(true);
  });

  it('handles multi-group calls independently', () => {
    renderWithTalkCtx(<TalkScreen />);

    // Start call on group1
    startCall();
    const g1 = screen.getByTestId('talk-group-group1');
    expect(hasBackground(g1, mockPalette.primary)).toBe(true);

    // Switch to group2 and start call there too
    fireEvent.press(screen.getByTestId('talk-group-group2'));
    startCall('group2');
    const g2 = screen.getByTestId('talk-group-group2');
    expect(hasBackground(g2, mockPalette.primary)).toBe(true);

    // group1 should still be blue
    expect(hasBackground(g1, mockPalette.primary)).toBe(true);

    // Occupy group2 → group2 red, group1 stays blue
    floorUpdate('group2', 'TAKEN', { ownerId: 'sip:mcptt.mcuser-222@x' });
    expect(hasBackground(g2, mockPalette.error)).toBe(true);
    expect(hasBackground(g1, mockPalette.primary)).toBe(true);
  });

  it('switching groups restores per-group call state', () => {
    renderWithTalkCtx(<TalkScreen />);

    // Start call on group1, occupy it
    startCall();
    floorUpdate('group1', 'TAKEN', { ownerId: 'sip:mcptt.mcuser-222@x' });
    const g1 = screen.getByTestId('talk-group-group1');
    expect(hasBackground(g1, mockPalette.error)).toBe(true);

    // Switch to group2 (no call) → status label is empty (no active call)
    fireEvent.press(screen.getByTestId('talk-group-group2'));
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('');

    // Switch back to group1 → should restore occupied/red state
    fireEvent.press(screen.getByTestId('talk-group-group1'));
    expect(screen.getByTestId('talk-status-text')).toHaveTextContent('Other speaking');
    expect(hasBackground(g1, mockPalette.error)).toBe(true);
  });

  it('shows incoming call badge and auto-accepts after 3s', async () => {
    renderWithTalkCtx(<TalkScreen />);

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

  it('moves incoming call group to front of ordered groups once it activates', async () => {
    renderWithTalkCtx(<TalkScreen />);

    // Select group6 first so the auto-accept effect activates it on this screen.
    fireEvent.press(screen.getByTestId('talk-group-group6'));

    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-incoming-group6'));
    // Close the mock panel so the group labels are reachable.
    fireEvent.press(screen.getByTestId('talk-mock-close'));

    // Group ordering only reflects activation, so advance past auto-accept (3s).
    act(() => { jest.advanceTimersByTime(3000); });

    await waitFor(() => {
      const labels = screen.getAllByText(/^group\d+$/);
      expect(labels[0]).toHaveTextContent('group6');
    });
  });

  it('toggles group action menu', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-menu-toggle'));
    expect(screen.getByTestId('talk-group-menu-alert')).toBeTruthy();
    expect(screen.getByTestId('talk-group-menu-mute')).toBeTruthy();

    fireEvent.press(screen.getByTestId('talk-group-menu-mute'));
    expect(screen.queryByTestId('talk-group-menu-alert')).toBeNull();
  });

  it('shows selected group label as active', () => {
    renderWithTalkCtx(<TalkScreen />);
    const labels = screen.getAllByText('group1');
    // First match is the group label below the avatar
    const label = labels[0];
    const style = Array.isArray(label.props.style) ? label.props.style : [label.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ color: mockPalette.textPrimary })]));
  });

  it('shows incoming badge with pointerEvents none', async () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-incoming-group3'));

    await waitFor(() => {
      const badge = screen.getByTestId('talk-incoming-badge-group3');
      expect(badge?.props.pointerEvents).toBe('none');
    });
  });

  it('shows inactive group label with muted color', () => {
    renderWithTalkCtx(<TalkScreen />);
    // group2 is not selected by default
    const label = screen.getByText('group2');
    const style = Array.isArray(label.props.style) ? label.props.style : [label.props.style];
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ color: mockPalette.textSecondary })]));
  });

  it('incoming badge disappears after auto-accept', async () => {
    renderWithTalkCtx(<TalkScreen />);
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
    renderWithTalkCtx(<TalkScreen />);
    // group3 is a data group
    fireEvent.press(screen.getByTestId('talk-group-group3'));

    // Start call first
    startCall('group3');

    fireEvent.press(screen.getByTestId('talk-mode-messages'));

    // MessagesScreen should render (the TalkScreen should unmount)
    expect(screen.queryByTestId('talk-push-button')).toBeNull();
  });

  it('messages button hidden when the affiliation does not cover MCData', () => {
    // The Messages mode is driven by the affiliation's isData flag, not by a
    // hardcoded group list, so a PTT-only affiliation must not offer it.
    renderWithTalkCtx(<TalkScreen />, [
      { groupId: 'group1', name: 'group1', isPtt: true, isVideo: false, isData: false },
    ]);
    expect(screen.queryByTestId('talk-mode-messages')).toBeNull();
  });

  it('hides receive/transmit when the affiliation does not cover MCVideo', () => {
    // Receive and Transmit are the video modes — a PTT-only group has neither.
    renderWithTalkCtx(<TalkScreen />, [
      { groupId: 'group1', name: 'group1', isPtt: true, isVideo: false, isData: false },
    ]);
    expect(screen.queryByTestId('talk-mode-receive')).toBeNull();
    expect(screen.queryByTestId('talk-mode-transmit')).toBeNull();
  });

  it('shows receive/transmit when the affiliation covers MCVideo', () => {
    renderWithTalkCtx(<TalkScreen />, [
      { groupId: 'group1', name: 'group1', isPtt: true, isVideo: true, isData: false },
    ]);
    expect(screen.getByTestId('talk-mode-receive')).toBeTruthy();
    expect(screen.getByTestId('talk-mode-transmit')).toBeTruthy();
    // Video without data still means no messages.
    expect(screen.queryByTestId('talk-mode-messages')).toBeNull();
  });

  it('shows only messages for a data-only affiliation', () => {
    renderWithTalkCtx(<TalkScreen />, [
      { groupId: 'group1', name: 'group1', isPtt: true, isVideo: false, isData: true },
    ]);
    expect(screen.getByTestId('talk-mode-messages')).toBeTruthy();
    expect(screen.queryByTestId('talk-mode-receive')).toBeNull();
    expect(screen.queryByTestId('talk-mode-transmit')).toBeNull();
  });

  it('follows the selected group when service coverage differs', () => {
    // Switching groups must re-evaluate which modes apply.
    renderWithTalkCtx(<TalkScreen />, [
      { groupId: 'group1', name: 'group1', isPtt: true, isVideo: true, isData: false },
      { groupId: 'group2', name: 'group2', isPtt: true, isVideo: false, isData: false },
    ]);
    expect(screen.getByTestId('talk-mode-transmit')).toBeTruthy();

    fireEvent.press(screen.getByTestId('talk-group-group2'));
    expect(screen.queryByTestId('talk-mode-transmit')).toBeNull();
  });

  it('disables mode buttons when no call is active', () => {
    renderWithTalkCtx(<TalkScreen />);
    // group3 is a data group, so it has all 3 mode buttons
    fireEvent.press(screen.getByTestId('talk-group-group3'));

    const receiveBtn = screen.getByTestId('talk-mode-receive');
    const transmitBtn = screen.getByTestId('talk-mode-transmit');
    const messagesBtn = screen.getByTestId('talk-mode-messages');

    // TouchableOpacity surfaces `disabled` via accessibilityState.
    expect(receiveBtn.props.accessibilityState?.disabled).toBe(true);
    expect(transmitBtn.props.accessibilityState?.disabled).toBe(true);
    expect(messagesBtn.props.accessibilityState?.disabled).toBe(true);
  });
});


describe('TalkScreen — SDK group calls', () => {
  const status = () => screen.getByTestId('talk-status-text');
  const ptt = () => screen.getByTestId('talk-push-button');

  it('places the call on Start and shows it active once the SDK says so', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    expect(mockSdk.startGroupCall).toHaveBeenCalledWith('group1', 'AMR_WB_OCTET_ALIGNED');
    callUpdate('group1', 'CALLING');
    expect(status()).toHaveTextContent('');
    callUpdate('group1', 'ACTIVE');
    expect(status()).toHaveTextContent('Call active');
  });

  // MCPTT group calls ask for no floor on setup.
  it('starts the call from PTT without asking for the floor', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent(ptt(), 'pressIn');
    expect(mockSdk.startGroupCall).toHaveBeenCalledWith('group1', 'AMR_WB_OCTET_ALIGNED');
    expect(mockSdk.requestFloor).not.toHaveBeenCalled();
  });

  it('shows talking only once the server grants the floor', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent(ptt(), 'pressIn');
    expect(mockSdk.requestFloor).toHaveBeenCalledWith('call-group1');
    floorUpdate('group1', 'REQUESTED');
    expect(status()).not.toHaveTextContent('Talking');
    floorUpdate('group1', 'GRANTED');
    expect(status()).toHaveTextContent('Talking');
  });

  it('releases the floor on letting go and goes back to active at once', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent(ptt(), 'pressIn');
    floorUpdate('group1', 'GRANTED');
    fireEvent(ptt(), 'pressOut');
    expect(mockSdk.releaseFloor).toHaveBeenCalledWith('call-group1');
    expect(status()).toHaveTextContent('Call active');
  });

  it('withdraws a request still waiting when PTT is let go', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent(ptt(), 'pressIn');
    floorUpdate('group1', 'QUEUED', { queuePosition: 1 });
    fireEvent(ptt(), 'pressOut');
    expect(mockSdk.releaseFloor).toHaveBeenCalledWith('call-group1');
  });

  it('names the talker and keeps PTT passive while someone else talks', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    floorUpdate('group1', 'TAKEN', {
      ownerId: 'sip:mcptt.mcuser-222@ims.example.org',
      talkers: [{ id: 'sip:mcptt.mcuser-222@ims.example.org', ssrc: 1 }],
    });
    expect(status()).toHaveTextContent('Other speaking');
    expect(screen.getByTestId('talk-speaker-name')).toHaveTextContent('mcuser-222');
    expect(ptt()).toBeDisabled();
  });

  it('ends the hold when the floor turns busy under the finger', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent(ptt(), 'pressIn');
    floorUpdate('group1', 'DENIED', { denyReason: 'ANOTHER_CLIENT_HAS_PERMISSION' });
    floorUpdate('group1', 'TAKEN', { ownerId: 'sip:mcptt.mcuser-222@x' });
    expect(mockSdk.releaseFloor).toHaveBeenCalledWith('call-group1');
  });

  it('shows why the floor was denied, under the button', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent(ptt(), 'pressIn');
    floorUpdate('group1', 'DENIED', { denyReason: 'ANOTHER_CLIENT_HAS_PERMISSION' });
    expect(screen.getByTestId('talk-floor-notice')).toHaveTextContent('Someone else has the floor');
  });

  it('leaves the call on End', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent.press(screen.getByTestId('talk-end-button'));
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('call-group1');
    expect(screen.getByTestId('talk-start-button')).toBeTruthy();
  });

  it('goes back to inactive when the server ends the call', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fire(callListeners.terminated, {
      callId: 'call-group1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL', sipCode: 0, sipReason: '',
    });
    expect(status()).toHaveTextContent('');
    expect(screen.getByTestId('talk-start-button')).toBeTruthy();
  });

  it('says so when a call we started is refused before it comes up', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-start-button'));
    callUpdate('group1', 'CALLING');
    fire(callListeners.terminated, {
      callId: 'call-group1', mode: 'REJECTED_REMOTELY', reason: 'FORBIDDEN', sipCode: 403, sipReason: '',
    });
    expect(screen.getByTestId('talk-floor-notice')).toHaveTextContent('The group call could not be set up');
  });

  // The SDK answers group calls itself: one comes up with nobody pressing anything.
  it('shows a call another member started on a group not selected, first in line', () => {
    renderWithTalkCtx(<TalkScreen />);
    callUpdate('group5', 'ACTIVE', { outgoing: false });
    expect(hasBackground(screen.getByTestId('talk-group-group5'), mockPalette.primary)).toBe(true);
    expect(screen.getAllByText(/^group\d+$/)[0]).toHaveTextContent('group5');
  });

  it('offers to mute the group, then to unmute it, and marks it muted', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-menu-toggle'));
    expect(screen.getByTestId('talk-group-menu-mute')).toHaveTextContent('Mute On');
    expect(screen.queryByTestId('talk-group-muted')).toBeNull();

    fireEvent.press(screen.getByTestId('talk-group-menu-mute'));
    expect(screen.getByTestId('talk-group-muted')).toBeTruthy();
    fireEvent.press(screen.getByTestId('talk-group-menu-toggle'));
    expect(screen.getByTestId('talk-group-menu-mute')).toHaveTextContent('Mute Off');
  });

  it('keeps the mute with the group it was set on', () => {
    renderWithTalkCtx(<TalkScreen />);
    fireEvent.press(screen.getByTestId('talk-group-menu-toggle'));
    fireEvent.press(screen.getByTestId('talk-group-menu-mute'));
    fireEvent.press(screen.getByTestId('talk-group-group2'));
    expect(screen.queryByTestId('talk-group-muted')).toBeNull();
    fireEvent.press(screen.getByTestId('talk-group-group1'));
    expect(screen.getByTestId('talk-group-muted')).toBeTruthy();
  });

  // The mock panel acts on the simulated call; the SDK's takes precedence.
  it('lets the SDK call win over the mock panel', () => {
    renderWithTalkCtx(<TalkScreen />);
    startCall();
    fireEvent.press(screen.getByTestId('talk-mock-toggle'));
    fireEvent.press(screen.getByTestId('talk-mock-occupy'));
    expect(status()).toHaveTextContent('Call active');
  });
});

describe('TalkScreen — group affiliation', () => {
  const g = (
    groupId: string,
    services: Partial<Pick<MockGroup, 'isPtt' | 'isVideo' | 'isData'>> = {},
    name = groupId,
  ): MockGroup => ({
    groupId,
    name,
    isPtt: services.isPtt ?? true,
    isVideo: services.isVideo ?? false,
    isData: services.isData ?? false,
  });

  it('lists only affiliated groups in the selector', () => {
    // group2 is provisioned but not affiliated → editor only, not the strip.
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2'), g('group3')],
      [g('group1'), g('group3')]);

    expect(screen.getByTestId('talk-group-group1')).toBeTruthy();
    expect(screen.getByTestId('talk-group-group3')).toBeTruthy();
    expect(screen.queryByTestId('talk-group-group2')).toBeNull();
  });

  it('shows the group name rather than the raw id', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1', {}, 'Komuta Kontrol')]);
    expect(screen.getByText('Komuta Kontrol')).toBeTruthy();
  });

  it('falls back to the group id when the SDK sends an empty name', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1', {}, '')]);
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group1');
  });

  it('shows the empty hint when nothing is affiliated', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1')], []);
    expect(screen.getByText('No affiliated groups — use edit to add some.')).toBeTruthy();
  });

  it('says the list is pending before the SDK has delivered it', () => {
    renderWithTalkCtx(<TalkScreen />, null);
    expect(screen.getByText('The group list arrives once registration completes.'))
      .toBeTruthy();
  });

  it('opens the affiliation editor from the edit button', () => {
    renderWithTalkCtx(<TalkScreen />);
    expect(screen.queryByTestId('talk-aff-apply')).toBeNull();

    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    expect(screen.getByText('Group Affiliation')).toBeTruthy();
  });

  it('lists every provisioned group in the editor, affiliated or not', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')], [g('group1')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));

    expect(screen.getByTestId('talk-aff-row-group1')).toBeTruthy();
    expect(screen.getByTestId('talk-aff-row-group2')).toBeTruthy();
  });

  it('disables Apply until the draft differs', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')], [g('group1')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));

    expect(screen.getByTestId('talk-aff-apply').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText('No changes')).toBeTruthy();

    fireEvent.press(screen.getByTestId('talk-aff-row-group2'));
    expect(screen.getByTestId('talk-aff-apply').props.accessibilityState?.disabled).toBe(false);
  });

  it('shows the diff for both directions', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')], [g('group1')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));

    fireEvent.press(screen.getByTestId('talk-aff-row-group2')); // affiliate
    fireEvent.press(screen.getByTestId('talk-aff-row-group1')); // deaffiliate

    expect(screen.getByText('+1 affiliate')).toBeTruthy();
    expect(screen.getByText('−1 deaffiliate')).toBeTruthy();
  });

  // ── Service chips are read-only ────────────────────────────────────────────
  // A group's service set comes from its provisioning; the SDK validates every
  // requested flag against it. There is nothing for the user to choose, so the
  // chips only report what the group supports.

  it('shows a chip only for the services the group supports', () => {
    renderWithTalkCtx(<TalkScreen />,
      [g('group1', { isPtt: true, isVideo: false, isData: true })], []);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));

    expect(screen.getByTestId('talk-aff-svc-group1-ptt')).toBeTruthy();
    expect(screen.getByTestId('talk-aff-svc-group1-data')).toBeTruthy();
    // Video is not offered by this group — no chip at all.
    expect(screen.queryByTestId('talk-aff-svc-group1-video')).toBeNull();
  });

  it('never sends a partial service set for a selected group', () => {
    // The chips are inert, so pressing one cannot deselect a service — the only
    // thing a tap can do is toggle the whole group. Whatever the user does, an
    // affiliated group is always requested with its full service set.
    const grp = g('group1', { isPtt: true, isVideo: true, isData: true });
    renderWithTalkCtx(<TalkScreen />, [grp], []);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));

    fireEvent.press(screen.getByTestId('talk-aff-svc-group1-video'));
    fireEvent.press(screen.getByTestId('talk-aff-apply'));

    expect(mockSdk.affiliate).toHaveBeenCalledWith([
      { groupId: 'group1', ptt: true, video: true, data: true },
    ]);
  });

  it('requests every supported service when a group is selected', () => {
    renderWithTalkCtx(<TalkScreen />,
      [g('group1', { isPtt: true, isVideo: false, isData: true })], []);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    fireEvent.press(screen.getByTestId('talk-aff-row-group1'));
    fireEvent.press(screen.getByTestId('talk-aff-apply'));

    // Exactly the group's own service set — video is absent because the group
    // does not offer it, not because anything was deselected.
    expect(mockSdk.affiliate).toHaveBeenCalledWith([
      { groupId: 'group1', ptt: true, video: false, data: true },
    ]);
  });

  it('seeds the selection from the affiliated set', () => {
    // Supports all three; the affiliation covers only PTT. The group still
    // counts as affiliated, so it starts selected and nothing looks changed.
    renderWithTalkCtx(<TalkScreen />,
      [g('group1', { isPtt: true, isVideo: true, isData: true })],
      [g('group1', { isPtt: true, isVideo: false, isData: false })]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));

    expect(screen.getByText('No changes')).toBeTruthy();
    expect(screen.getByText('1/1 groups affiliated')).toBeTruthy();
  });

  // ── Sending ───────────────────────────────────────────────────────────────

  it('sends the complete desired set, not just the diff', () => {
    renderWithTalkCtx(<TalkScreen />,
      [g('group1'), g('group2'), g('group3')], [g('group1'), g('group2')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    fireEvent.press(screen.getByTestId('talk-aff-row-group3'));
    fireEvent.press(screen.getByTestId('talk-aff-apply'));

    // Sdk::Affiliate is state-replacing: already-affiliated groups must be
    // resent or the server would drop them.
    expect(mockSdk.affiliate).toHaveBeenCalledWith([
      { groupId: 'group1', ptt: true, video: false, data: false },
      { groupId: 'group2', ptt: true, video: false, data: false },
      { groupId: 'group3', ptt: true, video: false, data: false },
    ]);
    expect(mockSdk.deaffiliate).not.toHaveBeenCalled();
  });

  it('calls deaffiliate() when the last group is removed', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1')], [g('group1')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    fireEvent.press(screen.getByTestId('talk-aff-row-group1'));
    fireEvent.press(screen.getByTestId('talk-aff-apply'));

    expect(mockSdk.deaffiliate).toHaveBeenCalled();
    expect(mockSdk.affiliate).not.toHaveBeenCalled();
  });

  it('closes without sending anything on Cancel', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')], [g('group1')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    fireEvent.press(screen.getByTestId('talk-aff-row-group2'));
    fireEvent.press(screen.getByTestId('talk-aff-cancel'));

    expect(screen.queryByTestId('talk-aff-apply')).toBeNull();
    expect(mockSdk.affiliate).not.toHaveBeenCalled();
    expect(mockSdk.deaffiliate).not.toHaveBeenCalled();
  });

  it('selects every group with all its supported services on Select all', () => {
    renderWithTalkCtx(<TalkScreen />, [
      g('group1', { isPtt: true, isVideo: false, isData: false }),
      g('group2', { isPtt: true, isVideo: true, isData: false }),
    ], []);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    fireEvent.press(screen.getByTestId('talk-aff-select-all'));
    fireEvent.press(screen.getByTestId('talk-aff-apply'));

    expect(mockSdk.affiliate).toHaveBeenCalledWith([
      { groupId: 'group1', ptt: true, video: false, data: false },
      { groupId: 'group2', ptt: true, video: true, data: false },
    ]);
  });

  it('deaffiliates everything on Clear', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')],
      [g('group1'), g('group2')]);
    fireEvent.press(screen.getByTestId('talk-aff-edit'));
    fireEvent.press(screen.getByTestId('talk-aff-clear-all'));
    fireEvent.press(screen.getByTestId('talk-aff-apply'));

    expect(mockSdk.deaffiliate).toHaveBeenCalled();
  });

  // ── Reacting to SDK pushes ────────────────────────────────────────────────

  it('moves the selection off a group that is no longer affiliated', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')],
      [g('group1'), g('group2')]);
    fireEvent.press(screen.getByTestId('talk-group-group2'));
    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group2');

    // The SDK reports group2 dropped → selection must fall back to a real group.
    emitGroups([g('group1'), g('group2')], [g('group1')]);

    expect(screen.getByTestId('talk-selected-group')).toHaveTextContent('group1');
  });

  it('reflects a group newly affiliated by an SDK push', () => {
    renderWithTalkCtx(<TalkScreen />, [g('group1'), g('group2')], [g('group1')]);
    expect(screen.queryByTestId('talk-group-group2')).toBeNull();

    emitGroups([g('group1'), g('group2')], [g('group1'), g('group2')]);

    expect(screen.getByTestId('talk-group-group2')).toBeTruthy();
  });

  it('keys the modes off supported services, not the affiliated ones', () => {
    // The group supports MCData/MCVideo but the affiliation was only established
    // for MCPTT. The editor's chips show what the group supports, so the mode
    // buttons must agree with them — otherwise a group shows a "Data" chip while
    // its Messages button is missing.
    renderWithTalkCtx(<TalkScreen />,
      [g('group1', { isPtt: true, isVideo: true, isData: true })],
      [g('group1', { isPtt: true, isVideo: false, isData: false })]);

    expect(screen.getByTestId('talk-mode-messages')).toBeTruthy();
    expect(screen.getByTestId('talk-mode-receive')).toBeTruthy();
    expect(screen.getByTestId('talk-mode-transmit')).toBeTruthy();
  });
});
