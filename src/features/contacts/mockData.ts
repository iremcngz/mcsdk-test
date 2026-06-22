/**
 * features/contacts/mockData.ts — Deterministic mock presence / call / user
 * data for ContactsScreen, keyed off each contact's id.
 *
 * This is UI placeholder data only — replace with real SDK-backed presence and
 * call history once the native bridge exposes it.
 */

import type { ThemePalette } from '../../core/theme';
import type { PresenceStatus, CallStatus, ContactCallType } from './types';

export function mockPresence(id: number): PresenceStatus {
  const statuses: PresenceStatus[] = ['online', 'busy', 'away', 'offline'];
  return statuses[id % statuses.length];
}

export function makePresenceColors(c: ThemePalette): Record<PresenceStatus, string> {
  return {
    online:  c.success,
    busy:    c.error,
    away:    c.warn,
    offline: c.presenceOffline,
  };
}

export function mockCallStatus(id: number): CallStatus {
  const statuses: CallStatus[] = ['idle', 'active', 'missed', 'ended'];
  return statuses[(id * 2) % statuses.length];
}

export function mockCallType(id: number): ContactCallType {
  const types: ContactCallType[] = ['half_duplex', 'full_duplex', 'none'];
  return types[id % types.length];
}

export function mockLastCallDate(id: number): Date {
  const now = Date.now();
  const offsets = [0, 3600000, 86400000, 172800000, 604800000];
  return new Date(now - offsets[id % offsets.length]);
}

export function mockLastOnline(id: number): Date {
  const now = Date.now();
  const offsets = [300000, 3600000, 43200000, 86400000, 172800000];
  return new Date(now - offsets[id % offsets.length]);
}

export function mockUserStatus(id: number): PresenceStatus {
  const statuses: PresenceStatus[] = ['online', 'away', 'busy', 'offline'];
  return statuses[(id * 3) % statuses.length];
}
