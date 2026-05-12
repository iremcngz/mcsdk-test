/**
 * db.ts — SQLite database layer via @op-engineering/op-sqlite.
 *
 * Database file: app.db (stored in platform default location)
 *   Android: /data/data/<package>/databases/app.db
 *   iOS:     <sandbox>/Documents/app.db
 *
 * Tables
 * ──────
 *   users(id, username, password, updated_at, last_login_at)
 *     — One row per user.  Credentials are stored in plaintext so they can
 *       be retrieved and forwarded directly to the SDK for authentication.
 *     — last_login_at records the Unix ms timestamp of the most recent login.
 *
 *   contacts(id, name, sip_uri, notes, created_at)
 */

import { open, type DB } from '@op-engineering/op-sqlite';

// ── Singleton ─────────────────────────────────────────────────────────────────

let _db: DB | null = null;

function getDb(): DB {
  if (!_db) {
    _db = open({ name: 'app.db' });
  }
  return _db;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password: string;
  updated_at: number;    // Unix ms — last time credentials were saved
  last_login_at: number; // Unix ms — last time user logged in
}

export interface Contact {
  id: number;
  name: string;
  sip_uri: string;
  notes: string;
  created_at: number; // Unix timestamp ms
}

// ── Migrations ───────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const db = getDb();
  // Migrate: drop users table if it was created with the old hashed schema
  // (password_hash + salt columns). The new schema stores plaintext for SDK use.
  try {
    const info = await db.execute("PRAGMA table_info(users)");
    const cols: string[] = ((info.rows?._array ?? []) as { name: string }[]).map(r => r.name);
    if (cols.length > 0 && !cols.includes('password')) {
      await db.execute('DROP TABLE users');
    }
  } catch {
    // table doesn't exist yet — nothing to migrate
  }
  // users table — one row per user, credentials stored in plaintext for SDK use
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      password      TEXT    NOT NULL,
      updated_at    INTEGER NOT NULL,
      last_login_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Add last_login_at to existing tables that predate this column
  try {
    await db.execute('ALTER TABLE users ADD COLUMN last_login_at INTEGER NOT NULL DEFAULT 0');
  } catch {
    // column already exists — safe to ignore
  }
  // contacts table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      sip_uri    TEXT    NOT NULL,
      notes      TEXT    NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )
  `);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function insertContact(
  name: string,
  sipUri: string,
  notes: string,
): Promise<number> {
  const db = getDb();
  const createdAt = Date.now();
  const result = await db.execute(
    'INSERT INTO contacts (name, sip_uri, notes, created_at) VALUES (?, ?, ?, ?)',
    [name, sipUri, notes, createdAt],
  );
  return result.insertId ?? 0;
}

export async function getAllContacts(): Promise<Contact[]> {
  const db = getDb();
  const result = await db.execute(
    'SELECT id, name, sip_uri, notes, created_at FROM contacts ORDER BY created_at DESC',
  );
  return (result.rows?._array ?? []) as Contact[];
}

const SEED_CONTACTS = [
  { name: 'Alice Johnson',   sipUri: 'sip:alice@mc.example.com',   notes: 'Team Alpha' },
  { name: 'Bob Martinez',    sipUri: 'sip:bob@mc.example.com',     notes: 'Team Bravo' },
  { name: 'Carol White',     sipUri: 'sip:carol@mc.example.com',   notes: 'Dispatch' },
  { name: 'David Kim',       sipUri: 'sip:david@mc.example.com',   notes: 'Team Alpha' },
  { name: 'Eve Nakamura',    sipUri: 'sip:eve@mc.example.com',     notes: 'Command' },
  { name: 'Frank Özdemir',   sipUri: 'sip:frank@mc.example.com',   notes: 'Team Bravo' },
  { name: 'Grace Yıldız',    sipUri: 'sip:grace@mc.example.com',   notes: 'Logistics' },
  { name: 'Hasan Demir',     sipUri: 'sip:hasan@mc.example.com',   notes: 'Security' },
];

export async function seedContacts(): Promise<void> {
  const existing = await getAllContacts();
  if (existing.length > 0) return;
  for (const ct of SEED_CONTACTS) {
    await insertContact(ct.name, ct.sipUri, ct.notes);
  }
}

export async function deleteContact(id: number): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM contacts WHERE id = ?', [id]);
}

export async function clearContacts(): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM contacts');
}

// ── User CRUD ─────────────────────────────────────────────────────────────────

/** Insert or update user credentials and record the current time as last_login_at. */
export async function upsertUser(
  username: string,
  password: string,
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO users (username, password, updated_at, last_login_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password      = excluded.password,
       updated_at    = excluded.updated_at,
       last_login_at = excluded.last_login_at`,
    [username, password, now, now],
  );
}

/** Updates only last_login_at for an existing user (password unchanged). */
export async function recordLogin(username: string): Promise<void> {
  const db = getDb();
  await db.execute(
    'UPDATE users SET last_login_at = ? WHERE username = ?',
    [Date.now(), username],
  );
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const db = getDb();
  const result = await db.execute(
    'SELECT id, username, password, updated_at, last_login_at FROM users WHERE username = ? LIMIT 1',
    [username],
  );
  const rows = (result.rows?._array ?? []) as UserRow[];
  return rows[0] ?? null;
}
