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
  McSdkFloorStatus,
} from '../mcsdk';
import { useSdkContext } from './SdkContext';
import { AuthSettings } from '../core/settings';
import type {
  ActiveCall,
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
 * Maps FloorInfo.status onto the UI's three-way floor state. `ownerId` decides
 * between "we hold it" and "someone else does" for GRANTED/TAKEN.
 */
function mapFloorState(status: McSdkFloorStatus, weOwnIt: boolean): FloorState {
  switch (status) {
    case 'GRANTED':
      return weOwnIt ? 'granted' : 'busy';
    case 'TAKEN':
      return 'busy';
    case 'REQUESTED':
    case 'QUEUED':
    case 'GRANT_PENDING':
      return 'idle';
    default:
      return 'idle';
  }
}

/** MCPTT group/private calls are half-duplex; video is the full-duplex case. */
function mapCallType(e: CallInfoEvent): CallType {
  return e.type === 'AMBIENT_LISTENING' ? 'full_duplex' : 'half_duplex';
}

/** Best available human label for the remote party. */
function remoteLabel(e: CallInfoEvent): string {
  return e.groupId || e.callerId || e.calleeId || 'Unknown';
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

  const setCommencementMode = useCallback((m: CommencementMode) => {
    setCommencementModeState(m);
  }, []);

  /** Moves a call into history. Shared by SDK teardown and local end/reject. */
  const archive = useCallback((prev: ActiveCall, duration?: number) => {
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
          archive(prev, prev.state === 'ringing' ? 0 : undefined);
          return null;
        });
      }),

      sdk.onFloorUpdated((e: FloorUpdatedEvent) => {
        setActiveCall(prev => {
          if (!prev || prev.sdkCallId !== e.callId) return prev;
          // ownerId is an MC id; compare against the logged-in user to tell
          // "we hold the floor" from "someone else does".
          const mcId = AuthSettings.getLastUsername() ?? '';
          const weOwnIt = !!e.ownerId && !!mcId && e.ownerId.includes(mcId);
          return { ...prev, floorState: mapFloorState(e.status, weOwnIt) };
        });
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
    // call stays local so the screens remain usable offline.
    const sdk = sdkRef.current;
    if (sdk) sdk.startPrivateCall(sipUri);

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
      archive(prev);
      return null;
    });
  }, [archive, sdkRef]);

  const setFloorState = useCallback((state: FloorState) => {
    setActiveCall(prev => prev ? { ...prev, floorState: state } : null);
  }, []);

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
      archive(prev, 0);
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
    setFloorState, joinCall, acceptCall, rejectCall, clearHistory,
    simulateIncomingCall, simulateAnswer,
    simulateFloorBusy, simulateFloorIdle,
  ]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
