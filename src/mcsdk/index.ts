// JS entry point — wraps the TurboModule with a friendlier API and surfaces
// async SDK events as a standard event subscription.

import { NativeEventEmitter } from 'react-native';
import NativeMcSdk from './NativeMcSdk';
import type {
    McSdkAffiliateRequest,
    IdentityUpdatedEvent,
    GroupsUpdatedEvent,
    AffiliationsUpdatedEvent,
    McSdkParams,
    FetchDocumentEvent,
    SdsSentEvent,
    SdsReceivedEvent,
    SdsErrorEvent,
    AlarmEvent,
    SdkErrorEvent,
    LogEvent,
    RegistrationEvent,
    McSdkDocument,
    StoreDocumentsEvent,
    CallInfoEvent,
    CallTerminatedEvent,
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
    SdkError:        'McSdkSdkError',
    Log:             'McSdkLog',
    Registration:    'McSdkRegistration',
    StoreDocuments:  'McSdkStoreDocuments',
    IncomingCall:    'McSdkIncomingCall',
    CallUpdated:     'McSdkCallUpdated',
    CallTerminated:  'McSdkCallTerminated',
    FloorUpdated:    'McSdkFloorUpdated',
    IdentityUpdated:      'McSdkIdentityUpdated',
    GroupsUpdated:        'McSdkGroupsUpdated',
    AffiliationsUpdated:  'McSdkAffiliationsUpdated',
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

    /**
     * Validates the flattened numeric params before they cross the bridge.
     *
     * The settings screen takes free text, so a field can arrive as NaN (typed
     * letters), fractional, or out of range. None of that is rejected further
     * down: JSON.stringify turns NaN into null and Kotlin's optInt then silently
     * substitutes its own default, while LogLevel.fromValue maps anything
     * outside 0..5 to VERBOSE — so asking for the *most* verbose level (9) would
     * quietly select the *least*. Clamping here keeps the value the user sees
     * and the value the SDK receives in agreement.
     */
    private static clampInt(
        value: unknown, min: number, max: number, fallback: number,
    ): number {
        // An empty or absent field means "unset", not zero — Number('') is 0,
        // which would otherwise be clamped to `min` and look deliberate.
        if (value === '' || value === null || value === undefined) return fallback;
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.trunc(n)));
    }

    setParams(params: McSdkParams = {}): void {
        const clamp = McSdk.clampInt;
        const p = { ...DEFAULT_PARAMS, ...params };
        const L = { ...DEFAULT_PARAMS.Logging!, ...p.Logging };
        const H = { ...DEFAULT_PARAMS.Http!, ...p.Http };
        const S = { ...DEFAULT_PARAMS.Sip!, ...p.Sip };
        const T = { ...DEFAULT_PARAMS.Tls!, ...p.Tls };
        const Th = { ...DEFAULT_PARAMS.Threading!, ...p.Threading };
        const M = p.Mcx ?? {};

        const flat = {
            logEnabled:      L.enabled!     ? 1 : 0,
            // LogLevel is VERBOSE(0)..FATAL(5); out-of-range silently becomes VERBOSE.
            logLevel:        clamp(L.level, 0, 5, 1),
            pjLogEnabled:    L.pjEnabled!   ? 1 : 0,
            pjLogLevel:      clamp(L.pjLevel, 0, 5, 1),
            rxTxEnabled:     L.rxTxEnabled! ? 1 : 0,
            // TCP/UDP ports: 1..65535. Port 0 means "any" to the OS, which is
            // never what a user typing into this screen intends.
            httpPort:        clamp(H.port, 1, 65535, 8008),
            sipUdpPort:      clamp(S.udpPort, 1, 65535, 5060),
            sipTcpEnabled:   S.tcpEnabled!  ? 1 : 0,
            sipTcpPort:      clamp(S.tcpPort, 1, 65535, 5060),
            sipTlsEnabled:   S.tlsEnabled!  ? 1 : 0,
            sipTlsPort:      clamp(S.tlsPort, 1, 65535, 5061),
            sipIpv6Enabled:  S.ipv6Enabled! ? 1 : 0,
            mTlsEnabled:     T.mTlsEnabled! ? 1 : 0,
            certPath:        T.certPath!,
            privKeyPath:     T.privKeyPath!,
            caListPath:      T.caListPath!,
            // At least one thread each; the bridge also floors these at 1.
            sipRxThreads:    clamp(Th.sipRxThreadCount, 1, 64, 1),
            sipWorkerThreads: clamp(Th.sipWorkerThreadCount, 1, 64, 1),
            bmsUrl:          M.bmsUrl ?? '',
            // Mcx fields added in SDK 072fad0 — read by Android only.
            mcdataSds:       (M.mcdataSds ?? true) ? 1 : 0,
            mcdataFd:        (M.mcdataFd ?? true) ? 1 : 0,
            mcdataIpconn:    (M.mcdataIpconn ?? false) ? 1 : 0,
            authViaPublish:  (M.authViaPublish ?? true) ? 1 : 0,
            // SIP Expires values are seconds in an unsigned 32-bit field.
            registerExpires: clamp(M.registerExpires ?? 3600, 1, 4294967295, 3600),
            pocExpires:      clamp(M.pocExpires ?? 4294967295, 1, 4294967295, 4294967295),
            userAgent:       M.userAgent ?? 'Mission 809',
            imei:            M.imei ?? '0001-0001-000001',
            // Deprecated on Android, still consumed by the iOS xcframework.
            idmsUrl:         M.idmsUrl ?? '',
            cmsUrl:          M.cmsUrl ?? '',
            gmsUrl:          M.gmsUrl ?? '',
        };

        // Protocol tuning is sent only when the caller actually set it: the
        // bridge overwrites a field only if the key is present, so an absent key
        // keeps the SDK's own default rather than a guess made here.
        const tuning: Record<string, number> = {};
        if (M.sessionExpires !== undefined)
            tuning.sessionExpires = clamp(M.sessionExpires, 1, 4294967295, 1800);
        if (M.affiliationExpires !== undefined)
            tuning.affiliationExpires = clamp(M.affiliationExpires, 1, 4294967295, 4294967295);
        if (M.affiliateBeforeSubscribe !== undefined)
            tuning.affiliateBeforeSubscribe = M.affiliateBeforeSubscribe ? 1 : 0;
        if (M.xcapExpires !== undefined)
            tuning.xcapExpires = clamp(M.xcapExpires, 1, 4294967295, 36000);
        if (H.requestTimeout !== undefined)
            tuning.httpRequestTimeout = clamp(H.requestTimeout, 1, 600, 10);

        NativeMcSdk.setParams(JSON.stringify({ ...flat, ...tuning }));
    }

    async init(): Promise<boolean> {
        return NativeMcSdk.init();
    }

    destroy(): void {
        NativeMcSdk.destroy();
    }

    // ── Affiliation ────────────────────────────────────────────────────────────
    // There is no getter for the group list: the SDK pushes it via
    // onGroupsUpdated / onAffiliationsUpdated once registration completes.

    /**
     * Explicit affiliation (TS 24.379 §9.2.1.2 state-replacing PUBLISH).
     *
     * State-REPLACING, not a delta: `requests` must be the complete set of groups
     * the user should end up affiliated to, with the services wanted for each.
     * Passing [] de-affiliates everything — prefer deaffiliate() to say that.
     */
    affiliate(requests: McSdkAffiliateRequest[]): void {
        NativeMcSdk.affiliate(JSON.stringify(requests));
    }

    /** De-affiliates from every group. */
    deaffiliate(): void {
        NativeMcSdk.deaffiliate();
    }

    /** The MC services the user is registered (authorized) for. */
    onIdentityUpdated(handler: (e: IdentityUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.IdentityUpdated, handler);
    }

    /** Groups the user may affiliate to; flags mean "this service supports the group". */
    onGroupsUpdated(handler: (e: GroupsUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.GroupsUpdated, handler);
    }

    /** The affiliated set; flags mean "the affiliation covers this service". */
    onAffiliationsUpdated(handler: (e: AffiliationsUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.AffiliationsUpdated, handler);
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

    // ── Calling ────────────────────────────────────────────────────────────────
    // Available on Android only until the iOS xcframework is rebuilt.

    /**
     * `fullDuplex` selects TS 24.379 §11.1.2 — a private call with no floor
     * control, where audio flows both ways while the call is selected and
     * requestFloor() does not apply. The default is half-duplex PTT (§11.1.1).
     *
     * `autoCommence` sets the Answer-Mode header (RFC 5373): true auto-answers
     * at the far end, false rings for manual pickup.
     */
    startPrivateCall(mcId: string, autoCommence = true, fullDuplex = false): void {
        NativeMcSdk.startPrivateCall(mcId, autoCommence, fullDuplex);
    }
    startGroupCall(groupId: string): void  { NativeMcSdk.startGroupCall(groupId); }
    answerCall(callId: string): void       { NativeMcSdk.answerCall(callId); }
    rejectCall(callId: string): void       { NativeMcSdk.rejectCall(callId); }
    terminateCall(callId: string): void    { NativeMcSdk.terminateCall(callId); }

    // ── Call priority ──────────────────────────────────────────────────────────
    // Re-INVITEs the call at the provisioned emergency floor priority; floor
    // requests made afterwards inherit it, so there is no priority argument on
    // requestFloor(). No-op unless the call is active and actually changing.

    setEmergency(callId: string, emergency: boolean): void {
        NativeMcSdk.setEmergency(callId, emergency);
    }
    setImminentPeril(callId: string, imminentPeril: boolean): void {
        NativeMcSdk.setImminentPeril(callId, imminentPeril);
    }

    // ── Floor control ──────────────────────────────────────────────────────────

    requestFloor(callId: string): void     { NativeMcSdk.requestFloor(callId); }
    releaseFloor(callId: string): void     { NativeMcSdk.releaseFloor(callId); }

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

    /**
     * SDK-level failures (SdkListener::onSdkError). Covers the whole SdkError
     * set — IDENTITY_NOT_SET, NOT_REGISTERED, SIP_*, HTTP_*, FLOOR_*.
     */
    onSdkError(handler: (e: SdkErrorEvent) => void) {
        return emitter().addListener(McSdkEvents.SdkError, handler);
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
