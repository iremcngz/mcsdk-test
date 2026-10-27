/**
 * features/calls/floorText.ts — user-facing text for the floor state, shared by
 * ActiveCallCard and ActiveCallFullScreen.
 */

import { useEffect, useState } from 'react';
import type { Translations } from '../../core/i18n';
import type { ActiveCall } from './types';
import { displayMcId } from './mcId';

/** How long a floor notice stays on screen. */
export const FLOOR_NOTICE_MS = 4000;

/**
 * Who is talking, for the line under the PTT button while the floor is busy.
 * The button itself already says requesting/queued/granted.
 */
export function floorTalkerText(tr: Translations, call: ActiveCall): string {
  return call.floorOwner ? tr.floorTalker(displayMcId(call.floorOwner)) : tr.floorChannelBusy;
}

/**
 * Text for a CallContext floorNotice (`STATUS`, `STATUS:REASON` or
 * `ERROR:<SdkError>`). Reasons without a text of their own fall back to the
 * generic denied/revoked line, so a new SDK reason still reads sensibly.
 */
export function floorNoticeText(tr: Translations, notice: string | undefined): string | undefined {
  if (!notice) return undefined;
  const [kind, reason] = notice.split(':');
  switch (kind) {
    case 'DENIED':
      switch (reason) {
        case 'ANOTHER_CLIENT_HAS_PERMISSION': return tr.floorDeniedOtherTalker;
        case 'RECEIVE_ONLY':                  return tr.floorDeniedReceiveOnly;
        case 'QUEUE_FULL':                    return tr.floorDeniedQueueFull;
        case 'RETRY_AFTER_NOT_EXPIRED':       return tr.floorDeniedRetryLater;
        default:                              return tr.floorDenied;
      }
    case 'REVOKED':
      switch (reason) {
        case 'MEDIA_BURST_TOO_LONG':  return tr.floorRevokedTooLong;
        case 'MEDIA_BURST_PREEMPTED': return tr.floorRevokedPreempted;
        default:                      return tr.floorRevoked;
      }
    case 'REQUEST_TIMEOUT': return tr.floorRequestTimeout;
    case 'QUEUE_TIMEOUT':   return tr.floorQueueTimeout;
    case 'GRANT_EXPIRED':   return tr.floorGrantExpired;
    case 'ERROR':           return tr.floorErrorUnreachable;
    default:                return undefined;
  }
}

/**
 * Shows `text` for FLOOR_NOTICE_MS each time it changes, then hides it.
 * CallContext clears the notice when the next request starts, so the same
 * notice raised twice in a row still shows twice.
 */
export function useTransientText(text: string | undefined): string | undefined {
  const [shown, setShown] = useState<string | undefined>(undefined);
  useEffect(() => {
    setShown(text);
    if (!text) return;
    const t = setTimeout(() => setShown(undefined), FLOOR_NOTICE_MS);
    return () => clearTimeout(t);
  }, [text]);
  return shown;
}
