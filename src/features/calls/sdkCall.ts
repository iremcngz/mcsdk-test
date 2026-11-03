/**
 * features/calls/sdkCall.ts — the SDK's call and floor events, read the way the
 * call screens need them. Shared by CallContext (private calls) and TalkContext
 * (group calls): both get the same SDK events, and the floor works the same way
 * in either kind of call.
 */

import type {
  CallInfoEvent,
  FloorUpdatedEvent,
  McSdkAudioCodec,
  McSdkCallState,
  McSdkError,
  McSdkFloorStatus,
} from '../../mcsdk';
import type { CallState, FloorState } from './types';

/**
 * A group call: the Talk screen's, never a private call's. The SDK answers
 * every incoming one by itself, so it never rings — and CallContext, which
 * would otherwise take it for a private call, must leave it alone.
 */
export function isGroupCall(e: CallInfoEvent): boolean {
  return e.type === 'GROUP';
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
export function mapCallState(state: McSdkCallState): CallState | null {
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
export function mapFloorState(status: McSdkFloorStatus): FloorState {
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

/**
 * The AMR-WB framing the call audio pipeline produces (AmrWbRtpPayload): every
 * call is placed and answered with it, and the SDK sends our frames as exactly
 * this. Octet-aligned because it is one byte away from MediaCodec's output, and
 * the SDK's own default — what it uses if a call is answered without a codec.
 */
export const CALL_AUDIO_CODEC: McSdkAudioCodec = 'AMR_WB_OCTET_ALIGNED';

/**
 * Audio-plane failures that leave the call silent; the rest of the AUDIO_*
 * family (malformed packets, unexpected sources) are left to the log.
 */
export const USER_FACING_AUDIO_ERRORS: ReadonlySet<McSdkError> = new Set<McSdkError>([
  'AUDIO_CODEC_UNSUPPORTED',
  'AUDIO_SDP_INVALID',
  'AUDIO_CHANNEL_FAILED',
  'AUDIO_SEND_FAILED',
  'CALL_MEDIA_PORTS_UNAVAILABLE',
]);

/** Floor channel failures the user should hear about: PTT cannot work at all. */
export const USER_FACING_FLOOR_ERRORS: ReadonlySet<McSdkError> = new Set<McSdkError>([
  'FLOOR_CHANNEL_FAILED',
  'FLOOR_SDP_INVALID',
  'FLOOR_SEND_FAILED',
]);

/**
 * Why a request or grant ended without the floor, as `STATUS` or
 * `STATUS:REASON`. Undefined for statuses that are not such an ending.
 */
export function floorNoticeFor(e: FloorUpdatedEvent): string | undefined {
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

/** The floor as a call screen shows it — what a floor update changes. */
export interface FloorFields {
  floorState: FloorState;
  /** Who is talking while busy (the SDK's ownerId, a URI). */
  floorOwner?: string;
  /** Our place in the queue while queued. */
  queuePosition?: number;
  /** Why the last request ended without the floor; see floorNoticeFor. */
  floorNotice?: string;
}

/**
 * A call's floor fields after the update [e]. The same for a private call and
 * a group call, which is why it lives here.
 *
 * A notice outlives the update that raised it — an IDLE may follow a DENIED
 * at once, and the user must still get to read why — and is cleared once a new
 * request starts or succeeds. The talker and the queue place are only kept
 * while they apply.
 */
export function floorFieldsAfter(prev: { floorNotice?: string }, e: FloorUpdatedEvent): FloorFields {
  const floorState = mapFloorState(e.status);
  const notice = floorNoticeFor(e);
  return {
    floorState,
    floorOwner:    floorState === 'busy' ? e.ownerId || undefined : undefined,
    queuePosition: floorState === 'queued' ? e.queuePosition : undefined,
    floorNotice:   notice
      ?? (floorState === 'requesting' || floorState === 'granted' ? undefined : prev.floorNotice),
  };
}
