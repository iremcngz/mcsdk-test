/**
 * __tests__/group-video-send.test.tsx
 *
 * useGroupVideoSend: what the transmit view and its record button do to the SDK and
 * to the camera. The group's MCVideo call runs alongside its MCPTT one.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  SEND_NOTICE_MS,
  useGroupVideoReceive,
  useGroupVideoSend,
  type GroupVideoSend,
} from '../src/features/talk/useGroupVideoSend';

type Handler = (e: any) => void;

const handlers: Record<string, Handler[]> = {};
const sub = (name: string) => (h: Handler) => {
  (handlers[name] ??= []).push(h);
  return { remove: () => { handlers[name] = handlers[name].filter(x => x !== h); } };
};
const fire = (name: string, e: unknown) => act(() => { (handlers[name] ?? []).forEach(h => h(e)); });

const mockSdk = {
  onIncomingCall: sub('incoming'),
  onCallUpdated: sub('updated'),
  onCallTerminated: sub('terminated'),
  onTransmissionUpdated: sub('transmission'),
  onReceptionUpdated: sub('reception'),
  startVideoGroupCall: jest.fn(),
  requestTransmission: jest.fn(),
  endTransmission: jest.fn(),
  receiveMedia: jest.fn(),
  terminateCall: jest.fn(),
};

const mockStartCamera = jest.fn(() => Promise.resolve(true));
const mockStopCamera = jest.fn(() => Promise.resolve());
const mockSetTarget = jest.fn();
const mockStartReceive = jest.fn(() => Promise.resolve(true));
const mockStopReceive = jest.fn(() => Promise.resolve());
const mockSetSource = jest.fn();
jest.mock('../src/core/videoSession', () => ({
  VideoSession: {
    startCallCamera: () => mockStartCamera(),
    stopCallCamera: () => mockStopCamera(),
    setCallTarget: (id: string | null) => mockSetTarget(id),
    startCallReceive: () => mockStartReceive(),
    stopReceive: () => mockStopReceive(),
    setCallReceiveSource: (id: string | null) => mockSetSource(id),
  },
}));

let mockPermission = 'granted';
jest.mock('../src/core/permissions', () => ({
  ensureCameraPermission: () => Promise.resolve(mockPermission),
}));

const GROUP = 'sip:group1@example.org';

let mockHints = { known: new Set<string>(), candidates: [] as (string | null)[] };

let send: GroupVideoSend;

function Probe({ groupId }: { groupId: string | null }) {
  send = useGroupVideoSend({
    sdkRef: { current: mockSdk as any },
    created: true,
    groupId,
    groupHintsRef: { current: mockHints },
  });
  return null;
}

const videoCall = (over: object = {}) => ({
  callId: 'v1', type: 'GROUP', state: 'ACTIVE', outgoing: true, groupId: GROUP,
  isVideo: true, isFloorControlEnabled: true, ...over,
});

const open = async () => {
  const view = render(<Probe groupId={GROUP} />);
  await waitFor(() => expect(mockStartCamera).toHaveBeenCalled());
  await act(async () => {});
  return view;
};

/** The record button. */
const rec = () => act(() => send.startSending());
const stop = () => act(() => send.stopSending());

/** The view open and the record button pressed. */
const recording = async () => {
  const view = await open();
  rec();
  return view;
};

/** A view opening on a call already there. */
const openOnExistingCall = async (view: ReturnType<typeof render>) => {
  view.rerender(<Probe groupId={GROUP} />);
  await waitFor(() => expect(mockStartCamera).toHaveBeenCalled());
  await act(async () => {});
};

beforeEach(() => {
  Object.keys(handlers).forEach(k => delete handlers[k]);
  jest.clearAllMocks();
  mockPermission = 'granted';
  mockHints = { known: new Set(), candidates: [] };
});

describe('useGroupVideoSend', () => {
  it('does nothing while the view is closed', () => {
    render(<Probe groupId={null} />);
    expect(mockSdk.startVideoGroupCall).not.toHaveBeenCalled();
    expect(mockStartCamera).not.toHaveBeenCalled();
  });

  it('only starts the camera when the view opens', async () => {
    await open();
    expect(mockStartCamera).toHaveBeenCalled();
    expect(mockSdk.startVideoGroupCall).not.toHaveBeenCalled();
    expect(mockSdk.requestTransmission).not.toHaveBeenCalled();
    expect(send.requested).toBe(false);
    expect(send.sending).toBe(false);
  });

  it('places the call when the record button is pressed', async () => {
    await recording();
    expect(mockSdk.startVideoGroupCall).toHaveBeenCalledWith(GROUP);
    expect(send.requested).toBe(true);
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);
  });

  it('asks to send once the call is up, and sends only when granted', async () => {
    await recording();
    fire('updated', videoCall({ state: 'CALLING' }));
    expect(mockSdk.requestTransmission).not.toHaveBeenCalled();

    fire('updated', videoCall());
    expect(mockSdk.requestTransmission).toHaveBeenCalledWith('v1');
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);

    fire('transmission', { callId: 'v1', status: 'QUEUED' });
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);
    expect(send.sending).toBe(false);

    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    expect(mockSetTarget).toHaveBeenLastCalledWith('v1');
    expect(send.sending).toBe(true);
  });

  it('stops sending when permission goes, the camera staying on', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    fire('transmission', { callId: 'v1', status: 'REVOKED' });
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);
    expect(mockStopCamera).not.toHaveBeenCalled();
  });

  it('sends at once on a call with no transmission control', async () => {
    await recording();
    fire('updated', videoCall({ isFloorControlEnabled: false }));
    expect(mockSdk.requestTransmission).not.toHaveBeenCalled();
    expect(mockSetTarget).toHaveBeenLastCalledWith('v1');
  });

  it('does not send on a call already up until the button is pressed', async () => {
    const view = render(<Probe groupId={null} />);
    fire('incoming', videoCall({ outgoing: false, isFloorControlEnabled: false }));
    await openOnExistingCall(view);
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);

    rec();
    expect(mockSetTarget).toHaveBeenLastCalledWith('v1');
  });

  it('ignores the group\'s MCPTT call', async () => {
    await recording();
    fire('updated', videoCall({ callId: 'a1', isVideo: false }));
    expect(mockSdk.requestTransmission).not.toHaveBeenCalled();
  });

  it('uses the group\'s existing video call rather than placing another', async () => {
    const view = render(<Probe groupId={null} />);
    fire('incoming', videoCall({ outgoing: false }));
    await openOnExistingCall(view);
    expect(mockSdk.requestTransmission).not.toHaveBeenCalled();

    rec();
    expect(mockSdk.startVideoGroupCall).not.toHaveBeenCalled();
    expect(mockSdk.requestTransmission).toHaveBeenCalledWith('v1');
  });

  // An incoming call names who started it, not the group: see incomingCallGroup.
  it('finds the group\'s existing call though it names the caller', async () => {
    mockHints = { known: new Set([GROUP]), candidates: [GROUP] };
    const view = render(<Probe groupId={null} />);
    fire('incoming', videoCall({ outgoing: false, groupId: 'sip:mcvideo.mcuser-111@example.org' }));
    await openOnExistingCall(view);

    rec();
    expect(mockSdk.startVideoGroupCall).not.toHaveBeenCalled();
    expect(mockSdk.requestTransmission).toHaveBeenCalledWith('v1');
  });

  it('leaves a call it placed when the view closes', async () => {
    const view = await recording();
    fire('updated', videoCall());
    view.rerender(<Probe groupId={null} />);
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('v1');
    expect(mockStopCamera).toHaveBeenCalled();
  });

  it('only ends its transmission on a call somebody else started', async () => {
    const view = render(<Probe groupId={null} />);
    fire('incoming', videoCall({ outgoing: false }));
    await openOnExistingCall(view);
    rec();

    view.rerender(<Probe groupId={null} />);
    expect(mockSdk.endTransmission).toHaveBeenCalledWith('v1');
    expect(mockSdk.terminateCall).not.toHaveBeenCalled();
  });

  // The view can close before the SDK has named the call.
  it('leaves a call whose id arrives after the view closed', async () => {
    const view = await recording();
    view.rerender(<Probe groupId={null} />);
    fire('updated', videoCall({ state: 'CALLING' }));
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('v1');
  });

  it('leaves a call still coming up when the press is taken back', async () => {
    await recording();
    fire('updated', videoCall({ state: 'CALLING' }));
    stop();
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('v1');
    expect(mockStopCamera).not.toHaveBeenCalled();
  });

  it('does not place a failed call again by itself', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await recording();
    fire('updated', videoCall({ state: 'CALLING' }));
    fire('terminated', { callId: 'v1', mode: 'CLOSED_REMOTELY', reason: 'UNKNOWN' });
    expect(mockSdk.startVideoGroupCall).toHaveBeenCalledTimes(1);
    expect(send.requested).toBe(false);
    expect(send.notice).toBe('FAILED');
    warn.mockRestore();
  });

  it('keeps the call and ends only the transmission when the user stops', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });

    stop();
    expect(mockSdk.endTransmission).toHaveBeenCalledWith('v1');
    expect(mockSdk.terminateCall).not.toHaveBeenCalled();
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);
    expect(send.sending).toBe(false);

    fire('transmission', { callId: 'v1', status: 'ENDING' });
    fire('transmission', { callId: 'v1', status: 'ENDED' });
    expect(send.notice).toBeNull();
  });

  // What the server sent when its 30 seconds ran out, read from a phone's log.
  const timeUp = () => {
    fire('transmission', { callId: 'v1', status: 'REVOKED', revokeReason: 'MEDIA_BURST_TOO_LONG' });
    fire('transmission', { callId: 'v1', status: 'ENDING', revokeReason: 'MEDIA_BURST_TOO_LONG' });
    fire('transmission', { callId: 'v1', status: 'ENDED', revokeReason: 'MEDIA_BURST_TOO_LONG' });
  };

  it('goes back to standby and says so when the time is up', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    expect(send.sending).toBe(true);

    timeUp();
    expect(send.sending).toBe(false);
    expect(send.requested).toBe(false);
    expect(send.notice).toBe('TIME_UP');
    expect(mockSetTarget).toHaveBeenLastCalledWith(null);
    expect(mockStopCamera).not.toHaveBeenCalled();
    expect(mockSdk.terminateCall).not.toHaveBeenCalled();
  });

  it('sends again on the same call after the time is up', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    timeUp();
    mockSdk.requestTransmission.mockClear();

    rec();
    expect(send.notice).toBeNull();
    expect(mockSdk.startVideoGroupCall).toHaveBeenCalledTimes(1);
    expect(mockSdk.requestTransmission).toHaveBeenCalledWith('v1');
  });

  it('does not take a press while the last transmission is still ending', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    fire('transmission', { callId: 'v1', status: 'REVOKED', revokeReason: 'MEDIA_BURST_TOO_LONG' });
    fire('transmission', { callId: 'v1', status: 'ENDING', revokeReason: 'MEDIA_BURST_TOO_LONG' });

    rec();
    expect(send.requested).toBe(false);
  });

  it('takes the notice down by itself', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    jest.useFakeTimers();
    try {
      timeUp();
      expect(send.notice).toBe('TIME_UP');
      act(() => { jest.advanceTimersByTime(SEND_NOTICE_MS); });
      expect(send.notice).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    [{ status: 'REVOKED', revokeReason: 'NO_PERMISSION' }, 'ENDED'],
    [{ status: 'ENDED_BY_SERVER', revokeReason: 'UNKNOWN' }, 'ENDED'],
    [{ status: 'ENDED_BY_SERVER', revokeReason: 'MEDIA_BURST_TOO_LONG' }, 'TIME_UP'],
    [{ status: 'REJECTED', revokeReason: 'UNKNOWN' }, 'FAILED'],
    [{ status: 'REQUEST_TIMEOUT', revokeReason: 'UNKNOWN' }, 'FAILED'],
    [{ status: 'QUEUE_TIMEOUT', revokeReason: 'UNKNOWN' }, 'FAILED'],
    [{ status: 'QUEUE_CANCELLED', revokeReason: 'UNKNOWN' }, 'FAILED'],
  ])('goes back to standby on %j', async (event, expected) => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', ...event });
    expect(send.requested).toBe(false);
    expect(send.notice).toBe(expected);
  });

  it('keeps waiting when a revoked transmission goes into the queue', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    fire('transmission', { callId: 'v1', status: 'REVOKED', revokeReason: 'QUEUE_TRANSMISSION' });
    expect(send.requested).toBe(true);
    expect(send.notice).toBeNull();
    expect(send.sending).toBe(false);
  });

  it('says so when the call drops during a transmission', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    fire('terminated', { callId: 'v1', mode: 'CLOSED_REMOTELY', reason: 'UNKNOWN' });
    expect(send.requested).toBe(false);
    expect(send.notice).toBe('ENDED');
  });

  it('says nothing about a call closing while on standby', async () => {
    await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    stop();
    fire('terminated', { callId: 'v1', mode: 'CLOSED_REMOTELY', reason: 'UNKNOWN' });
    expect(send.notice).toBeNull();
  });

  it('forgets the press and the notice when the view closes', async () => {
    const view = await recording();
    fire('updated', videoCall());
    fire('transmission', { callId: 'v1', status: 'GRANTED' });
    timeUp();
    view.rerender(<Probe groupId={null} />);
    expect(send.notice).toBeNull();
    expect(send.requested).toBe(false);
  });

  it('does not start the camera without permission', async () => {
    mockPermission = 'denied';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Probe groupId={GROUP} />);
    await act(async () => {});
    expect(mockStartCamera).not.toHaveBeenCalled();

    rec();
    expect(send.requested).toBe(false);
    expect(mockSdk.startVideoGroupCall).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('asks for a transmitter the server does not send by itself', async () => {
    render(<Probe groupId={null} />);
    fire('reception', { callId: 'v1', transmitterId: 'bob', status: 'AVAILABLE', automatic: false });
    expect(mockSdk.receiveMedia).toHaveBeenCalledWith('v1', 'bob');

    mockSdk.receiveMedia.mockClear();
    fire('reception', { callId: 'v1', transmitterId: 'bob', status: 'AVAILABLE', automatic: true });
    expect(mockSdk.receiveMedia).not.toHaveBeenCalled();
  });
});

describe('useGroupVideoReceive', () => {
  let ended = false;
  function Watcher({ watching, callId }: { watching: boolean; callId: string | null }) {
    ended = useGroupVideoReceive({ sdkRef: { current: mockSdk as any }, created: true, watching, callId });
    return null;
  }

  const reception = (status: string, transmitterId = 'alice', callId = 'v1') =>
    fire('reception', { callId, transmitterId, status, automatic: false });

  it('does nothing while the view is closed', () => {
    render(<Watcher watching={false} callId="v1" />);
    expect(mockStartReceive).not.toHaveBeenCalled();
  });

  it('shows the group\'s call, once the receiver is up', async () => {
    render(<Watcher watching callId="v1" />);
    await waitFor(() => expect(mockSetSource).toHaveBeenCalledWith('v1'));
  });

  // The view opens before anybody transmits; the SDK answers the call when they do.
  it('waits with no call, and takes it when it comes', async () => {
    const view = render(<Watcher watching callId={null} />);
    await waitFor(() => expect(mockSetSource).toHaveBeenLastCalledWith(null));
    view.rerender(<Watcher watching callId="v1" />);
    expect(mockSetSource).toHaveBeenLastCalledWith('v1');
    expect(mockStartReceive).toHaveBeenCalledTimes(1);
  });

  it('stops the receiver when the view closes', async () => {
    const view = render(<Watcher watching callId="v1" />);
    await waitFor(() => expect(mockSetSource).toHaveBeenCalled());
    view.rerender(<Watcher watching={false} callId="v1" />);
    expect(mockStopReceive).toHaveBeenCalled();
  });

  it('says so when the server ends the transmission being watched', async () => {
    render(<Watcher watching callId="v1" />);
    await act(async () => {});
    reception('RECEIVING');
    expect(ended).toBe(false);
    reception('TRANSMISSION_ENDED');
    expect(ended).toBe(true);
  });

  it('counts a transmitter that started before the view opened', async () => {
    const view = render(<Watcher watching={false} callId="v1" />);
    reception('RECEIVING', 'alice');
    reception('RECEIVING', 'bob');
    view.rerender(<Watcher watching callId="v1" />);
    await act(async () => {});
    reception('TRANSMISSION_ENDED', 'alice');
    expect(ended).toBe(false);
  });

  it('holds on while another transmitter is still sending', async () => {
    render(<Watcher watching callId="v1" />);
    await act(async () => {});
    reception('RECEIVING', 'alice');
    reception('RECEIVING', 'bob');
    reception('TRANSMISSION_ENDED', 'alice');
    expect(ended).toBe(false);
    reception('TRANSMISSION_ENDED', 'bob');
    expect(ended).toBe(true);
  });

  it('takes it back when somebody else starts', async () => {
    render(<Watcher watching callId="v1" />);
    await act(async () => {});
    reception('TRANSMISSION_ENDED');
    expect(ended).toBe(true);
    reception('AVAILABLE', 'bob');
    expect(ended).toBe(false);
  });

  it('ignores the end of a transmission on another call', async () => {
    render(<Watcher watching callId="v1" />);
    await act(async () => {});
    reception('TRANSMISSION_ENDED', 'alice', 'other');
    expect(ended).toBe(false);
  });

  it('ignores an end with the view closed, and forgets one when it closes', async () => {
    const view = render(<Watcher watching={false} callId="v1" />);
    reception('TRANSMISSION_ENDED');
    expect(ended).toBe(false);

    view.rerender(<Watcher watching callId="v1" />);
    await act(async () => {});
    reception('TRANSMISSION_ENDED');
    expect(ended).toBe(true);
    view.rerender(<Watcher watching={false} callId="v1" />);
    expect(ended).toBe(false);
  });
});
