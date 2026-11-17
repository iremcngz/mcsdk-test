/**
 * __tests__/talk-group-calls.test.tsx
 *
 * TalkContext keeping the SDK's group calls: one per group, the floor read the
 * same way as on a private call, private calls left to CallContext.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

type Handler<T> = (e: T) => void;

const incoming: Handler<any>[] = [];
const updated: Handler<any>[] = [];
const terminated: Handler<any>[] = [];
const floor: Handler<any>[] = [];
const sdkError: Handler<any>[] = [];
const groupsHandlers: Handler<any>[] = [];
const reception: Handler<any>[] = [];
const affiliationHandlers: Handler<any>[] = [];

const sub = (list: Handler<any>[]) => (h: Handler<any>) => {
  list.push(h);
  return { remove: () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); } };
};

const mockSdk = {
  affiliate: jest.fn(),
  deaffiliate: jest.fn(),
  onGroupsUpdated: sub(groupsHandlers),
  onAffiliationsUpdated: sub(affiliationHandlers),
  onIdentityUpdated: () => ({ remove: () => {} }),
  onIncomingCall: sub(incoming),
  onCallUpdated: sub(updated),
  onCallTerminated: sub(terminated),
  onFloorUpdated: sub(floor),
  onTransmissionUpdated: sub([]),
  onReceptionUpdated: sub(reception),
  receiveMedia: jest.fn(),
  onSdkError: sub(sdkError),
  startGroupCall: jest.fn(),
  terminateCall: jest.fn(),
  requestFloor: jest.fn(),
  releaseFloor: jest.fn(),
};

jest.mock('../src/contexts/SdkContext', () => ({
  useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }),
}));

import {
  GROUP_CALL_START_TIMEOUT_MS,
  RECEIVE_ENDED_NOTICE_MS,
  TalkContextProvider,
  useTalkContext,
} from '../src/contexts/TalkContext';

const G2 = 'sip:group.prearranged@ims.mnc001.mcc001.3gppnetwork.org';

let ctx: ReturnType<typeof useTalkContext>;
function Probe() {
  ctx = useTalkContext();
  return null;
}

const fire = (list: Handler<any>[], e: any) => act(() => { list.forEach(h => h(e)); });

const groupCall = (over: Partial<any> = {}) => ({
  callId: 'grp-1',
  type: 'GROUP',
  state: 'INCOMING',
  outgoing: false,
  isEmergency: false,
  isImminentPeril: false,
  callerId: '',
  calleeId: '',
  groupId: G2,
  ...over,
});

const floorEvent = (over: Partial<any> = {}) => ({
  callId: 'grp-1', ownerId: '', status: 'IDLE', queuePosition: 0,
  denyReason: 'UNKNOWN', revokeReason: 'UNKNOWN', talkers: [], ...over,
});

beforeEach(() => {
  incoming.length = 0; updated.length = 0; terminated.length = 0; floor.length = 0;
  sdkError.length = 0;
  groupsHandlers.length = 0; affiliationHandlers.length = 0; reception.length = 0;
  jest.clearAllMocks();
  render(<TalkContextProvider><Probe /></TalkContextProvider>);
});

describe('TalkContext — SDK group calls', () => {
  it('has none before the SDK reports one', () => {
    expect(ctx.sdkGroupCalls).toEqual({});
  });

  // The SDK answers an incoming group call itself: no ringing, it comes up.
  it('records a group call another member started, under its group', () => {
    fire(incoming, groupCall());
    fire(updated, groupCall({ state: 'ACTIVE' }));

    const c = ctx.sdkGroupCalls[G2];
    expect(c.sdkCallId).toBe('grp-1');
    expect(c.state).toBe('active');
    expect(c.startedBy).toBe('others');
    expect(c.floorState).toBe('idle');
  });

  it('records a group call we placed as ours', () => {
    fire(updated, groupCall({ state: 'CALLING', outgoing: true }));
    expect(ctx.sdkGroupCalls[G2].state).toBe('connecting');
    expect(ctx.sdkGroupCalls[G2].startedBy).toBe('me');
  });

  // Private calls are CallContext's.
  it('ignores private calls', () => {
    fire(incoming, groupCall({ type: 'PRIVATE', groupId: '', callerId: 'sip:mcuser-222@x' }));
    expect(ctx.sdkGroupCalls).toEqual({});
  });

  it('drops the call when it terminates', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(terminated, { callId: 'grp-1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL', sipCode: 200, sipReason: '' });
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  it('ignores the termination of a call it does not hold', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(terminated, { callId: 'private-1', mode: 'CLOSED_REMOTELY', reason: 'NORMAL', sipCode: 200, sipReason: '' });
    expect(ctx.sdkGroupCalls[G2]).toBeDefined();
  });

  it('reads the floor as a private call does, with the talker', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(floor, floorEvent({ status: 'TAKEN', ownerId: 'sip:mcptt.mcuser-222@x',
                             talkers: [{ id: 'sip:mcptt.mcuser-222@x', ssrc: 7 }] }));

    const c = ctx.sdkGroupCalls[G2];
    expect(c.floorState).toBe('busy');
    expect(c.floorOwner).toBe('sip:mcptt.mcuser-222@x');
    expect(c.talkers).toEqual(['sip:mcptt.mcuser-222@x']);
  });

  it('shows our own grant, and keeps a deny reason through the IDLE after it', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(floor, floorEvent({ status: 'GRANTED' }));
    expect(ctx.sdkGroupCalls[G2].floorState).toBe('granted');

    fire(floor, floorEvent({ status: 'DENIED', denyReason: 'ANOTHER_CLIENT_HAS_PERMISSION' }));
    fire(floor, floorEvent({ status: 'IDLE' }));
    expect(ctx.sdkGroupCalls[G2].floorNotice).toBe('DENIED:ANOTHER_CLIENT_HAS_PERMISSION');
  });

  it('ignores floor updates for a call it does not hold', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(floor, floorEvent({ callId: 'private-1', status: 'TAKEN', ownerId: 'x' }));
    expect(ctx.sdkGroupCalls[G2].floorState).toBe('idle');
  });

  // A new call id for the same group is a new call: the old floor must not leak in.
  it('starts a new call for the group afresh', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(floor, floorEvent({ status: 'TAKEN', ownerId: 'x' }));
    fire(updated, groupCall({ callId: 'grp-2', state: 'ACTIVE' }));

    const c = ctx.sdkGroupCalls[G2];
    expect(c.sdkCallId).toBe('grp-2');
    expect(c.floorState).toBe('idle');
    expect(c.floorOwner).toBeUndefined();
  });

  it('keeps calls of different groups apart', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(updated, groupCall({ callId: 'grp-9', groupId: 'sip:group.other@x', state: 'ACTIVE' }));
    expect(Object.keys(ctx.sdkGroupCalls).sort()).toEqual([G2, 'sip:group.other@x'].sort());
  });
});

/**
 * An incoming group call's own group.
 *
 * The SDK reads it off <mcptt-calling-group-id> (CallModule → ParseCallingGroupId →
 * CallMachine::OnInviteReceived), so the event names the group and the app places the
 * call on it directly. It used to arrive as the *calling user* instead, and the app
 * guessed the group from the one on screen and the affiliated list; that guess, and
 * the tests for it, are gone.
 */
describe('TalkContext — where an incoming group call is placed', () => {
  const G3 = 'sip:group.other@ims.mnc001.mcc001.3gppnetwork.org';
  const group = (groupId: string) => ({ groupId, name: groupId, isPtt: true, isVideo: true, isData: false });

  const withGroups = (...ids: string[]) => {
    const groups = ids.map(group);
    act(() => { groupsHandlers.forEach(h => h({ groups })); });
    act(() => { affiliationHandlers.forEach(h => h({ groups })); });
  };

  it('goes under the group the SDK names, not the one on screen', () => {
    withGroups(G2, G3);
    act(() => ctx.setFocusedGroup(G2));
    fire(incoming, groupCall({ groupId: G3 }));
    expect(ctx.sdkGroupCalls[G3].sdkCallId).toBe('grp-1');
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  // No list is consulted any more, so a call arriving before the groups do lands right.
  it('places it before the SDK has reported any groups', () => {
    fire(incoming, groupCall({ groupId: G3 }));
    expect(ctx.sdkGroupCalls[G3].sdkCallId).toBe('grp-1');
  });

  // A group the user is not affiliated to is still the group the call is on; hiding it
  // under one of ours is what the guess used to do wrong.
  it('places it on a group of its own even when we have none like it', () => {
    withGroups(G2);
    fire(incoming, groupCall({ groupId: G3 }));
    expect(ctx.sdkGroupCalls[G3].sdkCallId).toBe('grp-1');
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  it('stays under its group when the screen moves on', () => {
    withGroups(G2, G3);
    fire(incoming, groupCall({ groupId: G3 }));
    act(() => ctx.setFocusedGroup(G2));
    fire(updated, groupCall({ groupId: G3, state: 'ACTIVE' }));

    expect(ctx.sdkGroupCalls[G3].state).toBe('active');
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  // Two calls on two groups: neither displaces the other, since neither is a guess.
  it('keeps an incoming call beside a call of our own on another group', () => {
    withGroups(G2, G3);
    fire(updated, groupCall({ callId: 'mine', state: 'ACTIVE', outgoing: true }));
    fire(incoming, groupCall({ groupId: G3 }));

    expect(ctx.sdkGroupCalls[G2].sdkCallId).toBe('mine');
    expect(ctx.sdkGroupCalls[G3].sdkCallId).toBe('grp-1');
  });

  // An invite whose body carried no <calling-group-id>: the SDK warns and leaves it
  // empty. Keyed on '' the call would sit under a group that does not exist.
  it('leaves out a call the SDK could not name a group for', () => {
    withGroups(G2);
    fire(incoming, groupCall({ groupId: '' }));
    expect(Object.keys(ctx.sdkGroupCalls)).toEqual([]);
  });

  it('leaves the MCVideo call beside the group\'s MCPTT one out of this', () => {
    withGroups(G2);
    fire(updated, groupCall({ state: 'ACTIVE' }));
    fire(incoming, groupCall({ callId: 'vid-1', groupId: G2, isVideo: true }));
    expect(ctx.sdkGroupCalls[G2].sdkCallId).toBe('grp-1');
  });
});

describe('TalkContext — the receive view when the transmission ends', () => {
  const videoCall = () => groupCall({ callId: 'vid-1', state: 'ACTIVE', isVideo: true });
  const ending = { callId: 'vid-1', transmitterId: 'alice', status: 'TRANSMISSION_ENDED', automatic: false };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const watching = () => {
    act(() => ctx.setFocusedGroup(G2));
    fire(updated, videoCall());
    act(() => ctx.setIsWatchingVideo(true));
  };

  it('goes back to Talk a moment after the server says it ended', () => {
    watching();
    fire(reception, ending);
    expect(ctx.videoTransmissionEnded).toBe(true);
    expect(ctx.isWatchingVideo).toBe(true);

    act(() => { jest.advanceTimersByTime(RECEIVE_ENDED_NOTICE_MS); });
    expect(ctx.isWatchingVideo).toBe(false);
    expect(ctx.videoTransmissionEnded).toBe(false);
  });

  it('stays if somebody else starts before it closes', () => {
    watching();
    fire(reception, ending);
    fire(reception, { ...ending, transmitterId: 'bob', status: 'AVAILABLE' });

    act(() => { jest.advanceTimersByTime(RECEIVE_ENDED_NOTICE_MS * 2); });
    expect(ctx.isWatchingVideo).toBe(true);
  });

  it('stays while nothing has ended', () => {
    watching();
    act(() => { jest.advanceTimersByTime(RECEIVE_ENDED_NOTICE_MS * 2); });
    expect(ctx.isWatchingVideo).toBe(true);
  });
});

describe('TalkContext — group call commands', () => {
  afterEach(() => { jest.useRealTimers(); });

  it('places the call with the AMR-WB framing and shows it connecting at once', () => {
    act(() => ctx.startGroupCall(G2));
    expect(mockSdk.startGroupCall).toHaveBeenCalledWith(G2, 'AMR_WB_OCTET_ALIGNED');
    expect(ctx.sdkGroupCalls[G2]).toMatchObject({ sdkCallId: '', state: 'connecting', startedBy: 'me' });
  });

  it('takes the SDK\'s call over the placeholder once it is reported', () => {
    act(() => ctx.startGroupCall(G2));
    fire(updated, groupCall({ state: 'CALLING', outgoing: true }));
    expect(ctx.sdkGroupCalls[G2].sdkCallId).toBe('grp-1');
  });

  it('does not place a second call for a group that has one', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    act(() => ctx.startGroupCall(G2));
    expect(mockSdk.startGroupCall).not.toHaveBeenCalled();
  });

  // Refused before a call existed: no event will ever name it.
  it('drops a call the SDK never reports', () => {
    jest.useFakeTimers();
    act(() => ctx.startGroupCall(G2));
    act(() => { jest.advanceTimersByTime(GROUP_CALL_START_TIMEOUT_MS); });
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  it('keeps a call that was reported before the timeout', () => {
    jest.useFakeTimers();
    act(() => ctx.startGroupCall(G2));
    fire(updated, groupCall({ state: 'CALLING', outgoing: true }));
    act(() => { jest.advanceTimersByTime(GROUP_CALL_START_TIMEOUT_MS); });
    expect(ctx.sdkGroupCalls[G2]).toBeDefined();
  });

  it('drops the placeholder at once on an SdkError that refuses the call', () => {
    act(() => ctx.startGroupCall(G2));
    fire(sdkError, { error: 'NOT_REGISTERED' });
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  it('leaves calls alone on other SdkErrors', () => {
    act(() => ctx.startGroupCall(G2));
    fire(sdkError, { error: 'FLOOR_SEND_FAILED' });
    expect(ctx.sdkGroupCalls[G2]).toBeDefined();
  });

  it('terminates the call on end and drops it at once', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    act(() => ctx.endGroupCall(G2));
    expect(mockSdk.terminateCall).toHaveBeenCalledWith('grp-1');
    expect(ctx.sdkGroupCalls[G2]).toBeUndefined();
  });

  it('requests and releases the floor on the group\'s call', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    act(() => ctx.requestGroupFloor(G2));
    expect(mockSdk.requestFloor).toHaveBeenCalledWith('grp-1');
    act(() => ctx.releaseGroupFloor(G2));
    expect(mockSdk.releaseFloor).toHaveBeenCalledWith('grp-1');
  });

  it('does not ask for the floor before the call is up', () => {
    fire(updated, groupCall({ state: 'CALLING', outgoing: true }));
    act(() => ctx.requestGroupFloor(G2));
    expect(mockSdk.requestFloor).not.toHaveBeenCalled();
  });

  // T132: a queued request's turn is only taken by asking again.
  it('asks again on GRANT_PENDING while the floor is still wanted', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    act(() => ctx.requestGroupFloor(G2));
    fire(floor, floorEvent({ status: 'GRANT_PENDING' }));
    expect(mockSdk.requestFloor).toHaveBeenCalledTimes(2);
  });

  it('lets GRANT_PENDING pass once PTT was let go', () => {
    fire(updated, groupCall({ state: 'ACTIVE' }));
    act(() => ctx.requestGroupFloor(G2));
    act(() => ctx.releaseGroupFloor(G2));
    fire(floor, floorEvent({ status: 'GRANT_PENDING' }));
    expect(mockSdk.requestFloor).toHaveBeenCalledTimes(1);
  });
});
