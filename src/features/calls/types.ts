/**
 * features/calls/types.ts — Shared types for the Calls feature.
 *
 * All values are UI-only; no MCSDK wiring until SDK exposes the relevant APIs.
 */

export type CallType = 'half_duplex' | 'full_duplex';

export type CallDirection = 'outgoing' | 'incoming';

/**
 * ringing  → incoming call arrived, waiting for user to accept/reject
 * connecting → dialling / waiting for remote to answer (outgoing)
 * active   → call is live
 * ending   → teardown in progress
 */
export type CallState = 'idle' | 'ringing' | 'connecting' | 'active' | 'ending';

/**
 * Floor arbitration state.
 *   idle    → no one holds the floor      → primary (blue) button
 *   granted → current user has the floor  → success  (green) button
 *   busy    → another party is speaking   → error    (red)   button (locked)
 */
export type FloorState = 'idle' | 'granted' | 'busy';

/**
 * How the call is joined:
 *   auto   → app joins immediately when the call is connected
 *   manual → user must press "Join" explicitly (push-to-talk style entry)
 */
export type CommencementMode = 'auto' | 'manual';

/** Represents the currently active (or connecting) call. */
export interface ActiveCall {
  id: string;
  contactName: string;
  sipUri: string;
  callType: CallType;
  direction: CallDirection;
  commencementMode: CommencementMode;
  state: CallState;
  floorState: FloorState;
  startedAt: number;        // Unix ms
  /** True when mode is manual and the user has not yet pressed "Join" */
  needsManualJoin: boolean;
}

/** Persisted call history record. */
export interface CallRecord {
  id: string;
  contactName: string;
  sipUri: string;
  direction: CallDirection;
  callType: CallType;
  commencementMode: CommencementMode;
  startedAt: number;        // Unix ms
  endedAt: number;          // Unix ms
  /** Duration in whole seconds */
  duration: number;
}
