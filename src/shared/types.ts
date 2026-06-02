/**
 * shared/types.ts — Shared type definitions used across features and contexts.
 */

export interface LogEntry {
  id: number;
  time: string;
  msg: string;
  level: 'info' | 'warn' | 'error' | 'sdk';
}

export interface SdkLogEntry {
  id: number;
  time: string;
  level: number;
  msg: string;
}

export type Screen = 'home' | 'metrics' | 'sdklogs' | 'settings' | 'contacts' | 'calls' | 'talk';
