/**
 * __tests__/call-ptt.test.tsx
 *
 * The two PTT buttons of an active call, against a stubbed CallContext. Both
 * must send floor commands rather than set the floor state themselves: the
 * full-screen button is press-and-hold, the card's button is a tap toggle.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ActiveCall, FloorState } from '../src/features/calls/types';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-sound-level', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  onNewFrame: () => {},
}));

jest.mock('../src/core/permissions', () => ({
  ensureMicPermission: jest.fn(async () => 'denied'),
}));

jest.mock('../src/core/mediaSession', () => ({
  MediaSession: {
    claimMicForMeter: jest.fn(async () => false),
    releaseMicForMeter: jest.fn(),
  },
}));

jest.mock('../src/contexts/NavigationContext', () => ({
  useNavigation: () => ({ leaveCallScreen: jest.fn() }),
}));

jest.mock('../src/contexts/AppContext', () => ({
  useAppContext: () => ({
    c: require('../src/core/theme').getThemePalette('dark'),
    theme: 'dark',
    tr: require('../src/core/i18n').getTranslation('en'),
  }),
}));

const mockCall = {
  activeCall: null as ActiveCall | null,
  requestFloor: jest.fn(),
  releaseFloor: jest.fn(),
  endCall: jest.fn(),
  joinCall: jest.fn(),
  simulateFloorBusy: jest.fn(),
  simulateFloorIdle: jest.fn(),
  speakerOn: false,
  micMuted: false,
  toggleSpeaker: jest.fn(),
  toggleMute: jest.fn(),
};

jest.mock('../src/contexts/CallContext', () => ({
  useCallContext: () => mockCall,
}));

import { ActiveCallFullScreen } from '../src/features/calls/ActiveCallFullScreen';
import { ActiveCallCard } from '../src/features/calls/ActiveCallCard';

const call = (floorState: FloorState, over: Partial<ActiveCall> = {}): ActiveCall => ({
  id: 'local-1',
  sdkCallId: 'call-1',
  contactName: 'Bob',
  sipUri: 'sip:bob@example.org',
  callType: 'half_duplex',
  direction: 'outgoing',
  commencementMode: 'auto',
  state: 'active',
  floorState,
  startedAt: Date.now(),
  needsManualJoin: false,
  ...over,
});

beforeEach(() => {
  mockCall.requestFloor.mockClear();
  mockCall.releaseFloor.mockClear();
  mockCall.toggleSpeaker.mockClear();
  mockCall.toggleMute.mockClear();
  mockCall.speakerOn = false;
  mockCall.micMuted = false;
});

describe('ActiveCallFullScreen — press-and-hold PTT', () => {
  // The screen runs a looping pulse animation; keep it from ticking after the test.
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('requests the floor on press and releases it on release', () => {
    mockCall.activeCall = call('idle');
    render(<ActiveCallFullScreen />);

    fireEvent(screen.getByTestId('ptt-button'), 'pressIn');
    expect(mockCall.requestFloor).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByTestId('ptt-button'), 'pressOut');
    expect(mockCall.releaseFloor).toHaveBeenCalledTimes(1);
  });

  // Letting go before the grant arrives must withdraw the request.
  it('releases while the request is still pending', () => {
    mockCall.activeCall = call('requesting');
    render(<ActiveCallFullScreen />);

    fireEvent(screen.getByTestId('ptt-button'), 'pressOut');
    expect(mockCall.releaseFloor).toHaveBeenCalledTimes(1);
  });

  it('still lets the user ask while someone else is talking', () => {
    mockCall.activeCall = call('busy');
    render(<ActiveCallFullScreen />);

    fireEvent(screen.getByTestId('ptt-button'), 'pressIn');
    expect(mockCall.requestFloor).toHaveBeenCalledTimes(1);
  });
});

describe('ActiveCallCard — tap-toggle PTT', () => {
  const tap = () => fireEvent.press(screen.getByTestId('floor-button'));

  it.each<FloorState>(['idle', 'busy'])('asks for the floor from %s', floorState => {
    mockCall.activeCall = call(floorState);
    render(<ActiveCallCard />);
    tap();
    expect(mockCall.requestFloor).toHaveBeenCalledTimes(1);
    expect(mockCall.releaseFloor).not.toHaveBeenCalled();
  });

  it.each<FloorState>(['requesting', 'queued', 'granted'])('lets go from %s', floorState => {
    mockCall.activeCall = call(floorState);
    render(<ActiveCallCard />);
    tap();
    expect(mockCall.releaseFloor).toHaveBeenCalledTimes(1);
    expect(mockCall.requestFloor).not.toHaveBeenCalled();
  });
});

// Labels come from i18n (en here) — the screens used to hardcode English.
describe('PTT labels and notices', () => {
  const en = require('../src/core/i18n').getTranslation('en');

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it.each<[FloorState, string]>([
    ['idle',       en.floorPressHold],
    ['requesting', en.floorRequesting],
    ['queued',     'Queued: 2'],
    ['granted',    en.floorGranted],
    ['busy',       en.floorBusy],
  ])('full screen labels %s', (floorState, label) => {
    mockCall.activeCall = call(floorState, { queuePosition: 2 });
    render(<ActiveCallFullScreen />);
    expect(screen.getByTestId('ptt-button')).toHaveTextContent(label);
  });

  it.each<[FloorState, string]>([
    ['idle',       en.floorIdle],
    ['requesting', en.floorRequesting],
    ['queued',     'Queued: 2'],
    ['granted',    en.floorGranted],
    ['busy',       en.floorBusy],
  ])('card labels %s', (floorState, label) => {
    mockCall.activeCall = call(floorState, { queuePosition: 2 });
    render(<ActiveCallCard />);
    // The button also holds its icon.
    expect(screen.getByTestId('floor-button')).toHaveTextContent(label, { exact: false });
  });

  it('names the talker under both buttons while the floor is busy', () => {
    mockCall.activeCall = call('busy', { floorOwner: 'mcuser-222' });
    render(<ActiveCallFullScreen />);
    expect(screen.getByTestId('floor-detail')).toHaveTextContent('Talking: mcuser-222');
    screen.unmount();

    render(<ActiveCallCard />);
    expect(screen.getByTestId('floor-detail')).toHaveTextContent('Talking: mcuser-222');
  });

  it('shows a notice and hides it after a few seconds', () => {
    mockCall.activeCall = call('idle', { floorNotice: 'DENIED:ANOTHER_CLIENT_HAS_PERMISSION' });
    render(<ActiveCallCard />);
    expect(screen.getByTestId('floor-notice')).toHaveTextContent(en.floorDeniedOtherTalker);

    act(() => { jest.advanceTimersByTime(4000); });
    expect(screen.getByTestId('floor-notice')).toHaveTextContent('');
  });
});

// The full-screen PTT sits in a vertically centred column: anything under it
// changing height would move the button.
describe('PTT button position', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  const { StyleSheet } = require('react-native');
  const heightOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).height;

  it.each<[FloorState, string | undefined]>([
    ['idle', undefined],
    ['granted', undefined],
    ['busy', 'DENIED:ANOTHER_CLIENT_HAS_PERMISSION'],
  ])('keeps the lines under the button the same height when %s', (floorState, floorNotice) => {
    mockCall.activeCall = call(floorState, { floorNotice, floorOwner: 'mcuser-222' });
    render(<ActiveCallFullScreen />);
    expect(heightOf('floor-detail')).toBe(20);
    expect(heightOf('floor-notice')).toBe(40);
  });
});

describe('ActiveCallFullScreen — mute, end call, speaker', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  const en = require('../src/core/i18n').getTranslation('en');

  it('puts mute and speaker either side of end call, with i18n labels', () => {
    mockCall.activeCall = call('idle');
    render(<ActiveCallFullScreen />);
    expect(screen.getByTestId('mute-button')).toBeTruthy();
    expect(screen.getByTestId('end-call-button')).toBeTruthy();
    expect(screen.getByTestId('speaker-button')).toBeTruthy();
    expect(screen.getByText(en.btnEndCall)).toBeTruthy();
    expect(screen.getByText(en.callMute)).toBeTruthy();
    expect(screen.getByText(en.callSpeaker)).toBeTruthy();
  });

  it('toggles the speaker and mute through the call context', () => {
    mockCall.activeCall = call('idle');
    render(<ActiveCallFullScreen />);
    fireEvent.press(screen.getByTestId('speaker-button'));
    expect(mockCall.toggleSpeaker).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('mute-button'));
    expect(mockCall.toggleMute).toHaveBeenCalledTimes(1);
  });

  it('shows the speaker and mute as on when they are', () => {
    mockCall.activeCall = call('idle');
    mockCall.speakerOn = true;
    mockCall.micMuted = true;
    render(<ActiveCallFullScreen />);
    expect(screen.getByTestId('speaker-button').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('mute-button').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('speaker-button')).toHaveTextContent('🔊');
    expect(screen.getByTestId('mute-button')).toHaveTextContent('🔇');
  });

  it('names the talker by MC ID, not by SIP URI', () => {
    mockCall.activeCall = call('busy', { floorOwner: 'sip:mcptt.mcuser-222@ims.example.org' });
    render(<ActiveCallFullScreen />);
    expect(screen.getByTestId('floor-detail')).toHaveTextContent('Talking: mcuser-222');
  });
});
