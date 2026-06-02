/**
 * __tests__/mcsdk-bridge.test.ts — McSdk.setDocuments + onStoreDocuments JS-layer tests.
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/mcsdk-bridge.test.ts          # Only this file      │
 * │  npx jest __tests__/mcsdk-bridge.test.ts --watch  # Watch mode          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ WHAT IS TESTED ─────────────────────────────────────────────────────────┐
 * │                                                                          │
 * │  setDocuments(docs: McSdkDocument[])                                     │
 * │                                                                          │
 * │  Android flow (✅ nativeSetDocuments exists in libmcsdk.so):             │
 * │    JS McSdk.setDocuments(docs)                                           │
 * │      → NativeMcSdk.setDocuments(JSON.stringify(docs))  [TurboModule]    │
 * │      → McSdkModule.kt @ReactMethod setDocuments(docsJson: String)        │
 * │      → JSON.parse → List<Document> → sdk?.setDocuments(docs)            │
 * │      → McSdk.java → nativeSetDocuments(docsJson) [JNI → C++]           │
 * │      → C++ Sdk::SetDocuments(docs)                                      │
 * │                                                                          │
 * │  iOS flow (❌ xcframework has NO setDocuments yet):                      │
 * │    JS McSdk.setDocuments(docs)                                           │
 * │      → NativeMcSdk.setDocuments(JSON.stringify(docs))  [TurboModule]    │
 * │      → McSdkModule.mm RCT_EXPORT_METHOD(setDocuments:)                  │
 * │      → NSLog only — NO gSdk call (no-op stub)                           │
 * │                                                                          │
 * │  onStoreDocuments(handler) — event subscription:                         │
 * │    SDK fires McSdkStoreDocuments { docsJson: string }                   │
 * │    JS wrapper parses docsJson → calls handler({ docs: McSdkDocument[] })│
 * │                                                                          │
 * │  Test sections:                                                          │
 * │    1. JS layer — setDocuments wrapper correctness                        │
 * │    2. Android platform contract — JSON-string single arg                 │
 * │    3. iOS platform contract — no-op bridge requirements                  │
 * │    4. onStoreDocuments — subscription + JSON parsing                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// ── Mock: NativeEventEmitter ──────────────────────────────────────────────────
// Intercept addListener calls so we can fire synthetic events in Section 4.

type Listener = (data: any) => void;
const eventListeners = new Map<string, Listener[]>();

const mockEmitter = {
    addListener: jest.fn((event: string, listener: Listener) => {
        if (!eventListeners.has(event)) { eventListeners.set(event, []); }
        eventListeners.get(event)!.push(listener);
        return { remove: jest.fn() };
    }),
};

function emitNativeEvent(event: string, data: any): void {
    (eventListeners.get(event) ?? []).forEach(fn => fn(data));
}

jest.mock('react-native', () => ({
    NativeEventEmitter: jest.fn(() => mockEmitter),
}));

// ── Mock: NativeMcSdk TurboModule ─────────────────────────────────────────────

jest.mock('../src/mcsdk/NativeMcSdk', () => {
    const mock = {
        create:          jest.fn(),
        destroy:         jest.fn(),
        setParams:       jest.fn(),
        init:            jest.fn().mockResolvedValue(true),
        setIdentity:     jest.fn(),
        setDocuments:    jest.fn(),   // ← method under test (Section 1–3)
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
        sendSds:         jest.fn(),
    };
    return { __esModule: true, default: mock };
});

import { McSdk } from '../src/mcsdk';
import { DocumentType, type McSdkDocument } from '../src/mcsdk';
import NativeMcSdk from '../src/mcsdk/NativeMcSdk';

const MockNative = NativeMcSdk as jest.Mocked<typeof NativeMcSdk>;

const DOC_A: McSdkDocument = {
    uri:       'http://bms.example.com/docs/a',
    etag:      '"abc123"',
    content:   '<McData/>',
    type:      DocumentType.UeInit,
    fetchedAt: 1700000000000,
};
const DOC_B: McSdkDocument = {
    uri:       'http://bms.example.com/docs/b',
    etag:      '"def456"',
    content:   '<McData2/>',
    type:      DocumentType.UeConfig,
    fetchedAt: 1700000001000,
};

beforeEach(() => {
    jest.clearAllMocks();
    eventListeners.clear();
});

// =============================================================================
// 1.  JS layer — wrapper correctness
// =============================================================================

describe('McSdk.setDocuments — JS layer', () => {
    it('is defined on the McSdk instance', () => {
        const sdk = new McSdk();
        expect(typeof sdk.setDocuments).toBe('function');
    });

    it('serialises docs array to JSON and forwards to NativeMcSdk.setDocuments', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        expect(MockNative.setDocuments).toHaveBeenCalledTimes(1);
        expect(MockNative.setDocuments).toHaveBeenCalledWith(JSON.stringify([DOC_A]));
    });

    it('forwards empty array as JSON "[]"', () => {
        const sdk = new McSdk();
        expect(() => sdk.setDocuments([])).not.toThrow();
        expect(MockNative.setDocuments).toHaveBeenCalledWith('[]');
    });

    it('returns void — setDocuments is fire-and-forget', () => {
        const sdk = new McSdk();
        const result = sdk.setDocuments([DOC_A]);
        expect(result).toBeUndefined();
    });

    it('return value is not a Promise', () => {
        const sdk = new McSdk();
        const result = sdk.setDocuments([DOC_A]) as unknown;
        expect(typeof (result as any)?.then).toBe('undefined');
    });

    it('does NOT call NativeMcSdk.register as a side-effect', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        expect(MockNative.register).not.toHaveBeenCalled();
    });

    it('can be called multiple times; each call is forwarded individually', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        sdk.setDocuments([DOC_B]);
        expect(MockNative.setDocuments).toHaveBeenCalledTimes(2);
        expect(MockNative.setDocuments).toHaveBeenNthCalledWith(1, JSON.stringify([DOC_A]));
        expect(MockNative.setDocuments).toHaveBeenNthCalledWith(2, JSON.stringify([DOC_B]));
    });
});

// =============================================================================
// 2.  Android platform contract
// =============================================================================

describe('Android platform contract', () => {
    /**
     * Android bridge (McSdkModule.kt):
     *   @ReactMethod fun setDocuments(docsJson: String)
     *   → JSONArray(docsJson) → List<Document> → sdk?.setDocuments(docs)
     *   → McSdk.java nativeSetDocuments(docsJson) [JNI → C++]
     *
     * The JS layer must pass exactly 1 JSON-string argument.
     */

    it('passes exactly 1 argument to NativeMcSdk.setDocuments', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        expect(MockNative.setDocuments.mock.calls[0]).toHaveLength(1);
    });

    it('the argument is a string — matching Kotlin String type expectation', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        expect(typeof MockNative.setDocuments.mock.calls[0][0]).toBe('string');
    });

    it('the argument is valid JSON (JSON.parse succeeds)', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A, DOC_B]);
        const arg = MockNative.setDocuments.mock.calls[0][0] as string;
        expect(() => JSON.parse(arg)).not.toThrow();
    });

    it('parsed JSON array matches the input docs exactly', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A, DOC_B]);
        const arg = MockNative.setDocuments.mock.calls[0][0] as string;
        expect(JSON.parse(arg)).toEqual([DOC_A, DOC_B]);
    });

    it('large array is forwarded intact (no truncation)', () => {
        const sdk = new McSdk();
        const big = Array.from({ length: 200 }, (_, i) => ({ ...DOC_A, uri: `uri-${i}` }));
        sdk.setDocuments(big);
        const arg = MockNative.setDocuments.mock.calls[0][0] as string;
        expect(JSON.parse(arg)).toHaveLength(200);
    });
});

// =============================================================================
// 3.  iOS platform contract
// =============================================================================

describe('iOS platform contract', () => {
    /**
     * McSdkModule.mm has RCT_EXPORT_METHOD(setDocuments:(NSString*)docsJson)
     * which builds McSdkDocuments and calls [gSdk setDocuments:documents].
     * JS requirements:
     *   1. Must not throw.
     *   2. Returns void (no Promise).
     *   3. JS layer always calls through to NativeMcSdk; bridge decides fate.
     */

    it('call does not throw (iOS no-op bridge requirement)', () => {
        const sdk = new McSdk();
        expect(() => sdk.setDocuments([DOC_A])).not.toThrow();
    });

    it('return value is undefined — matching iOS void bridge return', () => {
        const sdk = new McSdk();
        expect(sdk.setDocuments([DOC_A])).toBeUndefined();
    });

    it('NativeMcSdk.setDocuments is still called — the BRIDGE no-ops, not JS', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        expect(MockNative.setDocuments).toHaveBeenCalledTimes(1);
    });

    it('register() is NOT called as a side-effect', () => {
        const sdk = new McSdk();
        sdk.setDocuments([DOC_A]);
        expect(MockNative.register).not.toHaveBeenCalled();
    });

    it('subsequent calls after a no-op do not accumulate errors', () => {
        const sdk = new McSdk();
        expect(() => {
            sdk.setDocuments([DOC_A]);
            sdk.setDocuments([DOC_B]);
        }).not.toThrow();
        expect(MockNative.setDocuments).toHaveBeenCalledTimes(2);
    });
});

// =============================================================================
// 4.  onStoreDocuments — event subscription + JSON parsing
// =============================================================================

describe('McSdk.onStoreDocuments', () => {
    it('registers a listener for the McSdkStoreDocuments event', () => {
        const sdk = new McSdk();
        sdk.onStoreDocuments(jest.fn());
        expect(mockEmitter.addListener).toHaveBeenCalledWith(
            'McSdkStoreDocuments',
            expect.any(Function),
        );
    });

    it('returns an object with a remove() method', () => {
        const sdk = new McSdk();
        const sub = sdk.onStoreDocuments(jest.fn());
        expect(typeof sub.remove).toBe('function');
    });

    it('handler receives a parsed McSdkDocument array from docsJson', () => {
        const sdk = new McSdk();
        const handler = jest.fn();
        sdk.onStoreDocuments(handler);
        emitNativeEvent('McSdkStoreDocuments', { docsJson: JSON.stringify([DOC_A, DOC_B]) });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ docs: [DOC_A, DOC_B] });
    });

    it('handler receives all 5 fields correctly', () => {
        const sdk = new McSdk();
        const handler = jest.fn();
        sdk.onStoreDocuments(handler);
        emitNativeEvent('McSdkStoreDocuments', { docsJson: JSON.stringify([DOC_A]) });
        const { docs } = handler.mock.calls[0][0];
        expect(docs[0].uri).toBe(DOC_A.uri);
        expect(docs[0].etag).toBe(DOC_A.etag);
        expect(docs[0].content).toBe(DOC_A.content);
        expect(docs[0].type).toBe(DOC_A.type);
        expect(docs[0].fetchedAt).toBe(DOC_A.fetchedAt);
    });

    it('handler receives empty docs array when docsJson is "[]"', () => {
        const sdk = new McSdk();
        const handler = jest.fn();
        sdk.onStoreDocuments(handler);
        emitNativeEvent('McSdkStoreDocuments', { docsJson: '[]' });
        expect(handler).toHaveBeenCalledWith({ docs: [] });
    });

    it('handler is called with docs:[] when docsJson is malformed JSON', () => {
        const sdk = new McSdk();
        const handler = jest.fn();
        sdk.onStoreDocuments(handler);
        emitNativeEvent('McSdkStoreDocuments', { docsJson: 'NOT_VALID_JSON' });
        expect(handler).toHaveBeenCalledWith({ docs: [] });
    });

    it('multiple handlers all receive the event', () => {
        const sdk = new McSdk();
        const h1 = jest.fn();
        const h2 = jest.fn();
        sdk.onStoreDocuments(h1);
        sdk.onStoreDocuments(h2);
        emitNativeEvent('McSdkStoreDocuments', { docsJson: JSON.stringify([DOC_A]) });
        expect(h1).toHaveBeenCalledTimes(1);
        expect(h2).toHaveBeenCalledTimes(1);
    });
});
