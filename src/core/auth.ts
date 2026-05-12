/**
 * core/auth.ts — Credential storage backed by SQLite.
 *
 * Credentials (username + plaintext password) are stored as-is so they can
 * be retrieved later and passed directly to the SDK for authentication.
 *
 * SQLite location on disk:
 *   Android: /data/data/<package>/databases/app.db
 *   iOS:     <sandbox>/Documents/app.db
 */

import { upsertUser, getUserByUsername, recordLogin } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Credentials {
  username: string;
  password: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save (or update) credentials for later SDK use.
 * If the username already exists, the password is overwritten.
 */
export async function saveCredentials(username: string, password: string): Promise<void> {
  await upsertUser(username, password);
}

/**
 * Record a login event for an already-saved user (updates last_login_at only).
 */
export async function touchLogin(username: string): Promise<void> {
  await recordLogin(username);
}

/**
 * Retrieve stored credentials to pass to the SDK.
 * Returns null if no credentials have been saved for this username.
 */
export async function getCredentials(username: string): Promise<Credentials | null> {
  const row = await getUserByUsername(username);
  if (!row) { return null; }
  return { username: row.username, password: row.password };
}
