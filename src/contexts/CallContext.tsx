/**
 * contexts/CallContext.tsx — Global call state.
 *
 * No MCSDK wiring — all state is managed locally.
 * SDK integration will be added when the native bridge exposes call APIs.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type {
  ActiveCall,
  CallRecord,
  CallType,
  CommencementMode,
  FloorState,
} from '../features/calls/types';

// ── Helper ────────────────────────────────────────────────────────────────────

function uuid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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
   */
  startCall: (contactName: string, sipUri: string, callType: CallType) => void;

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
  const [activeCall,       setActiveCall]       = useState<ActiveCall | null>(null);
  const [callHistory,      setCallHistory]       = useState<CallRecord[]>([]);
  const [commencementMode, setCommencementModeState] = useState<CommencementMode>('auto');

  const setCommencementMode = useCallback((m: CommencementMode) => {
    setCommencementModeState(m);
  }, []);

  const startCall = useCallback((
    contactName: string,
    sipUri: string,
    callType: CallType,
  ) => {
    // End any existing call first (shouldn't normally happen but be safe)
    setActiveCall(prev => {
      if (prev) {
        const now = Date.now();
        const record: CallRecord = {
          id:              prev.id,
          contactName:     prev.contactName,
          sipUri:          prev.sipUri,
          direction:       prev.direction,
          callType:        prev.callType,
          commencementMode: prev.commencementMode,
          startedAt:       prev.startedAt,
          endedAt:         now,
          duration:        Math.round((now - prev.startedAt) / 1000),
        };
        setCallHistory(h => [record, ...h]);
      }
      return null;
    });

    const isManual = commencementMode === 'manual';
    const call: ActiveCall = {
      id:               uuid(),
      contactName,
      sipUri,
      callType,
      direction:        'outgoing',
      commencementMode,
      state:            isManual ? 'connecting' : 'active',
      floorState:       'idle',
      startedAt:        Date.now(),
      needsManualJoin:  isManual,
    };
    setActiveCall(call);
  }, [commencementMode]);

  const endCall = useCallback(() => {
    setActiveCall(prev => {
      if (!prev) return null;
      const now = Date.now();
      const record: CallRecord = {
        id:              prev.id,
        contactName:     prev.contactName,
        sipUri:          prev.sipUri,
        direction:       prev.direction,
        callType:        prev.callType,
        commencementMode: prev.commencementMode,
        startedAt:       prev.startedAt,
        endedAt:         now,
        duration:        Math.round((now - prev.startedAt) / 1000),
      };
      setCallHistory(h => [record, ...h]);
      return null;
    });
  }, []);

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

  // ── Mock helpers ──────────────────────────────────────────────────────────

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

  const acceptCall = useCallback(() => {
    setActiveCall(prev => {
      if (!prev || prev.state !== 'ringing') return prev;
      const isManual = commencementMode === 'manual';
      return {
        ...prev,
        state:           isManual ? 'connecting' : 'active',
        needsManualJoin: isManual,
        startedAt:       Date.now(), // reset timer to call-accepted moment
      };
    });
  }, [commencementMode]);

  const rejectCall = useCallback(() => {
    setActiveCall(prev => {
      if (!prev || prev.state !== 'ringing') return prev;
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
        duration:         0,
      };
      setCallHistory(h => [record, ...h]);
      return null;
    });
  }, []);

  const simulateFloorBusy = useCallback(() => {
    setActiveCall(prev =>
      prev && prev.state === 'active' ? { ...prev, floorState: 'busy' } : prev,
    );
  }, []);

  const simulateFloorIdle = useCallback(() => {
    setActiveCall(prev =>
      prev && prev.state === 'active' ? { ...prev, floorState: 'idle' } : prev,
    );
  }, []);

  const value = useMemo<CallContextValue>(() => ({
    activeCall,
    callHistory,
    commencementMode,
    setCommencementMode,
    startCall,
    endCall,
    setFloorState,
    joinCall,
    clearHistory,
    simulateIncomingCall,
    acceptCall,
    rejectCall,
    simulateFloorBusy,
    simulateFloorIdle,
  }), [
    activeCall, callHistory, commencementMode,
    setCommencementMode, startCall, endCall,
    setFloorState, joinCall, clearHistory,
    simulateIncomingCall, acceptCall, rejectCall,
    simulateFloorBusy, simulateFloorIdle,
  ]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
