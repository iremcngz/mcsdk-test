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
const sdkError: Handler<any>[] = [];

const sub = (list: Handler<any>[]) => (h: Handler<any>) => {
  list.push(h);
  return { remove: () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); } };
};

const mockSdk = {
  answerCall: jest.fn(),
  rejectCall: jest.fn(),
  terminateCall: jest.fn(),
  startPrivateCall: jest.fn(),
  requestFloor: jest.fn(),
  releaseFloor: jest.fn(),
  onIncomingCall: sub(incoming),
  onCallUpdated: sub(updated),
  onCallTerminated: sub(terminated),
  onFloorUpdated: sub(floor),
  onSdkError: sub(sdkError),
};

const mockSetRoute = jest.fn();
jest.mock('../src/core/mediaSession', () => ({
  MediaSession: { setRoute: (...a: unknown[]) => mockSetRoute(...a) },
}));

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
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
      <mock-text testID="owner">{c?.floorOwner ?? ''}</mock-text>
      <mock-text testID="queue">{c?.queuePosition === undefined ? '' : String(c.queuePosition)}</mock-text>
      <mock-text testID="notice">{c?.floorNotice ?? ''}</mock-text>
      <mock-text testID="name">{c?.contactName ?? ''}</mock-text>
      <mock-text testID="dir">{c?.direction ?? ''}</mock-text>
      <mock-text testID="history">{String(ctx.callHistory.length)}</mock-text>
      <mock-text testID="end">{endOf(ctx.callHistory[0])}</mock-text>
      <mock-text testID="speaker">{String(ctx.speakerOn)}</mock-text>
      <mock-text testID="muted">{String(ctx.micMuted)}</mock-text>
    </>
  );
}

// How the newest history record ended, as "MODE/REASON/code/text" ('' if unsaid).
const endOf = (r?: { end?: { mode: string; reason: string; sipCode?: number; sipReason?: string } }) =>
  r?.end ? [r.end.mode, r.end.reason, r.end.sipCode ?? '', r.end.sipReason ?? ''].join('/') : '';

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
  incoming.length = 0; updated.length = 0; terminated.length = 0; floor.length = 0; sdkError.length = 0;
  mockSdk.answerCall.mockClear();
  mockSdk.rejectCall.mockClear();
  mockSdk.terminateCall.mockClear();
  mockSdk.startPrivateCall.mockClear();
  mockSdk.requestFloor.mockClear();
  mockSetRoute.mockClear();
  mockSdk.releaseFloor.mockClear();
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

  // The SDK gives the caller as a full URI; only the MC ID is shown.
  it('labels the call with the bare MC ID, not the SIP URI', () => {
    renderProbe();
    fire(incoming, callInfo({ callerId: 'sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org' }));
    expect(screen.getByTestId('name')).toHaveTextContent('mcuser-222');
  });

  it('prefers the group id for a group call', () => {
    renderProbe();
    fire(incoming, callInfo({ type: 'GROUP', groupId: 'sip:group.a@example.org' }));
    expect(screen.getByTestId('name')).toHaveTextContent('group.a');
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
  const floorEvent = (over: Partial<any> = {}) => ({
    callId: 'call-1', ownerId: '', status: 'IDLE', queuePosition: 0,
    denyReason: 'UNKNOWN', revokeReason: 'UNKNOWN', ...over,
  });

  it('shows granted on GRANTED', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'GRANTED' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('granted');
  });

  // The SDK only sets ownerId on Floor Taken, so on our own grant it can still
  // name the previous talker. GRANTED is ours whatever ownerId says.
  it('shows granted on GRANTED even when ownerId names someone else', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'GRANTED', ownerId: 'mcuser-999' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('granted');
    expect(screen.getByTestId('owner')).toHaveTextContent('');
  });

  it('shows busy on TAKEN and names the talker', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'TAKEN', ownerId: 'mcuser-222' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('busy');
    expect(screen.getByTestId('owner')).toHaveTextContent('mcuser-222');
  });

  it('shows requesting on REQUESTED', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'REQUESTED' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('requesting');
  });

  it('shows queued with the position on QUEUED', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'QUEUED', queuePosition: 2 }));
    expect(screen.getByTestId('floor')).toHaveTextContent('queued');
    expect(screen.getByTestId('queue')).toHaveTextContent('2');
  });

  it('keeps queued on GRANT_PENDING, our turn waiting to be taken', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'GRANT_PENDING' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('queued');
  });

  it('returns to idle when the floor is released', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'GRANTED' }));
    fire(floor, floorEvent({ status: 'RELEASED' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');
  });

  it('drops the talker and queue position once they no longer apply', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'TAKEN', ownerId: 'mcuser-222' }));
    fire(floor, floorEvent({ status: 'QUEUED', queuePosition: 1 }));
    expect(screen.getByTestId('owner')).toHaveTextContent('');
    fire(floor, floorEvent({ status: 'IDLE' }));
    expect(screen.getByTestId('queue')).toHaveTextContent('');
  });

  it('goes idle with the deny reason on DENIED', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'DENIED', denyReason: 'ANOTHER_CLIENT_HAS_PERMISSION' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');
    expect(screen.getByTestId('notice')).toHaveTextContent('DENIED:ANOTHER_CLIENT_HAS_PERMISSION');
  });

  it('goes idle with the revoke reason on REVOKED', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'GRANTED' }));
    fire(floor, floorEvent({ status: 'REVOKED', revokeReason: 'MEDIA_BURST_TOO_LONG' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');
    expect(screen.getByTestId('notice')).toHaveTextContent('REVOKED:MEDIA_BURST_TOO_LONG');
  });

  it('reports a timeout as a notice', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'REQUEST_TIMEOUT' }));
    expect(screen.getByTestId('notice')).toHaveTextContent('REQUEST_TIMEOUT');
  });

  it('keeps the notice through a following IDLE and clears it on the next request', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ status: 'DENIED', denyReason: 'RECEIVE_ONLY' }));
    fire(floor, floorEvent({ status: 'IDLE' }));
    expect(screen.getByTestId('notice')).toHaveTextContent('DENIED:RECEIVE_ONLY');
    fire(floor, floorEvent({ status: 'REQUESTED' }));
    expect(screen.getByTestId('notice')).toHaveTextContent('');
  });

  it('ignores floor events for another call', () => {
    renderProbe();
    ring();
    fire(floor, floorEvent({ callId: 'other-call', status: 'TAKEN', ownerId: 'mcuser-222' }));
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');
  });
});

describe('CallContext — floor errors from the SDK', () => {
  const activeSdkCall = () => {
    fire(incoming, callInfo());
    fire(updated, callInfo({ state: 'ACTIVE' }));
  };

  it.each(['FLOOR_CHANNEL_FAILED', 'FLOOR_SDP_INVALID', 'FLOOR_SEND_FAILED'])(
    'puts %s on the active call as a notice', error => {
      renderProbe();
      activeSdkCall();
      fire(sdkError, { error });
      expect(screen.getByTestId('notice')).toHaveTextContent(`ERROR:${error}`);
    },
  );

  // Protocol noise the user can do nothing about stays in the log.
  it('ignores floor errors that do not stop PTT working', () => {
    renderProbe();
    activeSdkCall();
    fire(sdkError, { error: 'FLOOR_MESSAGE_MALFORMED' });
    fire(sdkError, { error: 'IDENTITY_NOT_SET' });
    expect(screen.getByTestId('notice')).toHaveTextContent('');
  });

  it('does nothing without an SDK call', () => {
    renderProbe();
    fire(sdkError, { error: 'FLOOR_SEND_FAILED' });
    expect(screen.getByTestId('state')).toHaveTextContent('none');
  });

  it('clears the error notice when the next request starts', () => {
    renderProbe();
    activeSdkCall();
    fire(sdkError, { error: 'FLOOR_SEND_FAILED' });
    fire(floor, { callId: 'call-1', ownerId: '', status: 'REQUESTED', queuePosition: 0 });
    expect(screen.getByTestId('notice')).toHaveTextContent('');
  });
});

describe('CallContext — how a call ended', () => {
  const activeSdkCall = () => {
    fire(incoming, callInfo());
    fire(updated, callInfo({ state: 'ACTIVE' }));
  };

  it('records the SDK termination info when the far end ends the call', () => {
    renderProbe();
    activeSdkCall();
    fire(terminated, {
      callId: 'call-1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL',
      sipCode: 200, sipReason: 'Normal call clearing',
    });
    expect(screen.getByTestId('end')).toHaveTextContent('CLOSED_REMOTELY/NORMAL/200/Normal call clearing');
  });

  it('records a hang-up here as closed locally', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.endCall(); });
    expect(screen.getByTestId('end')).toHaveTextContent('CLOSED_LOCALLY/NORMAL//');
  });

  // Hanging up before the far end answered is a cancel.
  it('records ending an unanswered outgoing call as cancelled locally', () => {
    renderProbe();
    act(() => { ctx.startCall('Bob', 'sip:bob@example.org', 'half_duplex'); });
    act(() => { ctx.endCall(); });
    expect(screen.getByTestId('end')).toHaveTextContent('CANCELLED_LOCALLY/UNKNOWN//');
  });

  it('records a rejected incoming call as declined here', () => {
    renderProbe();
    fire(incoming, callInfo());
    act(() => { ctx.rejectCall(); });
    expect(screen.getByTestId('end')).toHaveTextContent('REJECTED_LOCALLY/DECLINED//');
  });

  it('says nothing about a call replaced by a new one', () => {
    renderProbe();
    fire(incoming, callInfo());
    fire(incoming, callInfo({ callId: 'call-2' }));
    expect(screen.getByTestId('end')).toHaveTextContent('');
  });
});

describe('CallContext — speaker and mute', () => {
  const activeSdkCall = () => {
    fire(incoming, callInfo());
    fire(updated, callInfo({ state: 'ACTIVE' }));
  };

  it('starts on the earpiece, unmuted', () => {
    renderProbe();
    activeSdkCall();
    expect(screen.getByTestId('speaker')).toHaveTextContent('false');
    expect(screen.getByTestId('muted')).toHaveTextContent('false');
  });

  it('switches the real audio route both ways', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.toggleSpeaker(); });
    expect(mockSetRoute).toHaveBeenLastCalledWith('SPEAKER');
    expect(screen.getByTestId('speaker')).toHaveTextContent('true');

    act(() => { ctx.toggleSpeaker(); });
    expect(mockSetRoute).toHaveBeenLastCalledWith('EARPIECE');
    expect(screen.getByTestId('speaker')).toHaveTextContent('false');
  });

  // The route is device-wide; it must not outlive the call.
  it('puts the route back on the earpiece when the call ends', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.toggleSpeaker(); });
    act(() => { ctx.toggleMute(); });
    fire(terminated, { callId: 'call-1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL', sipCode: 200, sipReason: '' });

    expect(mockSetRoute).toHaveBeenLastCalledWith('EARPIECE');
    expect(screen.getByTestId('speaker')).toHaveTextContent('false');
    expect(screen.getByTestId('muted')).toHaveTextContent('false');
  });

  it('leaves the route alone at call end if the speaker was never on', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.endCall(); });
    expect(mockSetRoute).not.toHaveBeenCalled();
  });

  it('toggles mute without touching the audio route', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.toggleMute(); });
    expect(screen.getByTestId('muted')).toHaveTextContent('true');
    expect(mockSetRoute).not.toHaveBeenCalled();
  });
});

describe('CallContext — outgoing calls', () => {
  it('places the call through the SDK', () => {
    renderProbe();
    act(() => { ctx.startCall('Bob', 'sip:bob@example.org', 'half_duplex'); });

    expect(mockSdk.startPrivateCall).toHaveBeenCalledWith('sip:bob@example.org', true, false);
    // Never instantly active — the SDK decides when it connects.
    expect(screen.getByTestId('state')).toHaveTextContent('connecting');
  });

  it('passes the chosen duplex and commencement mode to the SDK', () => {
    renderProbe();
    act(() => { ctx.startCall('Bob', 'sip:bob@example.org', 'full_duplex', 'manual'); });

    expect(mockSdk.startPrivateCall).toHaveBeenCalledWith('sip:bob@example.org', false, true);
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

describe('CallContext — floor commands', () => {
  const activeSdkCall = () => {
    fire(incoming, callInfo());
    fire(updated, callInfo({ state: 'ACTIVE' }));
  };

  // A local call with no sdkCallId, as the mock panel creates.
  const activeLocalCall = () => {
    act(() => { ctx.simulateIncomingCall('Alice', 'sip:alice@example.org', 'half_duplex'); });
    act(() => { ctx.acceptCall(); });
  };

  it('requests the floor of an SDK call by its call id', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.requestFloor(); });
    expect(mockSdk.requestFloor).toHaveBeenCalledWith('call-1');
  });

  it('leaves the floor state to the server instead of granting it locally', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.requestFloor(); });
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');

    fire(floor, { callId: 'call-1', ownerId: '', status: 'GRANTED', queuePosition: 0 });
    expect(screen.getByTestId('floor')).toHaveTextContent('granted');
  });

  it('does not request the floor before the call is active', () => {
    renderProbe();
    fire(incoming, callInfo());
    act(() => { ctx.requestFloor(); });
    expect(mockSdk.requestFloor).not.toHaveBeenCalled();
  });

  it('releases even while the request is still pending', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.requestFloor(); });
    act(() => { ctx.releaseFloor(); });
    expect(mockSdk.releaseFloor).toHaveBeenCalledWith('call-1');
  });

  it('sets the floor locally for a simulated call without touching the SDK', () => {
    renderProbe();
    activeLocalCall();

    act(() => { ctx.requestFloor(); });
    expect(screen.getByTestId('floor')).toHaveTextContent('granted');
    act(() => { ctx.releaseFloor(); });
    expect(screen.getByTestId('floor')).toHaveTextContent('idle');

    expect(mockSdk.requestFloor).not.toHaveBeenCalled();
    expect(mockSdk.releaseFloor).not.toHaveBeenCalled();
  });

  // A queued request's turn: the server waits for us to ask again (T132).
  it('asks again on GRANT_PENDING while the user still wants the floor', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.requestFloor(); });
    fire(floor, { callId: 'call-1', ownerId: '', status: 'QUEUED', queuePosition: 1 });
    fire(floor, { callId: 'call-1', ownerId: '', status: 'GRANT_PENDING', queuePosition: 0 });
    expect(mockSdk.requestFloor).toHaveBeenCalledTimes(2);
  });

  it('lets a GRANT_PENDING lapse once the user has let go', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.requestFloor(); });
    act(() => { ctx.releaseFloor(); });
    fire(floor, { callId: 'call-1', ownerId: '', status: 'GRANT_PENDING', queuePosition: 0 });
    expect(mockSdk.requestFloor).toHaveBeenCalledTimes(1);
  });

  it('ignores a GRANT_PENDING for another call', () => {
    renderProbe();
    activeSdkCall();
    act(() => { ctx.requestFloor(); });
    fire(floor, { callId: 'other-call', ownerId: '', status: 'GRANT_PENDING', queuePosition: 0 });
    expect(mockSdk.requestFloor).toHaveBeenCalledTimes(1);
  });

  it('does not grant a simulated floor that someone else holds', () => {
    renderProbe();
    activeLocalCall();
    act(() => { ctx.simulateFloorBusy(); });
    act(() => { ctx.requestFloor(); });
    expect(screen.getByTestId('floor')).toHaveTextContent('busy');
  });
});
