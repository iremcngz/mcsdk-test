/**
 * __tests__/contacts-db.test.ts — Tests for the contacts layer of db.ts.
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/contacts-db.test.ts          # Only this file       │
 * │  npx jest __tests__/contacts-db.test.ts --watch  # Watch mode           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ WHAT IS TESTED ─────────────────────────────────────────────────────────┐
 * │                                                                          │
 * │  1. seedContacts()                                                       │
 * │     — Inserts exactly 8 contacts when table is empty.                   │
 * │     — Is idempotent: calling twice does not duplicate rows.              │
 * │                                                                          │
 * │  2. getAllContacts()                                                      │
 * │     — Returns [] before any inserts.                                     │
 * │     — Returns all seeded contacts after seedContacts().                  │
 * │                                                                          │
 * │  3. insertContact / deleteContact / clearContacts                        │
 * │     — insertContact returns a positive row id.                           │
 * │     — deleteContact removes only the targeted row.                       │
 * │     — clearContacts empties the table.                                   │
 * │                                                                          │
 * │  4. recordLogin()                                                        │
 * │     — Updates last_login_at for an existing user without touching        │
 * │       the password field.                                                │
 * │     — Does not throw for an unknown username.                            │
 * │                                                                          │
 * │  NOTE: @op-engineering/op-sqlite is replaced by an in-memory mock        │
 * │  (see __mocks__/@op-engineering/op-sqlite.js). jest.isolateModulesAsync  │
 * │  is used so each test gets a fresh module instance (and thus a fresh     │
 * │  in-memory DB), preventing state leakage between tests.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// Modules are required inside jest.isolateModulesAsync() per test so that
// each test begins with an empty in-memory DB (the mock opens a new MockDB
// per open() call, and the singleton _db in db.ts is reset between module
// instances).

// =============================================================================
// 1.  seedContacts
// =============================================================================

describe('seedContacts', () => {
  it('inserts exactly 8 rows when the contacts table is empty', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, seedContacts, getAllContacts } = require('../src/core/db');
      await initDb();
      await seedContacts();
      const rows = await getAllContacts();
      expect(rows).toHaveLength(8);
    });
  });

  it('is idempotent — calling twice still yields exactly 8 rows', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, seedContacts, getAllContacts } = require('../src/core/db');
      await initDb();
      await seedContacts();
      await seedContacts(); // second call should be a no-op
      const rows = await getAllContacts();
      expect(rows).toHaveLength(8);
    });
  });

  it('returns early without inserting when contacts already exist', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact, seedContacts, getAllContacts } = require('../src/core/db');
      await initDb();
      // Pre-populate with 1 manual contact so seedContacts bails early
      await insertContact('Test User', 'sip:test@example.com', '');
      await seedContacts();
      // Still exactly 1 row — the 8 seed contacts were NOT inserted
      const rows = await getAllContacts();
      expect(rows).toHaveLength(1);
    });
  });

  it('seeds contacts with valid name, sip_uri, and notes fields', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, seedContacts, getAllContacts } = require('../src/core/db');
      await initDb();
      await seedContacts();
      const rows = await getAllContacts();
      for (const row of rows) {
        expect(typeof row.name).toBe('string');
        expect(row.name.length).toBeGreaterThan(0);
        expect(row.sip_uri).toMatch(/^sip:/);
        expect(typeof row.notes).toBe('string');
      }
    });
  });

  it('includes expected seed names', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, seedContacts, getAllContacts } = require('../src/core/db');
      await initDb();
      await seedContacts();
      const rows = await getAllContacts();
      const names = rows.map((r: { name: string }) => r.name);
      expect(names).toContain('Alice Johnson');
      expect(names).toContain('Hasan Demir');
    });
  });
});

// =============================================================================
// 2.  getAllContacts
// =============================================================================

describe('getAllContacts', () => {
  it('returns an empty array before any inserts', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, getAllContacts } = require('../src/core/db');
      await initDb();
      const rows = await getAllContacts();
      expect(rows).toEqual([]);
    });
  });

  it('returns all inserted contacts', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact, getAllContacts } = require('../src/core/db');
      await initDb();
      await insertContact('Alpha', 'sip:alpha@test.com', 'notes-a');
      await insertContact('Beta',  'sip:beta@test.com',  'notes-b');
      const rows = await getAllContacts();
      expect(rows).toHaveLength(2);
      const names = rows.map((r: { name: string }) => r.name);
      expect(names).toContain('Alpha');
      expect(names).toContain('Beta');
    });
  });

  it('each row has id, name, sip_uri, notes, created_at', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact, getAllContacts } = require('../src/core/db');
      await initDb();
      await insertContact('Gamma', 'sip:gamma@test.com', 'team');
      const [row] = await getAllContacts();
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('name', 'Gamma');
      expect(row).toHaveProperty('sip_uri', 'sip:gamma@test.com');
      expect(row).toHaveProperty('notes', 'team');
      expect(row).toHaveProperty('created_at');
    });
  });
});

// =============================================================================
// 3.  insertContact / deleteContact / clearContacts
// =============================================================================

describe('insertContact', () => {
  it('returns a positive integer row id', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact } = require('../src/core/db');
      await initDb();
      const id = await insertContact('Delta', 'sip:delta@test.com', '');
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });
  });

  it('each successive insert gets an incremented id', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact } = require('../src/core/db');
      await initDb();
      const id1 = await insertContact('One', 'sip:one@test.com', '');
      const id2 = await insertContact('Two', 'sip:two@test.com', '');
      expect(id2).toBeGreaterThan(id1);
    });
  });
});

describe('deleteContact', () => {
  it('removes only the specified row', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact, deleteContact, getAllContacts } = require('../src/core/db');
      await initDb();
      const id1 = await insertContact('Keep',   'sip:keep@test.com',   '');
      const id2 = await insertContact('Remove', 'sip:remove@test.com', '');
      await deleteContact(id2);
      const rows = await getAllContacts();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(id1);
    });
  });

  it('is a no-op for an unknown id (no throw)', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, deleteContact } = require('../src/core/db');
      await initDb();
      await expect(deleteContact(9999)).resolves.toBeUndefined();
    });
  });
});

describe('clearContacts', () => {
  it('empties the contacts table', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, insertContact, clearContacts, getAllContacts } = require('../src/core/db');
      await initDb();
      await insertContact('A', 'sip:a@test.com', '');
      await insertContact('B', 'sip:b@test.com', '');
      await clearContacts();
      const rows = await getAllContacts();
      expect(rows).toHaveLength(0);
    });
  });

  it('does not throw when table is already empty', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, clearContacts } = require('../src/core/db');
      await initDb();
      await expect(clearContacts()).resolves.toBeUndefined();
    });
  });
});

// =============================================================================
// 4.  recordLogin
// =============================================================================

describe('recordLogin', () => {
  it('updates last_login_at without changing password', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, upsertUser, recordLogin, getUserByUsername } = require('../src/core/db');
      await initDb();
      await upsertUser('tester', 'secret-pw');
      const before = await getUserByUsername('tester');

      // Advance time by a tick so the timestamp can differ
      await new Promise(r => setTimeout(r, 5));
      await recordLogin('tester');

      const after = await getUserByUsername('tester');
      // Password must be unchanged
      expect(after!.password).toBe('secret-pw');
      // last_login_at must be at least as recent as before
      expect(after!.last_login_at).toBeGreaterThanOrEqual(before!.last_login_at);
    });
  });

  it('does not throw for an unknown username', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, recordLogin } = require('../src/core/db');
      await initDb();
      await expect(recordLogin('nobody')).resolves.toBeUndefined();
    });
  });
});
