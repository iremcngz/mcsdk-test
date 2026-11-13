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
 *
 *   documents(mcid, uri, etag, content, type, fetched_at)
 *     — BMS documents cached from the SDK's onDocumentsUpdated callback.
 *     — PRIMARY KEY (mcid, uri) — unique per user per document URI.
 *     — Index on mcid for fast per-user retrieval.
 *     — Restored to the SDK via setDocuments() before registration.
 */

import { open, type DB } from '@op-engineering/op-sqlite';
import { DocumentType, type McSdkDocument } from '../mcsdk/types';
import { DEFAULT_MCPTT_DOMAIN } from '../features/calls/mcId';

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
  // documents table — BMS docs cached from SDK onDocumentsUpdated callback
  await db.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      mcid       TEXT    NOT NULL,
      uri        TEXT    NOT NULL,
      etag       TEXT    NOT NULL DEFAULT '',
      content    TEXT    NOT NULL DEFAULT '',
      type       INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mcid, uri)
    )
  `);
  // Migrate existing installations that predate type/fetched_at columns
  try { await db.execute('ALTER TABLE documents ADD COLUMN type INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.execute('ALTER TABLE documents ADD COLUMN fetched_at INTEGER NOT NULL DEFAULT 0'); } catch {}
  await db.execute(
    'CREATE INDEX IF NOT EXISTS idx_documents_mcid ON documents(mcid)',
  );
  // call_history table — completed calls
  await db.execute(`
    CREATE TABLE IF NOT EXISTS call_history (
      id                TEXT    PRIMARY KEY,
      contact_name      TEXT    NOT NULL,
      sip_uri           TEXT    NOT NULL,
      direction         TEXT    NOT NULL,
      call_type         TEXT    NOT NULL,
      commencement_mode TEXT    NOT NULL DEFAULT 'auto',
      started_at        INTEGER NOT NULL,
      ended_at          INTEGER NOT NULL,
      duration          INTEGER NOT NULL
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

/**
 * The MCX test server's own users, as the app addresses them: an MC ID and the
 * `sip:mcptt.<id>@<realm>` URI the server names that user by (`toMcpttUri`).
 * `mcuser-111` is the account this app logs in as, so it is in the list too —
 * calling yourself is a usable check that the path works at all.
 */
const SEED_CONTACTS = [
  { name: 'mcuser-111', sipUri: 'sip:mcptt.mcuser-111@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'mcuser-222', sipUri: 'sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'mcuser-333', sipUri: 'sip:mcptt.mcuser-333@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'mcuser-444', sipUri: 'sip:mcptt.mcuser-444@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'mcuser-555', sipUri: 'sip:mcptt.mcuser-555@ims.mnc001.mcc001.3gppnetwork.org' },
  // The server's naming changes after mcuser-555: the rest are `user-11`
  // upwards, not `mcuser-666`. These also carry **no service prefix** on the
  // user part — the server knows them as plain `sip:user-11@<realm>`, not
  // `sip:mcptt.user-11@…`. Do not "normalise" them to the mcuser- form.
  { name: 'user-11', sipUri: 'sip:user-11@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'user-12', sipUri: 'sip:user-12@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'user-13', sipUri: 'sip:user-13@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'user-14', sipUri: 'sip:user-14@ims.mnc001.mcc001.3gppnetwork.org' },
  { name: 'user-15', sipUri: 'sip:user-15@ims.mnc001.mcc001.3gppnetwork.org' },
];

/**
 * The placeholder people the contacts list used to be seeded with (Alice
 * Johnson and the rest). They are gone from SEED_CONTACTS, but a phone that
 * already ran the app still holds those rows, and seedContacts only ever adds —
 * so they are deleted by name once, on the next seed. A row the user typed
 * themselves is untouched: only these exact names go.
 */
const LEGACY_SEED_NAMES = [
  'Alice Johnson', 'Bob Martinez', 'Carol White', 'David Kim',
  'Eve Nakamura', 'Frank Özdemir', 'Grace Yıldız', 'Hasan Demir',
  'Irina Petrova', 'Jean Moreau', 'Kenji Tanaka', 'Li Wei',
  'Maria Silva', 'Omar Hassan',
  // The `mcuser-666`..`mcuser-1010` guesses, which the server does not know:
  // above mcuser-555 its users are `user-11` upwards.
  'mcuser-666', 'mcuser-777', 'mcuser-888', 'mcuser-999', 'mcuser-1010',
];

/** Drops the old placeholder contacts from an installation that predates the MC-ID seed set. */
export async function removeLegacySeedContacts(): Promise<void> {
  const db = getDb();
  const marks = LEGACY_SEED_NAMES.map(() => '?').join(', ');
  await db.execute(`DELETE FROM contacts WHERE name IN (${marks})`, LEGACY_SEED_NAMES);
}

/**
 * The `user-11`..`user-15` contacts were first seeded as `sip:mcptt.user-1x@…`,
 * which the server does not know — it names them without a service prefix. A
 * phone that already ran the app holds those wrong rows, and seedContacts only
 * ever adds, so the URI is corrected in place here. Keyed on name and on the
 * exact wrong URI, so a row the user edited themselves is left alone.
 */
async function fixSeedContactUris(): Promise<void> {
  const db = getDb();
  for (const ct of SEED_CONTACTS) {
    await db.execute(
      'UPDATE contacts SET sip_uri = ? WHERE name = ? AND sip_uri <> ? AND sip_uri = ?',
      [ct.sipUri, ct.name, ct.sipUri, `sip:mcptt.${ct.name}@${DEFAULT_MCPTT_DOMAIN}`],
    );
  }
}

export async function seedContacts(): Promise<void> {
  await removeLegacySeedContacts();
  await fixSeedContactUris();
  const existing = await getAllContacts();
  const existingNames = new Set(existing.map(c => c.name));
  for (const ct of SEED_CONTACTS) {
    if (!existingNames.has(ct.name)) {
      await insertContact(ct.name, ct.sipUri, '');
    }
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

// ── Documents (BMS cache) ──────────────────────────────────────────────────────

/**
 * Upserts a list of BMS documents for a given mcid.
 * Each (mcid, uri) pair is unique — rows are replaced on conflict.
 * Called from SdkContext when the SDK fires onDocumentsUpdated.
 */
export async function saveDocuments(
  mcid: string,
  docs: McSdkDocument[],
): Promise<void> {
  if (docs.length === 0) return;
  const db = getDb();
  for (const doc of docs) {
    await db.execute(
      `INSERT OR REPLACE INTO documents
         (mcid, uri, etag, content, type, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mcid, doc.uri, doc.etag, doc.content, doc.type, doc.fetchedAt],
    );
  }
}

/**
 * Returns all cached BMS documents for the given mcid, ordered by uri.
 * Returns [] when no documents are stored for that user.
 */
export async function getDocumentsByMcId(mcid: string): Promise<McSdkDocument[]> {
  const db = getDb();
  const result = await db.execute(
    'SELECT uri, etag, content, type, fetched_at FROM documents WHERE mcid = ? ORDER BY uri',
    [mcid],
  );
  return ((result.rows?._array ?? []) as {
    uri: string; etag: string; content: string; type: number; fetched_at: number;
  }[]).map(row => ({
    uri:       row.uri,
    etag:      row.etag,
    content:   row.content,
    type:      row.type as DocumentType,
    fetchedAt: row.fetched_at,
  }));
}

/**
 * Returns a Map of all cached BMS documents keyed by mcid.
 * Used by AppContext on startup to pre-load docs for all users before login.
 */
export async function getAllDocuments(): Promise<Map<string, McSdkDocument[]>> {
  const db = getDb();
  const result = await db.execute(
    'SELECT mcid, uri, etag, content, type, fetched_at FROM documents ORDER BY mcid, uri',
  );
  const rows = (result.rows?._array ?? []) as {
    mcid: string; uri: string; etag: string; content: string; type: number; fetched_at: number;
  }[];
  const map = new Map<string, McSdkDocument[]>();
  for (const row of rows) {
    const doc: McSdkDocument = {
      uri:       row.uri,
      etag:      row.etag,
      content:   row.content,
      type:      row.type as DocumentType,
      fetchedAt: row.fetched_at,
    };
    const existing = map.get(row.mcid) ?? [];
    existing.push(doc);
    map.set(row.mcid, existing);
  }
  return map;
}

/**
 * Deletes all cached BMS documents for the given mcid.
 * Useful on logout or when a fresh fetch is forced.
 */
export async function clearDocumentsByMcId(mcid: string): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM documents WHERE mcid = ?', [mcid]);
}

// ── Call history ──────────────────────────────────────────────────────────────

import type { CallRecord } from '../features/calls/types';

export async function saveCallRecord(record: CallRecord): Promise<void> {
  const db = getDb();
  await db.execute(
    `INSERT OR REPLACE INTO call_history
       (id, contact_name, sip_uri, direction, call_type, commencement_mode,
        started_at, ended_at, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id, record.contactName, record.sipUri,
      record.direction, record.callType, record.commencementMode,
      record.startedAt, record.endedAt, record.duration,
    ],
  );
}

export async function getCallHistory(): Promise<CallRecord[]> {
  const db = getDb();
  const result = await db.execute(
    `SELECT id, contact_name, sip_uri, direction, call_type, commencement_mode,
            started_at, ended_at, duration
     FROM call_history
     ORDER BY started_at DESC`,
  );
  return ((result.rows?._array ?? []) as {
    id: string; contact_name: string; sip_uri: string;
    direction: string; call_type: string; commencement_mode: string;
    started_at: number; ended_at: number; duration: number;
  }[]).map(r => ({
    id:              r.id,
    contactName:     r.contact_name,
    sipUri:          r.sip_uri,
    direction:       r.direction as CallRecord['direction'],
    callType:        r.call_type as CallRecord['callType'],
    commencementMode: r.commencement_mode as CallRecord['commencementMode'],
    startedAt:       r.started_at,
    endedAt:         r.ended_at,
    duration:        r.duration,
  }));
}

export async function clearCallHistory(): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM call_history');
}
