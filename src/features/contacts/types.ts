/**
 * features/contacts/types.ts — Types for the Contacts feature UI.
 *
 * Presence / call-info / user-info here are display-only mock concepts (see
 * mockData.ts); they are not yet backed by the SDK.
 */

import type { CallType } from '../calls/types';

export type ContactFilter = 'all' | 'people' | 'groups';

/** A synthetic "group" row shown alongside real contacts in the list. */
export interface GroupItem {
  id: number;
  name: string;
  sip_uri: string;
  notes: string;
  created_at: number;
  __isGroup: true;
}

export type PresenceStatus = 'online' | 'busy' | 'away' | 'offline';

export type CallStatus = 'idle' | 'active' | 'missed' | 'ended';

/**
 * Duplex mode of a contact's most recent call. Extends the canonical call
 * CallType with 'none' for "no call recorded" — distinct from CallType, which
 * only describes an actual in-progress call.
 */
export type ContactCallType = CallType | 'none';

export interface CallInfo {
  callStatus: CallStatus;
  callType: ContactCallType;
  lastCall: Date | null;
}

export interface UserInfo {
  userStatus: PresenceStatus;
  lastOnline: Date | null;
}
