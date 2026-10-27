/**
 * features/calls/types.ts — Shared types for the Calls feature.
 */

import type { McSdkTerminationMode, McSdkTerminationReason } from '../../mcsdk';

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
 * Floor arbitration state, from the local participant's point of view.
 *   idle       → no one holds the floor          → primary (blue) button
 *   requesting → Floor Request sent, no answer yet
 *   queued     → the server queued our request (or our turn came: GRANT_PENDING)
 *   granted    → current user has the floor      → success  (green) button
 *   busy       → another party is speaking       → error    (red)   button
 */
export type FloorState = 'idle' | 'requesting' | 'queued' | 'granted' | 'busy';

/**
 * How the call is joined:
 *   auto   → app joins immediately when the call is connected
 *   manual → user must press "Join" explicitly (push-to-talk style entry)
 */
export type CommencementMode = 'auto' | 'manual';

/** Represents the currently active (or connecting) call. */
export interface ActiveCall {
  id: string;
  /**
   * The SDK's own call id, needed to answer/reject/terminate it. Absent for
   * locally simulated calls, which have no counterpart in the SDK.
   */
  sdkCallId?: string;
  contactName: string;
  sipUri: string;
  callType: CallType;
  direction: CallDirection;
  commencementMode: CommencementMode;
  state: CallState;
  floorState: FloorState;
  /** Who is talking while floorState is 'busy' (the server's granted party). */
  floorOwner?: string;
  /** Our place in the floor queue while floorState is 'queued'. */
  queuePosition?: number;
  /**
   * Why the last request ended without the floor, as the SDK's `STATUS` or
   * `STATUS:REASON` (e.g. `DENIED:ANOTHER_CLIENT_HAS_PERMISSION`). Cleared when
   * the next request starts.
   */
  floorNotice?: string;
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
  /** How the call ended. Absent when nothing said (a call replaced by another). */
  end?: CallEnd;
}

/**
 * How a call ended: the SDK's TerminationInfo for one it ended, or what the
 * user did for one ended here.
 */
export interface CallEnd {
  mode:   McSdkTerminationMode;
  reason: McSdkTerminationReason;
  /** SIP code and PJSIP's text for it; only from the SDK, and 0/'' if none. */
  sipCode?:   number;
  sipReason?: string;
}
