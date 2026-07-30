/**
 * __tests__/sdk-documents-pipeline.test.ts
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/sdk-documents-pipeline.test.ts                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Tests the document pipeline between AppContext, SdkContext, and the DB:
 *   1. onDocumentsUpdated event: saveDocuments() + updateCachedDocs() both called
 *   2. handleInit() reads docs from cachedDocsMap (not DB) and calls setDocuments()
 *   3. getAllDocuments() result shape
 */

// ── Native event emitter mock ─────────────────────────────────────────────────

type Listener = (data: any) => void;
const eventListeners = new Map<string, Listener[]>();

const mockEmitter = {
    addListener: jest.fn((event: string, listener: Listener) => {
        if (!eventListeners.has(event)) { eventListeners.set(event, []); }
        eventListeners.get(event)!.push(listener);
        return { remove: jest.fn() };
    }),
};

function emitNative(event: string, data: any): void {
    (eventListeners.get(event) ?? []).forEach(fn => fn(data));
}

jest.mock('react-native', () => ({
    NativeEventEmitter: jest.fn(() => mockEmitter),
}));

// ── NativeMcSdk mock ──────────────────────────────────────────────────────────

jest.mock('../src/mcsdk/NativeMcSdk', () => {
    const mock = {
        create:          jest.fn(),
        destroy:         jest.fn(),
        setParams:       jest.fn(),
        init:            jest.fn().mockResolvedValue(true),
        setIdentity:     jest.fn(),
        setDocuments:    jest.fn(),
        register:        jest.fn(),
        unregister:      jest.fn(),
        addListener:     jest.fn(),
        removeListeners: jest.fn(),
        listMetrics:     jest.fn().mockReturnValue(''),
        listAlarms:      jest.fn().mockReturnValue(''),
        raiseAlarm:      jest.fn(),
        resolveAlarm:    jest.fn(),
        createData:      jest.fn(),
        updateData:      jest.fn(),
        deleteData:      jest.fn(),
        getData:         jest.fn().mockReturnValue(''),
        importData:      jest.fn(),
        exportData:      jest.fn().mockReturnValue(''),
        fetchDocument:   jest.fn(),
        startPrivateCall: jest.fn(),
        startGroupCall: jest.fn(),
        answerCall: jest.fn(),
        rejectCall: jest.fn(),
        terminateCall: jest.fn(),
        requestFloor: jest.fn(),
        releaseFloor: jest.fn(),
        selectCall: jest.fn(),
        muteMicrophone: jest.fn(),
        sendSds:         jest.fn(),
    };
    return { __esModule: true, default: mock };
});

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockSaveDocuments   = jest.fn().mockResolvedValue(undefined);
const mockGetAllDocuments = jest.fn().mockResolvedValue(new Map());

jest.mock('../src/core/db', () => ({
    initDb:               jest.fn().mockResolvedValue(undefined),
    saveDocuments:        (...args: any[]) => mockSaveDocuments(...args),
    getAllDocuments:       (...args: any[]) => mockGetAllDocuments(...args),
    getDocumentsByMcId:   jest.fn().mockResolvedValue([]),
    clearDocumentsByMcId: jest.fn().mockResolvedValue(undefined),
    insertContact:        jest.fn().mockResolvedValue(1),
    getAllContacts:        jest.fn().mockResolvedValue([]),
    deleteContact:        jest.fn().mockResolvedValue(undefined),
    clearContacts:        jest.fn().mockResolvedValue(undefined),
    seedContacts:         jest.fn().mockResolvedValue(undefined),
    upsertUser:           jest.fn().mockResolvedValue(undefined),
    recordLogin:          jest.fn().mockResolvedValue(undefined),
    getUserByUsername:    jest.fn().mockResolvedValue(null),
    saveCallRecord:       jest.fn().mockResolvedValue(undefined),
    getCallHistory:       jest.fn().mockResolvedValue([]),
    clearCallHistory:     jest.fn().mockResolvedValue(undefined),
}));

// ── Auth / settings / logger mocks ────────────────────────────────────────────

jest.mock('../src/core/auth', () => ({
    getCredentials:  jest.fn().mockResolvedValue({ username: 'alice@mc.example.com', password: 'pass' }),
    saveCredentials: jest.fn().mockResolvedValue(undefined),
    touchLogin:      jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/core/settings', () => ({
    SdkSettings: {
        load: jest.fn().mockReturnValue({
            logEnabled: false, logLevel: '2', pjLogEnabled: false, pjLogLevel: '2',
            rxTxEnabled: false, httpPort: '8008', sipUdpPort: '5060',
            sipTcpEnabled: false, sipTcpPort: '5060', sipTlsEnabled: false,
            sipTlsPort: '5061', sipIpv6Enabled: false, mTlsEnabled: false,
            certPath: '', privKeyPath: '', caListPath: '',
            sipRxThreads: '1', sipWorkerThreads: '1',
        }),
        save: jest.fn(),
    },
    AuthSettings: {
        getLastUsername:  jest.fn().mockReturnValue('alice@mc.example.com'),
        getStayLoggedIn:  jest.fn().mockReturnValue(false),
        getIsLoggedIn:    jest.fn().mockReturnValue(false),
        setIsLoggedIn:    jest.fn(),
        setLastUsername:  jest.fn(),
        setStayLoggedIn:  jest.fn(),
    },
    AppSettings:         { getTheme: jest.fn().mockReturnValue('dark'), setTheme: jest.fn(), getLanguage: jest.fn().mockReturnValue('en'), setLanguage: jest.fn() },
    LogRotationSettings: { load: jest.fn().mockReturnValue({ maxFileSize: 5, maxFiles: 3 }), save: jest.fn() },
    initUserStorage:     jest.fn(),
    clearUserStorage:    jest.fn(),
}));

jest.mock('../src/core/logger', () => ({
    configureLogger: jest.fn().mockResolvedValue(undefined),
    AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    SdkLogger:  { write: jest.fn() },
}));

jest.mock('../src/core/netMonitor', () => ({
    useIpMonitor: jest.fn().mockReturnValue({ ip: '127.0.0.1', type: 'wifi' }),
}));

// ── AppContext mock — uses module-level `mock`-prefixed vars (Jest requirement)─

// These are intentionally prefixed with `mock` so Jest allows referencing them
// inside jest.mock() factory closures (babel hoisting safety rule).
let mockCachedDocsMap: Map<string, import('../src/mcsdk/types').McSdkDocument[]> = new Map();
const mockUpdateCachedDocs = jest.fn();

jest.mock('../src/contexts/AppContext', () => ({
    useAppContext: jest.fn(() => ({
        cachedDocsMap:    mockCachedDocsMap,
        updateCachedDocs: mockUpdateCachedDocs,
        tr:   { ipChanged: (p: string, c: string) => `${p} → ${c}` },
        c:    {},
        theme: 'dark', language: 'en',
        maxFileSize: 5, maxFiles: 3,
        isLoggedIn: true, stayLoggedIn: false,
    })),
}));

// ── Actual imports ────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { DocumentType, type McSdkDocument } from '../src/mcsdk/types';
import NativeMcSdk from '../src/mcsdk/NativeMcSdk';
import { SdkContextProvider, useSdkContext } from '../src/contexts/SdkContext';

const MockNative = NativeMcSdk as jest.Mocked<typeof NativeMcSdk>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALICE_MCID = 'alice@mc.example.com';

const DOC_A: McSdkDocument = {
    uri:       'http://bms.example.com/ue-init',
    etag:      '"etag-a"',
    content:   '<UeInit/>',
    type:      DocumentType.UeInitialConfig,
    fetchedAt: 1700000000000,
};
const DOC_B: McSdkDocument = {
    uri:       'http://bms.example.com/ue-config',
    etag:      '"etag-b"',
    content:   '<UeConfig/>',
    type:      DocumentType.UeInitConfig,
    fetchedAt: 1700000001000,
};

const sdkWrapper = ({ children }: any) =>
    React.createElement(SdkContextProvider, null, children);

// =============================================================================
// 1.  onDocumentsUpdated pipeline
//     When the SDK fires McSdkStoreDocuments:
//       • saveDocuments() is called with (mcId, docs)
//       • updateCachedDocs() is called with (mcId, docs)
// =============================================================================

describe('onDocumentsUpdated pipeline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventListeners.clear();
        mockCachedDocsMap = new Map();
    });

    it('saveDocuments is called with mcId and incoming docs', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });

        await act(async () => {
            emitNative('McSdkStoreDocuments', { docsJson: JSON.stringify([DOC_A, DOC_B]) });
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(mockSaveDocuments).toHaveBeenCalledWith(ALICE_MCID, [DOC_A, DOC_B]);
    });

    it('updateCachedDocs is called with mcId and incoming docs', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });

        await act(async () => {
            emitNative('McSdkStoreDocuments', { docsJson: JSON.stringify([DOC_A]) });
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(mockUpdateCachedDocs).toHaveBeenCalledWith(ALICE_MCID, [DOC_A]);
    });

    it('saveDocuments and updateCachedDocs are both called in same event', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });

        await act(async () => {
            emitNative('McSdkStoreDocuments', { docsJson: JSON.stringify([DOC_A]) });
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(mockSaveDocuments).toHaveBeenCalledTimes(1);
        expect(mockUpdateCachedDocs).toHaveBeenCalledTimes(1);
    });
});

// =============================================================================
// 2.  handleInit uses cachedDocsMap (not DB query)
//     When handleInit() runs with pre-loaded docs in cachedDocsMap:
//       • NativeMcSdk.setDocuments is called with the JSON of those docs
//       • getDocumentsByMcId (DB query) is NOT called
// =============================================================================

describe('handleInit uses cachedDocsMap', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventListeners.clear();
        MockNative.init.mockResolvedValue(true);
        // Pre-populate cachedDocsMap for alice
        mockCachedDocsMap = new Map([[ALICE_MCID, [DOC_A, DOC_B]]]);
    });

    it('calls NativeMcSdk.setDocuments with docs from cachedDocsMap', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });
        await act(async () => { await result.current.handleInit(); });

        expect(MockNative.setDocuments).toHaveBeenCalledTimes(1);
        const arg = MockNative.setDocuments.mock.calls[0][0] as string;
        const parsed = JSON.parse(arg);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].uri).toBe(DOC_A.uri);
        expect(parsed[1].uri).toBe(DOC_B.uri);
    });

    it('docs passed to setDocuments carry numeric type and fetchedAt', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });
        await act(async () => { await result.current.handleInit(); });

        const arg = MockNative.setDocuments.mock.calls[0][0] as string;
        const parsed = JSON.parse(arg);
        expect(typeof parsed[0].type).toBe('number');
        expect(parsed[0].type).toBe(DocumentType.UeInitialConfig);
        expect(typeof parsed[0].fetchedAt).toBe('number');
        expect(parsed[0].fetchedAt).toBe(1700000000000);
    });

    it('does NOT call getDocumentsByMcId (DB query bypassed)', async () => {
        const { getDocumentsByMcId } = require('../src/core/db');
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });
        await act(async () => { await result.current.handleInit(); });

        expect(getDocumentsByMcId).not.toHaveBeenCalled();
    });

    it('does NOT call setDocuments when cachedDocsMap has no docs for mcId', async () => {
        mockCachedDocsMap = new Map(); // empty — no docs for alice
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });
        await act(async () => { await result.current.handleInit(); });

        expect(MockNative.setDocuments).not.toHaveBeenCalled();
    });
});

// =============================================================================
// 3.  getAllDocuments flow — Map shape verification
// =============================================================================

describe('getAllDocuments output shape', () => {
    it('returns empty Map when DB is empty', async () => {
        mockGetAllDocuments.mockResolvedValueOnce(new Map());
        const result = await mockGetAllDocuments();
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('groups docs by mcid', async () => {
        const map = new Map([
            [ALICE_MCID,           [DOC_A, DOC_B]],
            ['bob@mc.example.com', [DOC_B]],
        ]);
        mockGetAllDocuments.mockResolvedValueOnce(map);
        const result = await mockGetAllDocuments();
        expect(result.get(ALICE_MCID)).toHaveLength(2);
        expect(result.get('bob@mc.example.com')).toHaveLength(1);
    });

    it('docs carry numeric type and fetchedAt', async () => {
        const map = new Map([[ALICE_MCID, [DOC_A]]]);
        mockGetAllDocuments.mockResolvedValueOnce(map);
        const result = await mockGetAllDocuments();
        const doc = result.get(ALICE_MCID)![0];
        expect(doc.type).toBe(DocumentType.UeInitialConfig);
        expect(doc.fetchedAt).toBe(1700000000000);
    });
});

