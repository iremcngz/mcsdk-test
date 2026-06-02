/**
 * __tests__/documents-db.test.ts — Documents DB layer tests (new schema).
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/documents-db.test.ts                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Tests the updated documents table: {mcid, uri, etag, content, type, fetched_at}
 * Uses the in-memory @op-engineering/op-sqlite mock.
 */

// Types only — re-require `db` after resetModules in beforeEach
import type * as DbModule from '../src/core/db';
import { DocumentType, type McSdkDocument } from '../src/mcsdk/types';

// Shared fixtures
const DOC_UE_INIT: McSdkDocument = {
    uri:       'http://bms.example.com/ue-init',
    etag:      '"etag-1"',
    content:   '<UeInit/>',
    type:      DocumentType.UeInit,
    fetchedAt: 1700000000000,
};
const DOC_UE_CONFIG: McSdkDocument = {
    uri:       'http://bms.example.com/ue-config',
    etag:      '"etag-2"',
    content:   '<UeConfig/>',
    type:      DocumentType.UeConfig,
    fetchedAt: 1700000001000,
};
const DOC_USER_PROFILE: McSdkDocument = {
    uri:       'http://bms.example.com/user-profile',
    etag:      '"etag-3"',
    content:   '<UserProfile/>',
    type:      DocumentType.UserProfile,
    fetchedAt: 1700000002000,
};

let db: typeof DbModule;

beforeEach(async () => {
    // Reset module singleton so each test gets a fresh in-memory DB
    jest.resetModules();
    db = require('../src/core/db');
    await db.initDb();
});

// =============================================================================
// 1.  saveDocuments — write new schema fields
// =============================================================================

describe('saveDocuments — new schema', () => {
    it('saves a single document with all new fields', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT]);
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        expect(docs).toHaveLength(1);
        expect(docs[0]).toEqual(DOC_UE_INIT);
    });

    it('saves multiple documents for one mcid', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT, DOC_UE_CONFIG]);
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        expect(docs).toHaveLength(2);
    });

    it('is a no-op for empty array', async () => {
        await expect(db.saveDocuments('alice@mc.example.com', [])).resolves.toBeUndefined();
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        expect(docs).toHaveLength(0);
    });

    it('replaces on (mcid, uri) conflict — upsert semantics', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT]);
        const updated: McSdkDocument = { ...DOC_UE_INIT, etag: '"etag-updated"', fetchedAt: 9999 };
        await db.saveDocuments('alice@mc.example.com', [updated]);
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        expect(docs).toHaveLength(1);
        expect(docs[0].etag).toBe('"etag-updated"');
        expect(docs[0].fetchedAt).toBe(9999);
    });

    it('does NOT mix documents between different mcids', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT]);
        await db.saveDocuments('bob@mc.example.com', [DOC_UE_CONFIG]);
        const aliceDocs = await db.getDocumentsByMcId('alice@mc.example.com');
        const bobDocs   = await db.getDocumentsByMcId('bob@mc.example.com');
        expect(aliceDocs).toHaveLength(1);
        expect(bobDocs).toHaveLength(1);
        expect(aliceDocs[0].uri).toBe(DOC_UE_INIT.uri);
        expect(bobDocs[0].uri).toBe(DOC_UE_CONFIG.uri);
    });
});

// =============================================================================
// 2.  getDocumentsByMcId — field mapping and type casting
// =============================================================================

describe('getDocumentsByMcId — field mapping', () => {
    beforeEach(async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT, DOC_UE_CONFIG, DOC_USER_PROFILE]);
    });

    it('returns all docs for the given mcid', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        expect(docs).toHaveLength(3);
    });

    it('maps uri correctly', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        const uris = docs.map(d => d.uri).sort();
        expect(uris).toContain(DOC_UE_INIT.uri);
        expect(uris).toContain(DOC_UE_CONFIG.uri);
        expect(uris).toContain(DOC_USER_PROFILE.uri);
    });

    it('maps etag correctly', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        const doc = docs.find(d => d.uri === DOC_UE_INIT.uri);
        expect(doc?.etag).toBe(DOC_UE_INIT.etag);
    });

    it('maps content correctly', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        const doc = docs.find(d => d.uri === DOC_UE_INIT.uri);
        expect(doc?.content).toBe(DOC_UE_INIT.content);
    });

    it('casts type as DocumentType enum integer', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        const ueInit = docs.find(d => d.uri === DOC_UE_INIT.uri);
        expect(ueInit?.type).toBe(DocumentType.UeInit);
        expect(typeof ueInit?.type).toBe('number');
    });

    it('maps fetchedAt (fetched_at column) to camelCase field', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        const doc = docs.find(d => d.uri === DOC_UE_INIT.uri);
        expect(doc?.fetchedAt).toBe(DOC_UE_INIT.fetchedAt);
    });

    it('returned objects do NOT contain old schema fields (timestamp, org, size)', async () => {
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        const doc = docs[0] as any;
        expect(doc.timestamp).toBeUndefined();
        expect(doc.org).toBeUndefined();
        expect(doc.size).toBeUndefined();
    });

    it('returns [] for an unknown mcid', async () => {
        const docs = await db.getDocumentsByMcId('nobody@mc.example.com');
        expect(docs).toEqual([]);
    });
});

// =============================================================================
// 3.  getAllDocuments — multi-user Map
// =============================================================================

describe('getAllDocuments — multi-user Map', () => {
    it('returns an empty Map when no documents exist', async () => {
        const map = await db.getAllDocuments();
        expect(map.size).toBe(0);
    });

    it('returns docs for a single user', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT]);
        const map = await db.getAllDocuments();
        expect(map.size).toBe(1);
        expect(map.has('alice@mc.example.com')).toBe(true);
        expect(map.get('alice@mc.example.com')).toHaveLength(1);
    });

    it('returns docs grouped by mcid for multiple users', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT, DOC_UE_CONFIG]);
        await db.saveDocuments('bob@mc.example.com',   [DOC_USER_PROFILE]);
        const map = await db.getAllDocuments();
        expect(map.size).toBe(2);
        expect(map.get('alice@mc.example.com')).toHaveLength(2);
        expect(map.get('bob@mc.example.com')).toHaveLength(1);
    });

    it('docs in Map have correct field mapping (type, fetchedAt)', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT]);
        const map = await db.getAllDocuments();
        const doc = map.get('alice@mc.example.com')![0];
        expect(doc.type).toBe(DocumentType.UeInit);
        expect(doc.fetchedAt).toBe(DOC_UE_INIT.fetchedAt);
        expect(doc.uri).toBe(DOC_UE_INIT.uri);
    });

    it('returns a Map instance (not a plain object)', async () => {
        const map = await db.getAllDocuments();
        expect(map).toBeInstanceOf(Map);
    });

    it('each get() returns an array (not null/undefined)', async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT]);
        const map = await db.getAllDocuments();
        expect(Array.isArray(map.get('alice@mc.example.com'))).toBe(true);
    });
});

// =============================================================================
// 4.  clearDocumentsByMcId — scoped delete
// =============================================================================

describe('clearDocumentsByMcId', () => {
    beforeEach(async () => {
        await db.saveDocuments('alice@mc.example.com', [DOC_UE_INIT, DOC_UE_CONFIG]);
        await db.saveDocuments('bob@mc.example.com',   [DOC_USER_PROFILE]);
    });

    it('removes all docs for the given mcid', async () => {
        await db.clearDocumentsByMcId('alice@mc.example.com');
        const docs = await db.getDocumentsByMcId('alice@mc.example.com');
        expect(docs).toHaveLength(0);
    });

    it('does NOT remove docs for other mcids', async () => {
        await db.clearDocumentsByMcId('alice@mc.example.com');
        const bobDocs = await db.getDocumentsByMcId('bob@mc.example.com');
        expect(bobDocs).toHaveLength(1);
    });

    it('is idempotent — clearing already-empty mcid is safe', async () => {
        await db.clearDocumentsByMcId('alice@mc.example.com');
        await expect(db.clearDocumentsByMcId('alice@mc.example.com')).resolves.toBeUndefined();
    });
});

// =============================================================================
// 5.  DocumentType enum values
// =============================================================================

describe('DocumentType enum', () => {
    it('Unknown = 0', () => expect(DocumentType.Unknown).toBe(0));
    it('UeInit = 1',  () => expect(DocumentType.UeInit).toBe(1));
    it('UeConfig = 2', () => expect(DocumentType.UeConfig).toBe(2));
    it('UserAdditions = 3', () => expect(DocumentType.UserAdditions).toBe(3));
    it('ServiceConfig = 4', () => expect(DocumentType.ServiceConfig).toBe(4));
    it('UserProfile = 5', () => expect(DocumentType.UserProfile).toBe(5));
    it('GroupProfile = 6', () => expect(DocumentType.GroupProfile).toBe(6));
});
