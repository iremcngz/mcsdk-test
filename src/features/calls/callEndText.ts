/**
 * features/calls/callEndText.ts — user-facing text for how a call ended
 * (CallRecord.end), shown after the call and in the call history.
 */

import type { Translations } from '../../core/i18n';
import type { CallEnd } from './types';

/**
 * What ended the call, in words. A specific reason wins over the mode; the
 * mode then says who ended it.
 *
 * A BYE never says why: PJSIP reports 200 "Normal call clearing" for every
 * one, and the SDK does not read a Reason header. So a call the server closes
 * (e.g. its floor-inactivity timer) reads the same as the other user hanging
 * up — "ended by the remote side" is as far as the information goes.
 */
export function callEndText(tr: Translations, end: CallEnd): string {
  switch (end.reason) {
    case 'BUSY':            return tr.callEndBusy;
    case 'UNAVAILABLE':     return tr.callEndUnavailable;
    case 'FORBIDDEN':       return tr.callEndForbidden;
    case 'NO_ANSWER':       return tr.callEndNoAnswer;
    case 'CONNECTION_LOST': return tr.callEndConnectionLost;
    case 'PREEMPTED':       return tr.callEndPreempted;
    default:                break;
  }
  switch (end.mode) {
    case 'CLOSED_LOCALLY':     return tr.callEndLocal;
    case 'REJECTED_LOCALLY':   return tr.callEndRejectedLocal;
    case 'CANCELLED_LOCALLY':  return tr.callEndCancelledLocal;
    case 'CLOSED_REMOTELY':    return tr.callEndRemote;
    case 'REJECTED_REMOTELY':  return tr.callEndDeclined;
    case 'CANCELLED_REMOTELY': return tr.callEndCancelledRemote;
    default:                   return tr.callEndUnknown;
  }
}

/**
 * callEndText plus the SIP status when it adds something: a failure response's
 * code and phrase (e.g. "480 Temporarily Unavailable"). A 2xx is just the BYE.
 */
export function callEndDetail(tr: Translations, end: CallEnd): string {
  const text = callEndText(tr, end);
  const code = end.sipCode ?? 0;
  if (code < 300) return text;
  return end.sipReason ? `${text} (${code} ${end.sipReason})` : `${text} (${code})`;
}

/**
 * True when the call ended without the user doing it here — the endings worth
 * telling them about once the call screen has gone.
 */
export function endedRemotely(end: CallEnd): boolean {
  return end.mode !== 'CLOSED_LOCALLY'
    && end.mode !== 'REJECTED_LOCALLY'
    && end.mode !== 'CANCELLED_LOCALLY';
}
