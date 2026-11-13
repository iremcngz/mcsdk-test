/**
 * __tests__/sdk-start-all.test.ts
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/sdk-start-all.test.ts                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * SdkContext.handleStartAll — the one-press bring-up behind Home's "Start All"
 * button, which runs Create → Set Parameters → Init in that order.
 *
 * What is worth pinning down here is the sequencing, not the three steps
 * themselves (they have their own buttons and their own coverage):
 *
 *   1. All three native calls happen, in order, from a single press.
 *   2. It works in ONE tick. The steps guard on sdkRef.current, which Create
 *      assigns synchronously; if someone later reroutes those guards through
 *      React state (`created`, `paramsSet`), the chain silently stops after
 *      Create and this test is what catches it.
 *   3. An already-created SDK is not recreated — create() must not run twice,
 *      since the native SDK is a process-level singleton.
 *   4. An already-initialised SDK is left alone entirely.
 */

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
    // handleCreate reads this to pass a stable client id to setIdentity().
    DeviceIdentity:      { getMcClientId: jest.fn().mockReturnValue('urn:uuid:test-client-id'), resetMcClientId: jest.fn() },
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
import NativeMcSdk from '../src/mcsdk/NativeMcSdk';
import { SdkContextProvider, useSdkContext } from '../src/contexts/SdkContext';

const MockNative = NativeMcSdk as jest.Mocked<typeof NativeMcSdk>;

const sdkWrapper = ({ children }: any) =>
    React.createElement(SdkContextProvider, null, children);

describe('handleStartAll', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        eventListeners.clear();
        mockCachedDocsMap = new Map();
        MockNative.init.mockResolvedValue(true);
    });

    it('runs create, setParams and init from a single press', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });

        await act(async () => { await result.current.handleStartAll(); });

        expect(MockNative.create).toHaveBeenCalledTimes(1);
        expect(MockNative.setParams).toHaveBeenCalledTimes(1);
        expect(MockNative.init).toHaveBeenCalledTimes(1);
    });

    it('calls them in order — setParams after create, init last', async () => {
        const order: string[] = [];
        MockNative.create.mockImplementation(() => { order.push('create'); });
        MockNative.setParams.mockImplementation(() => { order.push('setParams'); });
        MockNative.init.mockImplementation(() => { order.push('init'); return Promise.resolve(true); });

        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleStartAll(); });

        expect(order).toEqual(['create', 'setParams', 'init']);
    });

    it('reaches the three lifecycle states', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleStartAll(); });

        expect(result.current.created).toBe(true);
        expect(result.current.paramsSet).toBe(true);
        expect(result.current.initialized).toBe(true);
    });

    it('registers after init, so one press reaches a registering SDK', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleStartAll(); });

        // Init's own follow-through: identity then register. Without it the
        // button would stop one step short of what the three buttons achieve.
        expect(MockNative.setIdentity).toHaveBeenCalledTimes(1);
        expect(MockNative.register).toHaveBeenCalledTimes(1);
    });

    it('does not create a second SDK when one already exists', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleCreate(); });
        expect(MockNative.create).toHaveBeenCalledTimes(1);

        // Picks up where Create left off rather than recreating: the native SDK
        // owns process-level singletons that cannot be re-initialised.
        await act(async () => { await result.current.handleStartAll(); });

        expect(MockNative.create).toHaveBeenCalledTimes(1);
        expect(MockNative.setParams).toHaveBeenCalledTimes(1);
        expect(MockNative.init).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the SDK is already initialised', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleStartAll(); });
        jest.clearAllMocks();

        await act(async () => { await result.current.handleStartAll(); });

        expect(MockNative.create).not.toHaveBeenCalled();
        expect(MockNative.setParams).not.toHaveBeenCalled();
        expect(MockNative.init).not.toHaveBeenCalled();
    });

    it('does not warn that parameters are unset — it just set them', async () => {
        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleStartAll(); });

        // `paramsSet` is React state and is still false inside this tick, so the
        // plain init() guard would accuse the press of skipping step 2.
        const warned = result.current.logs.some(l => l.msg.includes('setParams() not called yet'));
        expect(warned).toBe(false);
    });

    it('does not register when init() reports failure', async () => {
        MockNative.init.mockResolvedValue(false);

        const { result } = renderHook(() => useSdkContext(), { wrapper: sdkWrapper });
        await act(async () => { await result.current.handleStartAll(); });

        // init() returning false is reported, and nothing after it runs.
        expect(result.current.initialized).toBe(false);
        expect(MockNative.register).not.toHaveBeenCalled();
    });
});
