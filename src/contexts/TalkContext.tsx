import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CallInfoEvent,
  CallTerminatedEvent,
  FloorUpdatedEvent,
  McSdkAffiliateRequest,
  McSdkError,
  McSdkGroupInfo,
  SdkErrorEvent,
} from '../mcsdk';
import { useSdkContext } from './SdkContext';
import { useCallContextIfPresent } from './CallContext';
import { useCallAudio, type CallAudioProblem } from '../features/calls/useCallAudio';
import {
  isGroupVideoCall,
  useGroupVideoReceive,
  useGroupVideoSend,
  type VideoSendNotice,
  type VideoTransmitter,
} from '../features/talk/useGroupVideoSend';
import {
  CALL_AUDIO_CODEC,
  USER_FACING_AUDIO_ERRORS,
  floorFieldsAfter,
  isGroupCall,
  mapCallState,
  type FloorFields,
} from '../features/calls/sdkCall';
import type { CallState } from '../features/calls/types';

/** The MC services a group can be affiliated to. */
export type McService = 'ptt' | 'video' | 'data';

/** Services of one group, in the flag shape the SDK uses. */
export interface ServiceFlags {
  ptt:   boolean;
  video: boolean;
  data:  boolean;
}

export function serviceFlagsOf(g: McSdkGroupInfo): ServiceFlags {
  return { ptt: g.isPtt, video: g.isVideo, data: g.isData };
}

export function hasAnyService(f: ServiceFlags): boolean {
  return f.ptt || f.video || f.data;
}

export interface ActiveGroupInfo {
  name: string;
  callActive: boolean;
}

export type PushState = 'idle' | 'accepted' | 'occupied';

/**
 * A group call as the SDK reports it, one per group. Kept apart from
 * [GroupCallState], which is the Talk screen's own (still simulated) view of a
 * group, so neither overwrites the other while the screen moves onto this.
 */
export interface SdkGroupCall extends FloorFields {
  groupId: string;
  /** Empty while a call we started has not been given an id by the SDK yet. */
  sdkCallId: string;
  state: CallState;
  /** Whether we placed it, or joined one another member started. */
  startedBy: 'me' | 'others';
  /** Everyone talking now, as the floor reports them (URIs) — several in a multi-talker group. */
  talkers: string[];
  /** When it went active (Unix ms); when it was first seen before that. */
  startedAt: number;
}

export interface GroupCallState {
  callActive: boolean;
  pushState: PushState;
  isHolding: boolean;
}

interface TalkContextValue {
  /**
   * Groups the user MAY affiliate to (SdkListener::onGroupsUpdated). The service
   * flags here mean "this service supports the group".
   */
  groups: McSdkGroupInfo[];
  /**
   * Groups currently affiliated (SdkListener::onAffiliationsUpdated). The service
   * flags here mean "the affiliation covers this service".
   */
  affiliatedGroups: McSdkGroupInfo[];
  /** Affiliated services per group id — the editor's starting state. */
  affiliationByGroup: Record<string, ServiceFlags>;
  /**
   * Publishes the complete desired affiliation set. Mirrors Sdk::Affiliate, which
   * is state-REPLACING: pass every group that should end up affiliated, not a
   * delta. A request with no services selected is dropped; an empty result
   * de-affiliates everything via deaffiliate().
   */
  applyAffiliation: (requests: McSdkAffiliateRequest[]) => void;
  /** True once the SDK has delivered a group list (i.e. registration completed). */
  groupsLoaded: boolean;
  /** MC services the user is registered for (SdkListener::onIdentityUpdated). */
  identityServices: ServiceFlags;
  activeGroups: ActiveGroupInfo[];
  setActiveGroups: (groups: ActiveGroupInfo[]) => void;
  pendingGroup: string | null;
  setPendingGroup: (group: string | null) => void;
  groupCalls: Record<string, GroupCallState>;
  setGroupCalls: React.Dispatch<React.SetStateAction<Record<string, GroupCallState>>>;
  /** Append-only list of groups that ever became active (activation order). */
  activationOrder: string[];
  /** Timestamp of when each group was last closed. */
  lastClosedAt: Record<string, number>;
  recordActivation: (group: string) => void;
  recordClose: (group: string) => void;
  /**
   * Group calls the SDK has up, by group id. The SDK answers incoming group
   * calls itself, so a call appears here without the user doing anything.
   */
  sdkGroupCalls: Record<string, SdkGroupCall>;
  /**
   * Places a group call. It shows as connecting at once; if the SDK never
   * reports it (refused before a call existed), it is dropped again.
   */
  startGroupCall: (groupId: string) => void;
  /** Leaves the group's call. Others in the group stay in it. */
  endGroupCall: (groupId: string) => void;
  /**
   * Asks for the floor on the group's call. The floor shows as ours only once
   * the server grants it, via onFloorUpdated.
   */
  requestGroupFloor: (groupId: string) => void;
  /** Gives the floor back, or withdraws a request still waiting. */
  releaseGroupFloor: (groupId: string) => void;
  /**
   * The group the Talk screen shows. Its call is the one heard when it has
   * one; it is remembered when the screen is left.
   */
  setFocusedGroup: (groupId: string) => void;
  /**
   * The group whose call is heard (and spoken to), or null: the focused
   * group's call if it is up, else the latest group call to come up — none
   * while a private call has the audio. One pipeline, so one call at a time.
   */
  audioGroupId: string | null;
  /** Groups whose received audio is silenced, the call carrying on. */
  mutedGroups: Record<string, boolean>;
  toggleGroupMuted: (groupId: string) => void;
  /** True while the full-screen transmit (BroadcastScreen) view is open. */
  isBroadcasting: boolean;
  setIsBroadcasting: (v: boolean) => void;
  /** The transmit view's record button is on, whether or not the server has allowed it yet. */
  videoSendRequested: boolean;
  /** The camera is going out to the group. */
  videoSending: boolean;
  /** Why a transmission just ended without the user stopping it. */
  videoSendNotice: VideoSendNotice | null;
  startVideoSend: () => void;
  stopVideoSend: () => void;
  /** True while the full-screen receive (ReceiveScreen) view is open. */
  isWatchingVideo: boolean;
  setIsWatchingVideo: (v: boolean) => void;
  /** The server has said the watched transmission finished; the view is about to close. */
  videoTransmissionEnded: boolean;
  /**
   * Who is sending video to the focused group's MCVideo call now. Empty when the
   * group has no call up or nobody is transmitting, which is when Receive is
   * disabled; with more than one, the Receive button asks which to watch.
   */
  videoTransmitters: readonly VideoTransmitter[];
  /** The transmitter the receive view shows, or null for whoever the server sends. */
  watchedTransmitter: string | null;
  setWatchedTransmitter: (id: string | null) => void;
  /**
   * A private video call has the camera and the decoder: the transmit and receive
   * views are closed and cannot be opened until it is over.
   */
  privateVideoCall: boolean;
}

const TalkContext = createContext<TalkContextValue | null>(null);

/** The group whose call has [callId], or undefined. */
function groupOfCall(calls: Record<string, SdkGroupCall>, callId: string): string | undefined {
  return Object.keys(calls).find(g => calls[g].sdkCallId === callId);
}

/** [calls] without [groupId]'s entry. */
function without(calls: Record<string, SdkGroupCall>, groupId: string): Record<string, SdkGroupCall> {
  const next = { ...calls };
  delete next[groupId];
  return next;
}

/**
 * How long a call we started may go without the SDK naming it. The SDK reports
 * CALLING as soon as the INVITE is out, so this only runs out when it refused
 * the call before one existed — some refusals say so with an SdkError, the
 * rest only in its log.
 */
export const GROUP_CALL_START_TIMEOUT_MS = 10_000;

/** How long the receive view shows that the transmission ended before it closes. */
export const RECEIVE_ENDED_NOTICE_MS = 2_500;

/** SdkErrors that mean a call we just started will never be reported. */
const CALL_START_ERRORS: ReadonlySet<McSdkError> = new Set<McSdkError>([
  'NOT_REGISTERED',
  'CALL_CODEC_INVALID',
  'CALL_MEDIA_PORTS_UNAVAILABLE',
]);

/**
 * [calls] with the group call [e] reports, new or updated. A new call id for a
 * group replaces the old entry: that call has ended (its termination may still
 * be on its way) and its floor state must not leak into this one.
 *
 * The group comes from the event: the SDK reads it off <mcptt-calling-group-id>
 * (CallModule → CallMachine::OnInviteReceived), so an incoming call names its own
 * group and nothing has to be inferred. A call already placed keeps its group, so a
 * later update cannot move it.
 */
function withCall(
  calls: Record<string, SdkGroupCall>,
  e: CallInfoEvent,
): Record<string, SdkGroupCall> {
  const groupId = groupOfCall(calls, e.callId) ?? e.groupId;
  const state = mapCallState(e.state);
  if (!groupId || !state) return calls;
  const prev = calls[groupId]?.sdkCallId === e.callId ? calls[groupId] : undefined;
  const now = Date.now();
  return {
    ...calls,
    [groupId]: {
      groupId,
      sdkCallId: e.callId,
      state,
      startedBy: e.outgoing ? 'me' : 'others',
      floorState: prev?.floorState ?? 'idle',
      floorOwner: prev?.floorOwner,
      queuePosition: prev?.queuePosition,
      floorNotice: prev?.floorNotice,
      talkers: prev?.talkers ?? [],
      // Restarted when it goes active, as a private call's timer is.
      startedAt: state === 'active' && prev?.state !== 'active' ? now : prev?.startedAt ?? now,
    },
  };
}

export function TalkContextProvider({ children }: { children: React.ReactNode }) {
  const { sdkRef, created } = useSdkContext();
  const [groups, setGroups] = useState<McSdkGroupInfo[]>([]);
  const [affiliatedGroups, setAffiliatedGroups] = useState<McSdkGroupInfo[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [identityServices, setIdentityServices] = useState<ServiceFlags>(
    { ptt: false, video: false, data: false },
  );
  const [activeGroups, setActiveGroups] = useState<ActiveGroupInfo[]>([]);
  const [pendingGroup, setPendingGroup] = useState<string | null>(null);
  const [groupCalls, setGroupCalls] = useState<Record<string, GroupCallState>>({});
  const [activationOrder, setActivationOrder] = useState<string[]>([]);
  const [lastClosedAt, setLastClosedAt] = useState<Record<string, number>>({});
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isWatchingVideo, setIsWatchingVideo] = useState(false);
  // Which transmitter the receive view was opened for. The SDK sends one stream at a
  // time, so this is what the view names; null means whoever the server sends.
  const [watchedTransmitter, setWatchedTransmitter] = useState<string | null>(null);
  const [sdkGroupCalls, setSdkGroupCalls] = useState<Record<string, SdkGroupCall>>({});

  // Read by the commands, which must address the call as it is now.
  const sdkGroupCallsRef = useRef(sdkGroupCalls);
  useEffect(() => { sdkGroupCallsRef.current = sdkGroupCalls; }, [sdkGroupCalls]);

  // Calls whose floor the user still wants (PTT held), by call id. Read when a
  // queued request's turn comes, as CallContext does for a private call.
  const floorWantedRef = useRef(new Set<string>());
  // The same, for rendering: the call PTT is held on. Only one at a time.
  const [pttCallId, setPttCallId] = useState<string | null>(null);

  const [focusedGroup, setFocusedGroup] = useState<string | null>(null);
  const [mutedGroups, setMutedGroups] = useState<Record<string, boolean>>({});

  // The SDK pushes both lists — there is no getter. They arrive once registration
  // completes, so before that the Talk screen legitimately has no groups to show.
  //
  // `sdkRef` is deliberately not a dependency: it is a ref, so its `.current` is
  // read at effect time and its identity must not retrigger this effect.
  useEffect(() => {
    const sdk = sdkRef.current;
    if (!created || !sdk) {
      setGroups([]);
      setAffiliatedGroups([]);
      setGroupsLoaded(false);
      setSdkGroupCalls({});
      return;
    }
    const subs = [
      sdk.onGroupsUpdated(e => { setGroups(e.groups); setGroupsLoaded(true); }),
      sdk.onAffiliationsUpdated(e => setAffiliatedGroups(e.groups)),
      sdk.onIdentityUpdated(e => setIdentityServices({
        ptt: e.isPtt, video: e.isVideo, data: e.isData,
      })),

      // ── Group calls ────────────────────────────────────────────────────────
      // CallContext gets the same events and leaves group calls to us; we
      // leave private calls to it. Floor and termination events carry no call
      // type, so they are matched by call id against the calls held here. A
      // group's MCVideo call is useGroupVideoSend's: it runs alongside the MCPTT
      // one, and taken here it would replace it, there being one call per group.
      sdk.onIncomingCall((e: CallInfoEvent) => {
        if (isGroupCall(e) && !isGroupVideoCall(e)) {
          setSdkGroupCalls(prev => withCall(prev, e));
        }
      }),
      sdk.onCallUpdated((e: CallInfoEvent) => {
        if (isGroupCall(e) && !isGroupVideoCall(e)) {
          setSdkGroupCalls(prev => withCall(prev, e));
        }
      }),
      sdk.onCallTerminated((e: CallTerminatedEvent) => {
        floorWantedRef.current.delete(e.callId);
        setPttCallId(id => (id === e.callId ? null : id));
        setSdkGroupCalls(prev => {
          const groupId = groupOfCall(prev, e.callId);
          return groupId ? without(prev, groupId) : prev;
        });
      }),
      sdk.onFloorUpdated((e: FloorUpdatedEvent) => {
        // Our queued request's turn: the server hands the floor over only if
        // we ask again before T132 runs out (TS 24.380 §6.2.4.9.4).
        if (e.status === 'GRANT_PENDING' && floorWantedRef.current.has(e.callId)
            && groupOfCall(sdkGroupCallsRef.current, e.callId)) {
          sdk.requestFloor(e.callId);
        }
        setSdkGroupCalls(prev => {
          const groupId = groupOfCall(prev, e.callId);
          if (!groupId) return prev;
          const call = prev[groupId];
          return {
            ...prev,
            [groupId]: {
              ...call,
              ...floorFieldsAfter(call, e),
              talkers: (e.talkers ?? []).map(t => t.id).filter(Boolean),
            },
          };
        });
      }),
      // A call we started that the SDK refused outright: no call event will
      // follow, so the placeholder goes now rather than at the timeout.
      sdk.onSdkError((e: SdkErrorEvent) => {
        // Audio failures carry no call id; they are about the call heard.
        if (USER_FACING_AUDIO_ERRORS.has(e.error)) {
          const callId = audioCallIdRef.current;
          if (callId) noteAudioProblem(callId, e.error);
          return;
        }
        if (!CALL_START_ERRORS.has(e.error)) return;
        setSdkGroupCalls(prev => {
          const pending = Object.keys(prev).filter(g => prev[g].sdkCallId === '');
          return pending.length ? pending.reduce(without, prev) : prev;
        });
      }),
    ];
    return () => subs.forEach(s => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created]);

  const affiliationByGroup = useMemo(() => {
    const map: Record<string, ServiceFlags> = {};
    affiliatedGroups.forEach(g => { map[g.groupId] = serviceFlagsOf(g); });
    return map;
  }, [affiliatedGroups]);

  const applyAffiliation = useCallback((requests: McSdkAffiliateRequest[]) => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    // A request with no service selected means "not affiliated" — the SDK would
    // reject it, so express that by leaving the group out of the desired set.
    const desired = requests.filter(r => r.ptt || r.video || r.data);
    if (desired.length === 0) sdk.deaffiliate();
    else sdk.affiliate(desired);
  }, [sdkRef]);

  const startGroupCall = useCallback((groupId: string) => {
    const sdk = sdkRef.current;
    if (!sdk || sdkGroupCallsRef.current[groupId]) return;
    const startedAt = Date.now();
    setSdkGroupCalls(prev => prev[groupId] ? prev : {
      ...prev,
      [groupId]: {
        groupId, sdkCallId: '', state: 'connecting', startedBy: 'me',
        floorState: 'idle', talkers: [], startedAt,
      },
    });
    sdk.startGroupCall(groupId, CALL_AUDIO_CODEC);
    // Only this attempt's placeholder: startedAt tells it from a later one.
    setTimeout(() => setSdkGroupCalls(prev => {
      const c = prev[groupId];
      return c && c.sdkCallId === '' && c.startedAt === startedAt ? without(prev, groupId) : prev;
    }), GROUP_CALL_START_TIMEOUT_MS);
  }, [sdkRef]);

  // Dropped at once, so the SDK's own termination event finds nothing to do.
  const endGroupCall = useCallback((groupId: string) => {
    const call = sdkGroupCallsRef.current[groupId];
    if (!call) return;
    if (call.sdkCallId) {
      floorWantedRef.current.delete(call.sdkCallId);
      setPttCallId(id => (id === call.sdkCallId ? null : id));
      sdkRef.current?.terminateCall(call.sdkCallId);
    }
    setSdkGroupCalls(prev => without(prev, groupId));
  }, [sdkRef]);

  const requestGroupFloor = useCallback((groupId: string) => {
    const call = sdkGroupCallsRef.current[groupId];
    if (!call || call.state !== 'active' || !call.sdkCallId) return;
    floorWantedRef.current.add(call.sdkCallId);
    setPttCallId(call.sdkCallId);
    sdkRef.current?.requestFloor(call.sdkCallId);
  }, [sdkRef]);

  // Sent whatever the floor state, so letting go before the grant arrives
  // withdraws the request instead of leaving the floor to be granted to no one.
  const releaseGroupFloor = useCallback((groupId: string) => {
    const call = sdkGroupCallsRef.current[groupId];
    if (!call || !call.sdkCallId) return;
    floorWantedRef.current.delete(call.sdkCallId);
    setPttCallId(id => (id === call.sdkCallId ? null : id));
    sdkRef.current?.releaseFloor(call.sdkCallId);
  }, [sdkRef]);

  const toggleGroupMuted = useCallback((groupId: string) => {
    setMutedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  // ── Group call audio ───────────────────────────────────────────────────────
  // A private call takes the pipeline whenever it has audio: it was answered
  // on purpose, while a group call comes up on its own.
  const privateCall = useCallContextIfPresent();
  const privateAudioCallId = privateCall?.audioCallId ?? null;
  // One camera and one decoder: a private video call, answered or placed on
  // purpose, takes them from the group's views.
  const privateVideoCall = privateCall?.videoCallLive ?? false;

  const audioCall = useMemo(() => {
    if (privateAudioCallId) return undefined;
    const up = Object.values(sdkGroupCalls).filter(c => c.state === 'active' && c.sdkCallId);
    return up.find(c => c.groupId === focusedGroup)
      ?? up.sort((a, b) => b.startedAt - a.startedAt)[0];
  }, [sdkGroupCalls, focusedGroup, privateAudioCallId]);

  const audioCallIdRef = useRef<string | null>(null);
  audioCallIdRef.current = audioCall?.sdkCallId ?? null;

  /** Puts an AUDIO:<reason> notice on the group call whose audio this was about. */
  const noteAudioProblem = useCallback((callId: string, reason: CallAudioProblem | McSdkError) => {
    setSdkGroupCalls(prev => {
      const groupId = groupOfCall(prev, callId);
      return groupId ? { ...prev, [groupId]: { ...prev[groupId], floorNotice: `AUDIO:${reason}` } } : prev;
    });
  }, []);

  // Sent only while PTT is held and the floor is granted: after letting go the
  // floor reads granted until the server's IDLE, and nothing may go out then.
  // Heard on the loudspeaker, as a group call is listened to, not held to the ear.
  useCallAudio({
    callId: audioCall?.sdkCallId ?? null,
    transmit: !!audioCall && audioCall.floorState === 'granted' && pttCallId === audioCall.sdkCallId,
    playbackMuted: !!audioCall && !!mutedGroups[audioCall.groupId],
    route: 'SPEAKER',
    onProblem: noteAudioProblem,
  });

  // The transmit view sends the camera to the group the Talk screen shows.
  const {
    calls: videoCalls,
    requested: videoSendRequested,
    sending: videoSending,
    notice: videoSendNotice,
    startSending: startVideoSend,
    stopSending: stopVideoSend,
  } = useGroupVideoSend({
    sdkRef,
    created,
    // Released in the same commit as the private call takes it, so the group's
    // stop always reaches the native pipeline before the private call's start.
    groupId: isBroadcasting && !privateVideoCall ? focusedGroup : null,
  });

  // The receive view shows the same group's video call.
  const watchedCall = focusedGroup ? videoCalls[focusedGroup] : undefined;
  const {
    ended: videoTransmissionEnded,
    transmitters: videoTransmitters,
  } = useGroupVideoReceive({
    sdkRef,
    created,
    watching: isWatchingVideo && !privateVideoCall,
    // Not gated on the view being open: the Receive button outside it is disabled
    // from this list, so who is transmitting has to be known before it opens.
    callId: watchedCall?.active ? watchedCall.callId : null,
  });

  // A closed view holds no choice: the next open starts from whoever is sending then.
  useEffect(() => {
    if (!isWatchingVideo) setWatchedTransmitter(null);
  }, [isWatchingVideo]);

  // The chosen transmitter stopped while being watched. The view stays on whatever
  // the server still sends rather than naming someone who has gone.
  useEffect(() => {
    if (!watchedTransmitter) return;
    if (!videoTransmitters.some(t => t.id === watchedTransmitter)) setWatchedTransmitter(null);
  }, [watchedTransmitter, videoTransmitters]);

  useEffect(() => {
    if (!privateVideoCall) return;
    setIsBroadcasting(false);
    setIsWatchingVideo(false);
  }, [privateVideoCall]);

  // The notice stays long enough to read, then the view gives way to the Talk screen.
  // Another transmitter starting in the meantime clears the flag and keeps it open.
  useEffect(() => {
    if (!videoTransmissionEnded) return;
    const t = setTimeout(() => setIsWatchingVideo(false), RECEIVE_ENDED_NOTICE_MS);
    return () => clearTimeout(t);
  }, [videoTransmissionEnded]);

  const recordActivation = useCallback((group: string) => {
    setActivationOrder(prev => prev.includes(group) ? prev : [...prev, group]);
  }, []);

  const recordClose = useCallback((group: string) => {
    setLastClosedAt(prev => ({ ...prev, [group]: Date.now() }));
  }, []);

  const value = useMemo<TalkContextValue>(
    () => ({ groups, affiliatedGroups, affiliationByGroup, applyAffiliation, groupsLoaded, identityServices, activeGroups, setActiveGroups, pendingGroup, setPendingGroup, groupCalls, setGroupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, sdkGroupCalls, startGroupCall, endGroupCall, requestGroupFloor, releaseGroupFloor, setFocusedGroup, audioGroupId: audioCall?.groupId ?? null, mutedGroups, toggleGroupMuted, isBroadcasting, setIsBroadcasting, videoSendRequested, videoSending, videoSendNotice, startVideoSend, stopVideoSend, isWatchingVideo, setIsWatchingVideo, videoTransmissionEnded, videoTransmitters, watchedTransmitter, setWatchedTransmitter, privateVideoCall }),
    [groups, affiliatedGroups, affiliationByGroup, applyAffiliation, groupsLoaded, identityServices, activeGroups, pendingGroup, groupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, sdkGroupCalls, startGroupCall, endGroupCall, requestGroupFloor, releaseGroupFloor, audioCall, mutedGroups, toggleGroupMuted, isBroadcasting, videoSendRequested, videoSending, videoSendNotice, startVideoSend, stopVideoSend, isWatchingVideo, videoTransmissionEnded, videoTransmitters, watchedTransmitter, privateVideoCall],
  );

  return <TalkContext.Provider value={value}>{children}</TalkContext.Provider>;
}

export function useTalkContext(): TalkContextValue {
  const ctx = useContext(TalkContext);
  if (!ctx) {
    throw new Error('useTalkContext must be used inside <TalkContextProvider>');
  }
  return ctx;
}
