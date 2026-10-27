/**
 * contexts/CallContext.tsx — Global call state.
 *
 * Driven by the SDK's call callbacks (onIncomingCall / onCallUpdated /
 * onCallTerminated / onFloorUpdated). Calls that originate in the SDK carry its
 * `sdkCallId`, which is what answer/reject/terminate are addressed to; the
 * simulate* helpers still create purely local calls for testing the UI without
 * a network.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CallInfoEvent,
  CallTerminatedEvent,
  FloorUpdatedEvent,
  McSdkCallState,
  McSdkError,
  McSdkFloorStatus,
  SdkErrorEvent,
} from '../mcsdk';
import { useSdkContext } from './SdkContext';
import { MediaSession } from '../core/mediaSession';
import { displayMcId } from '../features/calls/mcId';
import type {
  ActiveCall,
  CallEnd,
  CallRecord,
  CallState,
  CallType,
  CommencementMode,
  FloorState,
} from '../features/calls/types';

// ── Helper ────────────────────────────────────────────────────────────────────

function uuid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── SDK → UI mapping ──────────────────────────────────────────────────────────

/**
 * Maps McSdkCallState onto the UI's CallState.
 *
 * INCOMING is the only state that must show the ringing overlay. ACCEPTING and
 * the outgoing dial states are all "not yet talking" → connecting. TERMINATING /
 * TERMINATED are not mapped here: teardown is driven by onCallTerminated, which
 * also carries the reason, so treating them as a state change would race it.
 */
function mapCallState(state: McSdkCallState): CallState | null {
  switch (state) {
    case 'INCOMING':
      return 'ringing';
    case 'ACCEPTING':
    case 'OUTGOING':
    case 'CALLING':
    case 'RINGING':
    case 'ESTABLISHING':
    case 'REESTABLISHING':
      return 'connecting';
    case 'ACTIVE':
      return 'active';
    case 'TERMINATING':
      return 'ending';
    default:
      return null;
  }
}

/**
 * Maps FloorInfo.status onto the UI's floor state. The status is already from
 * our side: GRANTED means we hold the floor and TAKEN means someone else does.
 * `ownerId` cannot decide it — the SDK only sets it on Floor Taken, so on our
 * own grant it is empty or still names the previous talker.
 */
function mapFloorState(status: McSdkFloorStatus): FloorState {
  switch (status) {
    case 'GRANTED':
      return 'granted';
    case 'TAKEN':
      return 'busy';
    case 'REQUESTED':
      return 'requesting';
    case 'QUEUED':
    case 'GRANT_PENDING':
      return 'queued';
    default:
      // IDLE, RELEASED, and every way a request or grant ends without the
      // floor: DENIED, REVOKED, the timeouts, GRANT_EXPIRED.
      return 'idle';
  }
}

/** Floor channel failures the user should hear about: PTT cannot work at all. */
const USER_FACING_FLOOR_ERRORS: ReadonlySet<McSdkError> = new Set<McSdkError>([
  'FLOOR_CHANNEL_FAILED',
  'FLOOR_SDP_INVALID',
  'FLOOR_SEND_FAILED',
]);

/**
 * Why a request or grant ended without the floor, as `STATUS` or
 * `STATUS:REASON`. Undefined for statuses that are not such an ending.
 */
function floorNoticeFor(e: FloorUpdatedEvent): string | undefined {
  switch (e.status) {
    case 'DENIED':
      return `DENIED:${e.denyReason}`;
    case 'REVOKED':
      return `REVOKED:${e.revokeReason}`;
    case 'REQUEST_TIMEOUT':
    case 'QUEUE_TIMEOUT':
    case 'GRANT_EXPIRED':
      return e.status;
    default:
      return undefined;
  }
}

/** MCPTT group/private calls are half-duplex; video is the full-duplex case. */
function mapCallType(e: CallInfoEvent): CallType {
  return e.type === 'AMBIENT_LISTENING' ? 'full_duplex' : 'half_duplex';
}

/** Best available human label for the remote party: its MC ID, not the URI. */
function remoteLabel(e: CallInfoEvent): string {
  const uri = e.groupId || e.callerId || e.calleeId;
  return uri ? displayMcId(uri) : 'Unknown';
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface CallContextValue {
  /** The currently active (or connecting) call, or null when idle. */
  activeCall: ActiveCall | null;
  /** Ordered newest-first list of completed calls. */
  callHistory: CallRecord[];
  /** App-wide default commencement mode (can be overridden per call). */
  commencementMode: CommencementMode;
  setCommencementMode: (m: CommencementMode) => void;

  /**
   * Initiate an outgoing call.
   * @param contactName  Display name of the callee.
   * @param sipUri       SIP URI of the callee.
   * @param callType     `half_duplex` or `full_duplex`.
   * @param commencement `'auto'` (direct active) or `'manual'` (connecting, needs answer).
   */
  startCall: (contactName: string, sipUri: string, callType: CallType, commencement?: CommencementMode) => void;

  /** Terminate the active call and add it to history. */
  endCall: () => void;

  /**
   * Change the floor state of the active call.
   * Simulates floor grant/release until SDK provides real callbacks.
   */
  setFloorState: (state: FloorState) => void;

  /**
   * Ask for the floor of the active call (PTT pressed). For an SDK call this
   * only sends the request; floorState follows the server's answer.
   */
  requestFloor: () => void;

  /** Give up the floor, or withdraw a pending request (PTT released). */
  releaseFloor: () => void;

  /** Call audio on the loudspeaker (true) or the earpiece. Resets when the call ends. */
  speakerOn: boolean;
  /** Switches the audio route between loudspeaker and earpiece. */
  toggleSpeaker: () => void;

  /**
   * Microphone muted. UI state only for now: no call audio flows yet, so there
   * is no uplink to gate. Resets when the call ends.
   */
  micMuted: boolean;
  toggleMute: () => void;

  /**
   * Manually join a call that is in manual-commencement mode.
   * Clears `needsManualJoin` and moves state to `active`.
   */
  joinCall: () => void;

  /** Remove all call history entries. */
  clearHistory: () => void;

  // ── Mock / test helpers ────────────────────────────────────────
  /**
   * Simulate an incoming call arriving (state → 'ringing').
   * Shows IncomingCallScreen until the user accepts or rejects.
   */
  simulateIncomingCall: (contactName: string, sipUri: string, callType: CallType) => void;

  /**
   * Accept the ringing incoming call.
   * Respects the current commencementMode — manual mode shows the Join banner.
   */
  acceptCall: () => void;

  /**
   * Reject / miss the ringing call — adds a 0-duration record to history.
   */
  rejectCall: () => void;

  /** Simulate the remote party answering an outgoing call (connecting → active). */
  simulateAnswer: () => void;

  /** Force floor state to 'busy' (simulate another party speaking). */
  simulateFloorBusy: () => void;

  /** Release a simulated floor-busy back to 'idle'. */
  simulateFloorIdle: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCallContext(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error('useCallContext must be used inside <CallContextProvider>');
  }
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function CallContextProvider({ children }: { children: React.ReactNode }) {
  const { sdkRef, created } = useSdkContext();
  const [activeCall,       setActiveCall]       = useState<ActiveCall | null>(null);
  const [callHistory,      setCallHistory]       = useState<CallRecord[]>([]);
  const [commencementMode, setCommencementModeState] = useState<CommencementMode>('auto');

  // Read inside SDK callbacks, which are registered once and must not capture a
  // stale mode.
  const commencementModeRef = useRef(commencementMode);
  useEffect(() => { commencementModeRef.current = commencementMode; }, [commencementMode]);

  // Read by the floor commands, which must address the call as it is now rather
  // than as it was when the callback was created.
  const activeCallRef = useRef(activeCall);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

  // True between requestFloor() and releaseFloor(): the user still wants the
  // floor (PTT held, or toggled on). Read when a queued request's turn comes.
  const floorWantedRef = useRef(false);
  useEffect(() => { if (!activeCall) floorWantedRef.current = false; }, [activeCall]);

  // ── Audio route and mute ────────────────────────────────────────────────────
  // Per call: the next call starts on the earpiece and unmuted. The route is
  // device-wide, so it is put back when the call goes rather than left on the
  // speaker for whatever plays next.
  const [speakerOn, setSpeakerOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const speakerOnRef = useRef(false);

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOnRef.current;
    speakerOnRef.current = next;
    MediaSession.setRoute(next ? 'SPEAKER' : 'EARPIECE');
    setSpeakerOn(next);
  }, []);

  const toggleMute = useCallback(() => setMicMuted(m => !m), []);

  useEffect(() => {
    if (activeCall) return;
    if (speakerOnRef.current) {
      speakerOnRef.current = false;
      MediaSession.setRoute('EARPIECE');
    }
    setSpeakerOn(false);
    setMicMuted(false);
  }, [activeCall]);

  const setCommencementMode = useCallback((m: CommencementMode) => {
    setCommencementModeState(m);
  }, []);

  /**
   * Moves a call into history. Shared by SDK teardown and local end/reject.
   * `end` says how it ended; left out for a call replaced by another one.
   */
  const archive = useCallback((prev: ActiveCall, duration?: number, end?: CallEnd) => {
    const now = Date.now();
    const record: CallRecord = {
      id:               prev.id,
      contactName:      prev.contactName,
      sipUri:           prev.sipUri,
      direction:        prev.direction,
      callType:         prev.callType,
      commencementMode: prev.commencementMode,
      startedAt:        prev.startedAt,
      endedAt:          now,
      duration:         duration ?? Math.round((now - prev.startedAt) / 1000),
      end,
    };
    setCallHistory(h => [record, ...h]);
  }, []);

  // ── SDK call callbacks ──────────────────────────────────────────────────────
  // `sdkRef` is a ref, so it is deliberately not a dependency — only `created`
  // gates (re)subscription.
  useEffect(() => {
    const sdk = sdkRef.current;
    if (!created || !sdk) return;

    const subs = [
      // A new inbound call. Shows the ringing overlay via state='ringing'.
      sdk.onIncomingCall((e: CallInfoEvent) => {
        setActiveCall(prev => {
          // A second call while one is up: the existing one is not ours to keep.
          if (prev) archive(prev);
          return {
            id:               uuid(),
            sdkCallId:        e.callId,
            contactName:      remoteLabel(e),
            sipUri:           e.callerId || e.groupId,
            callType:         mapCallType(e),
            direction:        'incoming',
            commencementMode: commencementModeRef.current,
            state:            'ringing',
            floorState:       'idle',
            startedAt:        Date.now(),
            needsManualJoin:  false,
          };
        });
      }),

      // State transitions for a call we already know about.
      sdk.onCallUpdated((e: CallInfoEvent) => {
        const next = mapCallState(e.state);
        if (!next) return;
        setActiveCall(prev => {
          if (!prev) return prev;
          // startCall() creates the local call before the SDK has issued an id,
          // so adopt the first id that arrives for our own outgoing call.
          if (!prev.sdkCallId && e.outgoing && prev.direction === 'outgoing') {
            prev = { ...prev, sdkCallId: e.callId };
          }
          if (prev.sdkCallId !== e.callId) return prev;
          const isManual = prev.commencementMode === 'manual';
          // Entering 'active' is when the call really starts, so restart the
          // timer — and in manual mode hold the user at the Join banner.
          if (next === 'active') {
            return {
              ...prev,
              state:           isManual ? 'connecting' : 'active',
              needsManualJoin: isManual,
              startedAt:       Date.now(),
            };
          }
          return { ...prev, state: next };
        });
      }),

      sdk.onCallTerminated((e: CallTerminatedEvent) => {
        setActiveCall(prev => {
          if (!prev || prev.sdkCallId !== e.callId) return prev;
          // A call that never went active has no talk time to report.
          archive(prev, prev.state === 'ringing' ? 0 : undefined, {
            mode:      e.mode,
            reason:    e.reason,
            sipCode:   e.sipCode,
            sipReason: e.sipReason,
          });
          return null;
        });
      }),

      sdk.onFloorUpdated((e: FloorUpdatedEvent) => {
        // Our queued request's turn has come, but the server only hands the
        // floor over if we ask again before T132 runs out (TS 24.380
        // §6.2.4.9.4). Ask if the user is still holding PTT.
        if (e.status === 'GRANT_PENDING' && floorWantedRef.current
            && activeCallRef.current?.sdkCallId === e.callId) {
          sdk.requestFloor(e.callId);
        }
        setActiveCall(prev => {
          if (!prev || prev.sdkCallId !== e.callId) return prev;
          const floorState = mapFloorState(e.status);
          // A notice outlives the update that raised it (an IDLE may follow a
          // DENIED), and is cleared once a new request starts or succeeds.
          const notice = floorNoticeFor(e);
          const floorNotice = notice
            ?? (floorState === 'requesting' || floorState === 'granted' ? undefined : prev.floorNotice);
          return {
            ...prev,
            floorState,
            floorOwner:    floorState === 'busy' ? e.ownerId || undefined : undefined,
            queuePosition: floorState === 'queued' ? e.queuePosition : undefined,
            floorNotice,
          };
        });
      }),

      // The floor channel failing is otherwise invisible: PTT does nothing and
      // no floor update follows. SdkError carries no call id; there is only
      // ever one call, so it goes on the active SDK call. The protocol-level
      // ones (malformed, unknown, unexpected source) are left to the log.
      sdk.onSdkError((e: SdkErrorEvent) => {
        if (!USER_FACING_FLOOR_ERRORS.has(e.error)) return;
        setActiveCall(prev =>
          prev?.sdkCallId ? { ...prev, floorNotice: `ERROR:${e.error}` } : prev,
        );
      }),
    ];
    return () => subs.forEach(s => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, archive]);

  const startCall = useCallback((
    contactName: string,
    sipUri: string,
    callType: CallType,
    commencement?: CommencementMode,
  ) => {
    const mode = commencement ?? commencementMode;
    // End any existing call first (shouldn't normally happen but be safe)
    setActiveCall(prev => {
      if (prev) archive(prev);
      return null;
    });

    // Ask the SDK to place the call. It answers with onCallUpdated, which drives
    // the real state; until then the UI shows 'connecting'. Without an SDK the
    // call stays local so the screens remain usable offline. Only a half-duplex
    // call has floor control; full-duplex is §11.1.2, with no floor to request.
    const sdk = sdkRef.current;
    if (sdk) sdk.startPrivateCall(sipUri, mode === 'auto', callType === 'full_duplex');

    const call: ActiveCall = {
      id:               uuid(),
      contactName,
      sipUri,
      callType,
      direction:        'outgoing',
      commencementMode: mode,
      // A real call is never instantly up — wait for the SDK to say ACTIVE.
      state:            sdk ? 'connecting' : (mode === 'auto' ? 'active' : 'connecting'),
      floorState:       'idle',
      startedAt:        Date.now(),
      needsManualJoin:  false,
    };
    setActiveCall(call);
  }, [commencementMode, archive, sdkRef]);

  const endCall = useCallback(() => {
    setActiveCall(prev => {
      if (!prev) return null;
      if (prev.sdkCallId) sdkRef.current?.terminateCall(prev.sdkCallId);
      // Archived now, so the SDK's own termination event finds no call. Hanging
      // up before the far end answered is a cancel, not a hang-up.
      const unanswered = prev.direction === 'outgoing' && prev.state !== 'active';
      archive(prev, undefined, unanswered
        ? { mode: 'CANCELLED_LOCALLY', reason: 'UNKNOWN' }
        : { mode: 'CLOSED_LOCALLY',    reason: 'NORMAL' });
      return null;
    });
  }, [archive, sdkRef]);

  const setFloorState = useCallback((state: FloorState) => {
    setActiveCall(prev => prev ? { ...prev, floorState: state } : null);
  }, []);

  // Floor commands. For an SDK call they only send the request: the floor state
  // changes when the server answers, via onFloorUpdated, so the UI never shows
  // the floor as ours before it is. A simulated call has no server and falls
  // back to setting the state locally.
  const requestFloor = useCallback(() => {
    const call = activeCallRef.current;
    if (!call || call.state !== 'active') return;
    if (call.sdkCallId) {
      floorWantedRef.current = true;
      sdkRef.current?.requestFloor(call.sdkCallId);
    } else if (call.floorState !== 'busy') {
      setFloorState('granted');
    }
  }, [sdkRef, setFloorState]);

  // Sent whatever the floor state, so letting go before the grant arrives
  // withdraws the request instead of leaving the floor to be granted to no one.
  const releaseFloor = useCallback(() => {
    floorWantedRef.current = false;
    const call = activeCallRef.current;
    if (!call) return;
    if (call.sdkCallId) {
      sdkRef.current?.releaseFloor(call.sdkCallId);
    } else if (call.floorState === 'granted') {
      setFloorState('idle');
    }
  }, [sdkRef, setFloorState]);

  const joinCall = useCallback(() => {
    setActiveCall(prev =>
      prev ? { ...prev, state: 'active', needsManualJoin: false } : null,
    );
  }, []);

  const clearHistory = useCallback(() => {
    setCallHistory([]);
  }, []);

  const acceptCall = useCallback(() => {
    setActiveCall(prev => {
      if (!prev || prev.state !== 'ringing') return prev;
      // Real calls are answered through the SDK; the resulting ACTIVE arrives
      // via onCallUpdated, so only move to 'connecting' optimistically here.
      if (prev.sdkCallId) {
        sdkRef.current?.answerCall(prev.sdkCallId);
        return { ...prev, state: 'connecting' };
      }
      const isManual = commencementMode === 'manual';
      return {
        ...prev,
        state:           isManual ? 'connecting' : 'active',
        needsManualJoin: isManual,
        startedAt:       Date.now(), // reset timer to call-accepted moment
      };
    });
  }, [commencementMode, sdkRef]);

  const rejectCall = useCallback(() => {
    setActiveCall(prev => {
      if (!prev || prev.state !== 'ringing') return prev;
      if (prev.sdkCallId) sdkRef.current?.rejectCall(prev.sdkCallId);
      archive(prev, 0, { mode: 'REJECTED_LOCALLY', reason: 'DECLINED' });
      return null;
    });
  }, [archive, sdkRef]);

  // ───────────────────────────────────────────────────────────────────────────
  // MOCK / SIMULATION HELPERS
  //
  // These stand in for events the real SDK will eventually push (remote answer,
  // incoming call, floor grant/release by another party). They are wired into
  // the same CallContextValue surface as the real actions, but are purely test
  // scaffolding: when the native bridge exposes real call callbacks, delete
  // this whole block and drop the corresponding fields from CallContextValue.
  // Nothing here should ship enabled in a production build.
  // ───────────────────────────────────────────────────────────────────────────

  /** Simulate the remote party answering an outgoing call (connecting → active). */
  const simulateAnswer = useCallback(() => {
    setActiveCall(prev =>
      prev && prev.state === 'connecting'
        ? { ...prev, state: 'active', startedAt: Date.now() }
        : prev,
    );
  }, []);

  /** Simulate an incoming call arriving (state → 'ringing'). */
  const simulateIncomingCall = useCallback((
    contactName: string,
    sipUri: string,
    callType: CallType,
  ) => {
    // Dismiss any existing call first
    setActiveCall(prev => {
      if (prev) {
        const now = Date.now();
        const record: CallRecord = {
          id: prev.id, contactName: prev.contactName, sipUri: prev.sipUri,
          direction: prev.direction, callType: prev.callType,
          commencementMode: prev.commencementMode,
          startedAt: prev.startedAt, endedAt: now,
          duration: Math.round((now - prev.startedAt) / 1000),
        };
        setCallHistory(h => [record, ...h]);
      }
      return null;
    });
    const call: ActiveCall = {
      id:               uuid(),
      contactName,
      sipUri,
      callType,
      direction:        'incoming',
      commencementMode, // inherited from app setting
      state:            'ringing',
      floorState:       'idle',
      startedAt:        Date.now(),
      needsManualJoin:  false,
    };
    setActiveCall(call);
  }, [commencementMode]);

  /** Force floor state to 'busy' (simulate another party speaking). */
  const simulateFloorBusy = useCallback(() => {
    setActiveCall(prev =>
      prev && prev.state === 'active' ? { ...prev, floorState: 'busy' } : prev,
    );
  }, []);

  /** Release a simulated floor-busy back to 'idle'. */
  const simulateFloorIdle = useCallback(() => {
    setActiveCall(prev =>
      prev && prev.state === 'active' ? { ...prev, floorState: 'idle' } : prev,
    );
  }, []);

  const value = useMemo<CallContextValue>(() => ({
    // ── Real call actions ──
    activeCall,
    callHistory,
    commencementMode,
    setCommencementMode,
    startCall,
    endCall,
    setFloorState,
    requestFloor,
    releaseFloor,
    speakerOn,
    toggleSpeaker,
    micMuted,
    toggleMute,
    joinCall,
    acceptCall,
    rejectCall,
    clearHistory,
    // ── Mock / simulation scaffolding (remove with the block above) ──
    simulateIncomingCall,
    simulateAnswer,
    simulateFloorBusy,
    simulateFloorIdle,
  }), [
    activeCall, callHistory, commencementMode,
    setCommencementMode, startCall, endCall,
    setFloorState, requestFloor, releaseFloor,
    speakerOn, toggleSpeaker, micMuted, toggleMute,
    joinCall, acceptCall, rejectCall, clearHistory,
    simulateIncomingCall, simulateAnswer,
    simulateFloorBusy, simulateFloorIdle,
  ]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
