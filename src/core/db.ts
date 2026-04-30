/**
 * db.ts — SQLite database layer via @op-engineering/op-sqlite.
 *
 * Database file: app.db (stored in platform default location)
 *   Android: /data/data/<package>/databases/app.db
 *   iOS:     <sandbox>/Documents/app.db
 *
 * Tables
 * ──────
 *   contacts(id, name, sip_uri, notes, created_at)
 *     — Demonstrates CREATE / INSERT / SELECT / DELETE on both platforms
 *       with a single shared JS implementation.
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

export async function deleteContact(id: number): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM contacts WHERE id = ?', [id]);
}

export async function clearContacts(): Promise<void> {
  const db = getDb();
  await db.execute('DELETE FROM contacts');
}
