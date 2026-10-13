/**
 * __tests__/call-sdk-wiring.test.tsx
 *
 * CallContext driven by the SDK's call callbacks. Covers the incoming-call path
 * (which raises the ringing overlay), the state/floor mapping, and that user
 * actions are addressed to the SDK's own call id.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Handler<T> = (e: T) => void;

const incoming: Handler<any>[] = [];
const updated: Handler<any>[] = [];
const terminated: Handler<any>[] = [];
const floor: Handler<any>[] = [];

const sub = (list: Handler<any>[]) => (h: Handler<any>) => {
  list.push(h);
  return { remove: () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); } };
};

const mockSdk = {
  answerCall: jest.fn(),
  rejectCall: jest.fn(),
  terminateCall: jest.fn(),
  startPrivateCall: jest.fn(),
  onIncomingCall: sub(incoming),
  onCallUpdated: sub(updated),
  onCallTerminated: sub(terminated),
  onFloorUpdated: sub(floor),
};

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
}));

// The logged-in user, used to tell "we hold the floor" from "someone else does".
jest.mock('../src/core/settings', () => ({
  AuthSettings: { getLastUsername: () => 'mcuser-111' },
}));

import { CallContextProvider, useCallContext } from '../src/contexts/CallContext';

let ctx: ReturnType<typeof useCallContext>;

function Probe() {
  ctx = useCallContext();
  const c = ctx.activeCall;
  return (
    <>
      <mock-text testID="state">{c?.state ?? 'none'}</mock-text>
      <mock-text testID="floor">{c?.floorState ?? 'none'}</mock-text>
      <mock-text testID="name">{c?.contactName ?? ''}</mock-text>
      <mock-text testID="dir">{c?.direction ?? ''}</mock-text>
      <mock-text testID="history">{String(ctx.callHistory.length)}</mock-text>
    </>
  );
}

function renderProbe() {
  return render(<CallContextProvider><Probe /></CallContextProvider>);
}

const callInfo = (over: Partial<any> = {}) => ({
  callId: 'call-1',
  type: 'PRIVATE',
  state: 'INCOMING',
  outgoing: false,
  isEmergency: false,
  isImminentPeril: false,
  callerId: 'mcuser-222',
  calleeId: 'mcuser-111',
  groupId: '',
  ...over,
});

const fire = (list: Handler<any>[], e: any) => act(() => { list.forEach(h => h(e)); });

beforeEach(() => {
  incoming.length = 0; updated.length = 0; terminated.length = 0; floor.length = 0;
  mockSdk.answerCall.mockClear();
  mockSdk.rejectCall.mockClear();
  mockSdk.terminateCall.mockClear();
  mockSdk.startPrivateCall.mockClear();
});

describe('CallContext — SDK incoming call', () => {
  it('has no active call before anything arrives', () => {
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });

  it('raises a ringing call when the SDK reports one', () => {
    renderProbe();
    fire(incoming, callInfo());
    // 'ringing' is what makes IncomingCallOverlay show.
    expect(screen.getByTestId('state')).toHaveTextContent('ringing');
    expect(screen.getByTestId('dir')).toHaveTextContent('incoming');
  });

  it('labels the call with the caller id for a private call', () => {
    renderProbe();
    fire(incoming, callInfo());
    expect(screen.getByTestId('name')).toHaveTextContent('mcuser-222');
  });

  it('prefers the group id for a group call', () => {
    renderProbe();
    fire(incoming, callInfo({ type: 'GROUP', groupId: 'sip:group.a@example.org' }));
    expect(screen.getByTestId('name')).toHaveTextContent('sip:group.a@example.org');
  });

  it('answers through the SDK using its call id', () => {
    renderProbe();
    fire(incoming, callInfo());
    act(() => { ctx.acceptCall(); });

    expect(mockSdk.answerCall).toHaveBeenCalledWith('call-1');
    // Stays 'connecting' until the SDK confirms ACTIVE — no optimistic jump.
    expect(screen.getByTestId('state')).toHaveTextContent('connecting');
  });

  it('goes active only when the SDK reports ACTIVE', () => {
    renderProbe();
    fire(incoming, callInfo());
    act(() => { ctx.acceptCall(); });
    fire(updated, callInfo({ state: 'ACTIVE' }));

    expect(screen.getByTestId('state')).toHaveTextContent('active');
  });

  it('rejects through the SDK and records a 0-duration entry', () => {
    renderProbe();
    fire(incoming, callInfo());
    act(() => { ctx.rejectCall(); });

    expect(mockSdk.rejectCall).toHaveBeenCalledWith('call-1');
    expect(screen.getByTestId('state')).toHaveTextContent('none');
    expect(screen.getByTestId('history')).toHaveTextContent('1');
  });

  it('terminates through the SDK when the user ends the call', () => {
    renderProbe();
    fire(incoming, callInfo());
    fire(updated, callInfo({ state: 'ACTIVE' }));
    act(() => { ctx.endCall(); });

    expect(mockSdk.terminateCall).toHaveBeenCalledWith('call-1');
    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });

  it('clears the call when the SDK reports it terminated', () => {
    renderProbe();
    fire(incoming, callInfo());
    fire(terminated, { callId: 'call-1', mode: 'CLOSED_REMOTELY', reason: 'UNKNOWN' });

    expect(screen.getByTestId('state')).toHaveTextContent('none');
    expect(screen.getByTestId('history')).toHaveTextContent('1');
  });

  it('ignores events addressed to a different call id', () => {
    renderProbe();
    fire(incoming, callInfo());
    fire(terminated, { callId: 'other-call', mode: 'CLOSED_REMOTELY', reason: 'UNKNOWN' });

    expect(screen.getByTestId('state')).toHaveTextContent('ringing');
  });

  it('replaces an existing call when a new one comes in', () => {
    renderProbe();
    fire(incoming, callInfo());
    fire(incoming, callInfo({ callId: 'call-2', callerId: 'mcuser-333' }));

    expect(screen.getByTestId('name')).toHaveTextContent('mcuser-333');
    expect(screen.getByTestId('history')).toHaveTextContent('1');
  });
});

describe('CallContext — floor state from the SDK', () => {
  const ring = () => fire(incoming, callInfo());

  it('shows granted when we own the floor', () => {
    renderProbe();
    ring();
    fire(floor, { callId: 'call-1', ownerId: 'mcuser-111', status: 'GRANTED', queuePosition: 0 });
    expect(screen.getByTestId('floor')).toHaveTextContent('granted');
  });

  it('shows busy when someone else holds it', () => {
    renderProbe();
    ring();
    fire(floor, { callId: 'call-1', ownerId: 'mcuser-999', status: 'GRANTED', queuePosition: 0 });
    expect(screen.getByTestId('floor')).toHaveTextContent('busy');
  });

  it('treats TAKEN as busy regardless of owner', () => {
    renderProbe();
    ring();
    fire(floor, { callId: 'call-1', ownerId: '', status: 'TAKEN', queuePosition: 0 });
    expect(screen.getByTestId('floor')).toHaveTextContent('busy');
  });

  it('returns to idle when the floor is released', () => {
    renderProbe();
    ring();
    fire(floor, { callId: 'call-1', ownerId: 'mcuser-111', status: 'GRANTED', queuePosition: 0 });
    fire(floor, { callId: 'call-1', ownerId: '', status: 'RELEASED', queuePosition: 0 });
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');
  });
});

describe('CallContext — outgoing calls', () => {
  it('places the call through the SDK', () => {
    renderProbe();
    act(() => { ctx.startCall('Bob', 'sip:bob@example.org', 'half_duplex'); });

    expect(mockSdk.startPrivateCall).toHaveBeenCalledWith('sip:bob@example.org');
    // Never instantly active — the SDK decides when it connects.
    expect(screen.getByTestId('state')).toHaveTextContent('connecting');
  });

  it('adopts the SDK call id so later events match', () => {
    renderProbe();
    act(() => { ctx.startCall('Bob', 'sip:bob@example.org', 'half_duplex'); });
    fire(updated, callInfo({ callId: 'out-1', state: 'ACTIVE', outgoing: true }));

    expect(screen.getByTestId('state')).toHaveTextContent('active');

    act(() => { ctx.endCall(); });
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('out-1');
  });
});
