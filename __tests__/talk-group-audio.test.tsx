/**
 * __tests__/talk-group-audio.test.tsx
 *
 * A group call's audio: which call is heard, the uplink gate following PTT and
 * the floor, the group's mute, the loudspeaker, and yielding to a private call.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

type Handler = (e: any) => void;
const listeners = {
  incoming: new Set<Handler>(), updated: new Set<Handler>(), terminated: new Set<Handler>(),
  floor: new Set<Handler>(), error: new Set<Handler>(),
};
const sub = (set: Set<Handler>) => (h: Handler) => { set.add(h); return { remove: () => set.delete(h) }; };

const mockSdk = {
  affiliate: jest.fn(),
  deaffiliate: jest.fn(),
  onGroupsUpdated: () => ({ remove: () => {} }),
  onAffiliationsUpdated: () => ({ remove: () => {} }),
  onIdentityUpdated: () => ({ remove: () => {} }),
  onIncomingCall: sub(listeners.incoming),
  onCallUpdated: sub(listeners.updated),
  onCallTerminated: sub(listeners.terminated),
  onFloorUpdated: sub(listeners.floor),
  onSdkError: sub(listeners.error),
  startGroupCall: jest.fn(),
  terminateCall: jest.fn(),
  requestFloor: jest.fn(),
  releaseFloor: jest.fn(),
};

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
}));

// Only what TalkContext reads from it: whether a private call has the audio.
const mockPrivate = { audioCallId: null as string | null };
jest.mock('../src/contexts/CallContext', () => ({
  useCallContextIfPresent: () => mockPrivate,
}));

const mockMedia = {
  startCallAudio: jest.fn(async (_id: string) => true),
  stopCallAudio: jest.fn(async (_id?: string) => {}),
  setTransmitEnabled: jest.fn(),
  setPlaybackMuted: jest.fn(),
  setRoute: jest.fn(),
};
// A getter: the imports below are hoisted above this file's consts.
jest.mock('../src/core/mediaSession', () => ({
  get MediaSession() { return mockMedia; },
}));

let mockMicPermission = 'granted';
jest.mock('../src/core/permissions', () => ({
  ensureMicPermission: jest.fn(async () => mockMicPermission),
}));

import { TalkContextProvider, useTalkContext } from '../src/contexts/TalkContext';

let ctx: ReturnType<typeof useTalkContext>;
function Probe() {
  ctx = useTalkContext();
  return null;
}

const fire = (set: Set<Handler>, e: any) => act(() => { set.forEach(h => h(e)); });
/** Lets the audio start's awaits run. */
const settle = () => act(async () => {});

const G1 = 'sip:group.one@x';
const G2 = 'sip:group.two@x';

function callUp(groupId: string, callId: string) {
  fire(listeners.updated, {
    callId, type: 'GROUP', state: 'ACTIVE', outgoing: false, isEmergency: false,
    isImminentPeril: false, callerId: '', calleeId: '', groupId,
  });
}

function floor(callId: string, status: string) {
  fire(listeners.floor, {
    callId, ownerId: '', status, queuePosition: 0,
    denyReason: 'UNKNOWN', revokeReason: 'UNKNOWN', talkers: [],
  });
}

let view: ReturnType<typeof render>;
const tree = () => <TalkContextProvider><Probe /></TalkContextProvider>;

beforeEach(() => {
  Object.values(listeners).forEach(s => s.clear());
  jest.clearAllMocks();
  mockPrivate.audioCallId = null;
  mockMicPermission = 'granted';
  view = render(tree());
});

describe('group call audio', () => {
  it('runs a group call\'s audio on the loudspeaker once it is up', async () => {
    callUp(G1, 'c1');
    await settle();
    expect(mockMedia.startCallAudio).toHaveBeenCalledWith('c1');
    expect(mockMedia.setRoute).toHaveBeenCalledWith('SPEAKER');
    expect(ctx.audioGroupId).toBe(G1);
  });

  it('starts with the uplink closed', async () => {
    callUp(G1, 'c1');
    await settle();
    expect(mockMedia.setTransmitEnabled).toHaveBeenLastCalledWith(false);
  });

  it('has no audio while the call is being set up', async () => {
    act(() => ctx.startGroupCall(G1));
    await settle();
    expect(mockMedia.startCallAudio).not.toHaveBeenCalled();
  });

  it('stops that call\'s audio when it ends, and puts the earpiece back', async () => {
    callUp(G1, 'c1');
    await settle();
    fire(listeners.terminated, { callId: 'c1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL', sipCode: 0, sipReason: '' });
    expect(mockMedia.stopCallAudio).toHaveBeenCalledWith('c1');
    expect(mockMedia.setRoute).toHaveBeenLastCalledWith('EARPIECE');
  });

  // ── The uplink gate ──────────────────────────────────────────────────────

  it('opens the uplink only once the floor is granted to a held PTT', async () => {
    callUp(G1, 'c1');
    await settle();
    act(() => ctx.requestGroupFloor(G1));
    expect(mockMedia.setTransmitEnabled).not.toHaveBeenCalledWith(true);
    floor('c1', 'GRANTED');
    expect(mockMedia.setTransmitEnabled).toHaveBeenLastCalledWith(true);
  });

  // The floor reads granted until the server's IDLE; nothing may go out then.
  it('closes the uplink on letting go, before the server confirms', async () => {
    callUp(G1, 'c1');
    await settle();
    act(() => ctx.requestGroupFloor(G1));
    floor('c1', 'GRANTED');
    act(() => ctx.releaseGroupFloor(G1));
    expect(mockMedia.setTransmitEnabled).toHaveBeenLastCalledWith(false);
  });

  it('closes the uplink when the floor is revoked under a held PTT', async () => {
    callUp(G1, 'c1');
    await settle();
    act(() => ctx.requestGroupFloor(G1));
    floor('c1', 'GRANTED');
    floor('c1', 'REVOKED');
    expect(mockMedia.setTransmitEnabled).toHaveBeenLastCalledWith(false);
  });

  it('opens the uplink at start when the floor was granted while starting', async () => {
    callUp(G1, 'c1');
    act(() => ctx.requestGroupFloor(G1));
    floor('c1', 'GRANTED');
    await settle();
    expect(mockMedia.setTransmitEnabled).toHaveBeenLastCalledWith(true);
  });

  // ── Which call is heard ──────────────────────────────────────────────────

  it('hears the group on screen over a later call elsewhere', async () => {
    act(() => ctx.setFocusedGroup(G1));
    callUp(G1, 'c1');
    callUp(G2, 'c2');
    await settle();
    expect(ctx.audioGroupId).toBe(G1);
    expect(mockMedia.startCallAudio).not.toHaveBeenCalledWith('c2');
  });

  it('hears the latest call when the group on screen has none', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    act(() => ctx.setFocusedGroup('sip:group.quiet@x'));
    callUp(G1, 'c1');
    callUp(G2, 'c2');
    await settle();
    expect(ctx.audioGroupId).toBe(G2);
    jest.restoreAllMocks();
  });

  it('moves the audio when the screen switches to another group\'s call', async () => {
    act(() => ctx.setFocusedGroup(G1));
    callUp(G1, 'c1');
    callUp(G2, 'c2');
    await settle();
    act(() => ctx.setFocusedGroup(G2));
    await settle();
    expect(mockMedia.stopCallAudio).toHaveBeenCalledWith('c1');
    expect(mockMedia.startCallAudio).toHaveBeenLastCalledWith('c2');
  });

  // ── A private call ───────────────────────────────────────────────────────

  it('yields the audio to a private call, and takes it back after', async () => {
    callUp(G1, 'c1');
    await settle();

    mockPrivate.audioCallId = 'p1';
    view.rerender(tree());
    await settle();
    expect(mockMedia.stopCallAudio).toHaveBeenCalledWith('c1');
    expect(ctx.audioGroupId).toBeNull();

    mockPrivate.audioCallId = null;
    view.rerender(tree());
    await settle();
    expect(mockMedia.startCallAudio).toHaveBeenLastCalledWith('c1');
  });

  // A stop that lands after another call took the pipeline must spare it.
  it('stops a start still in flight by its own call id', async () => {
    let finish!: (ok: boolean) => void;
    mockMedia.startCallAudio.mockImplementationOnce(() => new Promise<boolean>(r => { finish = r; }));
    callUp(G1, 'c1');
    await settle();

    mockPrivate.audioCallId = 'p1';
    view.rerender(tree());
    await act(async () => { finish(true); });
    expect(mockMedia.stopCallAudio.mock.calls.every(([id]) => id === 'c1')).toBe(true);
    expect(mockMedia.setTransmitEnabled).not.toHaveBeenCalled();
  });

  // ── Mute ────────────────────────────────────────────────────────────────

  it('silences the group\'s received audio and brings it back', async () => {
    callUp(G1, 'c1');
    await settle();
    act(() => ctx.toggleGroupMuted(G1));
    expect(mockMedia.setPlaybackMuted).toHaveBeenLastCalledWith(true);
    expect(ctx.mutedGroups[G1]).toBe(true);
    act(() => ctx.toggleGroupMuted(G1));
    expect(mockMedia.setPlaybackMuted).toHaveBeenLastCalledWith(false);
  });

  it('starts a muted group\'s audio silenced', async () => {
    act(() => ctx.toggleGroupMuted(G1));
    callUp(G1, 'c1');
    await settle();
    expect(mockMedia.setPlaybackMuted).toHaveBeenCalledWith(true);
  });

  it('leaves another group\'s audio alone when one is muted', async () => {
    callUp(G1, 'c1');
    await settle();
    act(() => ctx.toggleGroupMuted(G2));
    expect(mockMedia.setPlaybackMuted).not.toHaveBeenCalled();
  });

  // ── Problems ────────────────────────────────────────────────────────────

  it('says so on the call when the microphone is refused', async () => {
    mockMicPermission = 'denied';
    callUp(G1, 'c1');
    await settle();
    expect(mockMedia.startCallAudio).not.toHaveBeenCalled();
    expect(ctx.sdkGroupCalls[G1].floorNotice).toBe('AUDIO:MIC_DENIED');
  });

  it('puts an SDK audio error on the call being heard', async () => {
    callUp(G1, 'c1');
    await settle();
    fire(listeners.error, { error: 'AUDIO_CODEC_UNSUPPORTED' });
    expect(ctx.sdkGroupCalls[G1].floorNotice).toBe('AUDIO:AUDIO_CODEC_UNSUPPORTED');
  });
});
