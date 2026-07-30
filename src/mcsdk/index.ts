// JS entry point — wraps the TurboModule with a friendlier API and surfaces
// async SDK events as a standard event subscription.

import { NativeEventEmitter } from 'react-native';
import NativeMcSdk from './NativeMcSdk';
import type {
    McSdkParams,
    FetchDocumentEvent,
    SdsSentEvent,
    SdsReceivedEvent,
    SdsErrorEvent,
    AlarmEvent,
    LogEvent,
    RegistrationEvent,
    McSdkDocument,
    StoreDocumentsEvent,
    CallInfoEvent,
    CallTerminatedEvent,
    CallSelectedEvent,
    FloorUpdatedEvent,
} from './types';

export * from './types';

// ── Event names ───────────────────────────────────────────────────────────────

export const McSdkEvents = {
    /** @deprecated Android no longer emits this; the SDK fetches documents itself. */
    FetchDocument:   'McSdkFetchDocument',
    SdsSent:         'McSdkSdsSent',
    SdsReceived:     'McSdkSdsReceived',
    SdsError:        'McSdkSdsError',
    Alarm:           'McSdkAlarm',
    Log:             'McSdkLog',
    Registration:    'McSdkRegistration',
    StoreDocuments:  'McSdkStoreDocuments',
    IncomingCall:    'McSdkIncomingCall',
    CallUpdated:     'McSdkCallUpdated',
    CallTerminated:  'McSdkCallTerminated',
    CallSelected:    'McSdkCallSelected',
    FloorUpdated:    'McSdkFloorUpdated',
} as const;

// ── Emitter (singleton, lazily created) ───────────────────────────────────────

let _emitter: NativeEventEmitter | null = null;

function emitter(): NativeEventEmitter {
    if (!_emitter) {
        // NativeMcSdk implements addListener/removeListeners on the native side
        _emitter = new NativeEventEmitter(NativeMcSdk as any);
    }
    return _emitter;
}

// ── SDK class ─────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: McSdkParams = {
    Logging: { enabled: true, level: 1, pjEnabled: false, pjLevel: 1, rxTxEnabled: false },
    Http: { port: 8008 },
    Sip: { udpPort: 5060, tcpEnabled: false, tcpPort: 5060, tlsEnabled: false, tlsPort: 5061, ipv6Enabled: false },
    Tls: { mTlsEnabled: false, certPath: 'cert/client.crt', privKeyPath: 'cert/client.key', caListPath: 'cert/ca.pem' },
    Threading: { sipRxThreadCount: 1, sipWorkerThreadCount: 1 },
};

export class McSdk {
    constructor() {
        NativeMcSdk.create();
    }

    setParams(params: McSdkParams = {}): void {
        const p = { ...DEFAULT_PARAMS, ...params };
        const L = { ...DEFAULT_PARAMS.Logging!, ...p.Logging };
        const H = { ...DEFAULT_PARAMS.Http!, ...p.Http };
        const S = { ...DEFAULT_PARAMS.Sip!, ...p.Sip };
        const T = { ...DEFAULT_PARAMS.Tls!, ...p.Tls };
        const Th = { ...DEFAULT_PARAMS.Threading!, ...p.Threading };
        const M = p.Mcx ?? {};

        const flat = {
            logEnabled:      L.enabled!     ? 1 : 0,
            logLevel:        L.level!,
            pjLogEnabled:    L.pjEnabled!   ? 1 : 0,
            pjLogLevel:      L.pjLevel!,
            rxTxEnabled:     L.rxTxEnabled! ? 1 : 0,
            httpPort:        H.port!,
            sipUdpPort:      S.udpPort!,
            sipTcpEnabled:   S.tcpEnabled!  ? 1 : 0,
            sipTcpPort:      S.tcpPort!,
            sipTlsEnabled:   S.tlsEnabled!  ? 1 : 0,
            sipTlsPort:      S.tlsPort!,
            sipIpv6Enabled:  S.ipv6Enabled! ? 1 : 0,
            mTlsEnabled:     T.mTlsEnabled! ? 1 : 0,
            certPath:        T.certPath!,
            privKeyPath:     T.privKeyPath!,
            caListPath:      T.caListPath!,
            sipRxThreads:    Th.sipRxThreadCount!,
            sipWorkerThreads: Th.sipWorkerThreadCount!,
            bmsUrl:          M.bmsUrl ?? '',
            mock:            (M.mock ?? false) ? 1 : 0,
            // Mcx fields added in SDK 072fad0 — read by Android only.
            mcdataSds:       (M.mcdataSds ?? true) ? 1 : 0,
            mcdataFd:        (M.mcdataFd ?? true) ? 1 : 0,
            mcdataIpconn:    (M.mcdataIpconn ?? false) ? 1 : 0,
            authViaPublish:  (M.authViaPublish ?? true) ? 1 : 0,
            registerExpires: M.registerExpires ?? 3600,
            pocExpires:      M.pocExpires ?? 4294967295,
            userAgent:       M.userAgent ?? 'Mission 809',
            imei:            M.imei ?? '0001-0001-000001',
            // Deprecated on Android, still consumed by the iOS xcframework.
            idmsUrl:         M.idmsUrl ?? '',
            cmsUrl:          M.cmsUrl ?? '',
            gmsUrl:          M.gmsUrl ?? '',
        };
        NativeMcSdk.setParams(JSON.stringify(flat));
    }

    async init(): Promise<boolean> {
        return NativeMcSdk.init();
    }

    destroy(): void {
        NativeMcSdk.destroy();
    }

    // ── Alarm ──────────────────────────────────────────────────────────────────

    raiseAlarm(name: string, info: string, severity: number = 0): void {
        NativeMcSdk.raiseAlarm(name, info, severity);
    }

    resolveAlarm(name: string): void {
        NativeMcSdk.resolveAlarm(name);
    }

    listAlarms(): string {
        return NativeMcSdk.listAlarms();
    }

    // ── Metrics ────────────────────────────────────────────────────────────────

    listMetrics(): string {
        return NativeMcSdk.listMetrics();
    }

    // ── DAO ────────────────────────────────────────────────────────────────────

    createData(key: string, value: string): void { NativeMcSdk.createData(key, value); }
    updateData(key: string, value: string): void { NativeMcSdk.updateData(key, value); }
    deleteData(key: string): void { NativeMcSdk.deleteData(key); }
    getData(key: string): string { return NativeMcSdk.getData(key); }
    importData(data: string): void { NativeMcSdk.importData(data); }
    exportData(): string { return NativeMcSdk.exportData(); }

    // ── Messaging ──────────────────────────────────────────────────────────────

    /**
     * @deprecated Removed from the Android SDK in 072fad0 — the engine fetches
     * BMS documents itself and reports them via onStoreDocuments(). This is a
     * no-op on Android and remains only for the not-yet-rebuilt iOS xcframework.
     */
    fetchDocument(url: string): void {
        NativeMcSdk.fetchDocument(url);
    }

    sendSds(target: string, body: string): void {
        NativeMcSdk.sendSds(target, body);
    }

    // ── Calling ────────────────────────────────────────────────────────────────
    // Available on Android only until the iOS xcframework is rebuilt.

    startPrivateCall(mcId: string): void   { NativeMcSdk.startPrivateCall(mcId); }
    startGroupCall(groupId: string): void  { NativeMcSdk.startGroupCall(groupId); }
    answerCall(callId: string): void       { NativeMcSdk.answerCall(callId); }
    rejectCall(callId: string): void       { NativeMcSdk.rejectCall(callId); }
    terminateCall(callId: string): void    { NativeMcSdk.terminateCall(callId); }

    // ── Floor control ──────────────────────────────────────────────────────────

    requestFloor(callId: string): void     { NativeMcSdk.requestFloor(callId); }
    releaseFloor(callId: string): void     { NativeMcSdk.releaseFloor(callId); }

    // ── Media ──────────────────────────────────────────────────────────────────

    selectCall(callId: string): void       { NativeMcSdk.selectCall(callId); }
    muteMicrophone(muted: boolean): void   { NativeMcSdk.muteMicrophone(muted); }

    setIdentity(mcId: string, password: string, clientId: string = ''): void {
        NativeMcSdk.setIdentity(mcId, password, clientId);
    }

    /**
     * Provides cached BMS documents to the SDK before registration.
     * Must be called after init() resolves and before register().
     *
     * Android: routed to nativeSetDocuments(docsJson) → JNI → C++ Sdk::SetDocuments
     * iOS:     no-op until xcframework exposes -setDocuments: (McSdkModule.mm stub)
     */
    setDocuments(docs: McSdkDocument[]): void {
        NativeMcSdk.setDocuments(JSON.stringify(docs));
    }

    register(): void { NativeMcSdk.register(); }
    unregister(): void { NativeMcSdk.unregister(); }

    // ── Event subscriptions ────────────────────────────────────────────────────

    /** @deprecated Android no longer emits this event; see fetchDocument(). */
    onFetchDocument(handler: (e: FetchDocumentEvent) => void) {
        return emitter().addListener(McSdkEvents.FetchDocument, handler);
    }

    // ── Call & Floor subscriptions (Android only) ──────────────────────────────

    onIncomingCall(handler: (e: CallInfoEvent) => void) {
        return emitter().addListener(McSdkEvents.IncomingCall, handler);
    }

    onCallUpdated(handler: (e: CallInfoEvent) => void) {
        return emitter().addListener(McSdkEvents.CallUpdated, handler);
    }

    onCallTerminated(handler: (e: CallTerminatedEvent) => void) {
        return emitter().addListener(McSdkEvents.CallTerminated, handler);
    }

    onCallSelected(handler: (e: CallSelectedEvent) => void) {
        return emitter().addListener(McSdkEvents.CallSelected, handler);
    }

    onFloorUpdated(handler: (e: FloorUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.FloorUpdated, handler);
    }

    onSdsSent(handler: (e: SdsSentEvent) => void) {
        return emitter().addListener(McSdkEvents.SdsSent, handler);
    }

    onSdsReceived(handler: (e: SdsReceivedEvent) => void) {
        return emitter().addListener(McSdkEvents.SdsReceived, handler);
    }

    onSdsError(handler: (e: SdsErrorEvent) => void) {
        return emitter().addListener(McSdkEvents.SdsError, handler);
    }

    onAlarm(handler: (e: AlarmEvent) => void) {
        return emitter().addListener(McSdkEvents.Alarm, handler);
    }

    onLog(handler: (e: LogEvent) => void) {
        return emitter().addListener(McSdkEvents.Log, handler);
    }

    onRegistration(handler: (e: RegistrationEvent) => void) {
        return emitter().addListener(McSdkEvents.Registration, handler);
    }

    /**
     * Subscribe to the StoreDocuments event.
     * The SDK fires this after fetching BMS documents; the app should persist
     * them via saveDocuments() so they can be restored on the next session.
     */
    onStoreDocuments(handler: (e: StoreDocumentsEvent) => void) {
        return emitter().addListener(
            McSdkEvents.StoreDocuments,
            (raw: { docsJson: string }) => {
                try {
                    handler({ docs: JSON.parse(raw.docsJson) });
                } catch {
                    handler({ docs: [] });
                }
            },
        );
    }
}
