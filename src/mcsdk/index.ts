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
    SdkLogBatch,
    McSdkLogLevel,
    RegistrationEvent,
    McSdkDocument,
    StoreDocumentsEvent,
    CallInfoEvent,
    CallTerminatedEvent,
    FloorUpdatedEvent,
    AudioInfoUpdatedEvent,
    VideoUpdatedEvent,
    TransmissionUpdatedEvent,
    ReceptionUpdatedEvent,
    McSdkAudioCodec,
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
    /**
     * The SDK's log stream. Android no longer emits it — the stream stays native
     * and is read with getSdkLogs(); iOS still pushes it. Listed so onAnyEvent
     * can keep it out of the listener log on either platform.
     */
    Log:             'McSdkLog',
    Registration:    'McSdkRegistration',
    StoreDocuments:  'McSdkStoreDocuments',
    IncomingCall:    'McSdkIncomingCall',
    CallUpdated:     'McSdkCallUpdated',
    CallTerminated:  'McSdkCallTerminated',
    FloorUpdated:    'McSdkFloorUpdated',
    AudioInfoUpdated: 'McSdkAudioInfoUpdated',
    IdentityUpdated:      'McSdkIdentityUpdated',
    GroupsUpdated:        'McSdkGroupsUpdated',
    AffiliationsUpdated:  'McSdkAffiliationsUpdated',
    Ready:                'McSdkReady',
    Terminated:           'McSdkTerminated',
    TransmissionUpdated:  'McSdkTransmissionUpdated',
    ReceptionUpdated:     'McSdkReceptionUpdated',
    VideoUpdated:         'McSdkVideoUpdated',
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

    // The readers (listAlarms, listMetrics, getData, exportData, the emergency
    // flags) are Promise-based: a synchronous bridge method runs on the JS
    // thread, where every touch is handled too, so the SDK's serialisation held
    // up the UI for as long as it took. Now it runs on the native modules thread.
    listAlarms(): Promise<string> {
        return NativeMcSdk.listAlarms();
    }

    // ── Metrics ────────────────────────────────────────────────────────────────

    listMetrics(): Promise<string> {
        return NativeMcSdk.listMetrics();
    }

    // ── DAO ────────────────────────────────────────────────────────────────────

    createData(key: string, value: string): void { NativeMcSdk.createData(key, value); }
    updateData(key: string, value: string): void { NativeMcSdk.updateData(key, value); }
    deleteData(key: string): void { NativeMcSdk.deleteData(key); }
    getData(key: string): Promise<string> { return NativeMcSdk.getData(key); }
    importData(data: string): void { NativeMcSdk.importData(data); }
    exportData(): Promise<string> { return NativeMcSdk.exportData(); }

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
     *
     * `audioCodec` is the AMR-WB framing the app's audio pipeline produces;
     * left out, the SDK picks its default (octet-aligned, the same thing).
     */
    startPrivateCall(
        mcId: string,
        autoCommence = true,
        fullDuplex = false,
        audioCodec?: McSdkAudioCodec,
    ): void {
        NativeMcSdk.startPrivateCall(mcId, autoCommence, fullDuplex, audioCodec ?? '');
    }
    /** `audioCodec` as for startPrivateCall. */
    startGroupCall(groupId: string, audioCodec?: McSdkAudioCodec): void {
        NativeMcSdk.startGroupCall(groupId, audioCodec ?? '');
    }
    /**
     * An MCVideo call to the group, separate from its MCPTT one: the SDK's calls
     * carry one media plane each. Video goes out once requestTransmission is granted.
     */
    startVideoGroupCall(groupId: string): void {
        NativeMcSdk.startVideoGroupCall(groupId);
    }
    /**
     * An MCVideo call to one user (TS 24.281 §10.2). It carries video and no audio,
     * and has no transmission control: both sides send while it is up, with no
     * requestTransmission and no receiveMedia. `autoCommence` as for startPrivateCall.
     */
    startVideoPrivateCall(mcId: string, autoCommence = true): void {
        NativeMcSdk.startVideoPrivateCall(mcId, autoCommence);
    }
    /**
     * `audioCodec` as for startPrivateCall. Leave it out for an MCVideo call,
     * whose media plane carries no audio: the bridge names H.264 instead.
     */
    answerCall(callId: string, audioCodec?: McSdkAudioCodec): void {
        NativeMcSdk.answerCall(callId, audioCodec ?? '');
    }
    rejectCall(callId: string): void       { NativeMcSdk.rejectCall(callId); }
    terminateCall(callId: string): void    { NativeMcSdk.terminateCall(callId); }

    // ── Emergency / imminent peril ─────────────────────────────────────────────
    // The USER's state (TS 24.379 Annex G.1), not one call's. Setting it
    // re-INVITEs every active call as an emergency call and makes every later
    // call one; clearing it cancels the emergency on the calls this user
    // raised. Another user's emergency on a call stays, as does one the network
    // refused to cancel — CallInfo.isEmergency is what says so per call. Floor
    // requests inherit the priority, so requestFloor() takes no priority.
    //
    // These took a callId until the SDK made the state per-user: there is no
    // per-call setter any more.

    setEmergency(emergency: boolean): void {
        NativeMcSdk.setEmergency(emergency);
    }
    setImminentPeril(imminentPeril: boolean): void {
        NativeMcSdk.setImminentPeril(imminentPeril);
    }
    /** The state as the SDK holds it — survives a JS reload, which the app's does not. */
    isEmergencyState(): Promise<boolean> {
        return NativeMcSdk.isEmergencyState();
    }
    isImminentPerilState(): Promise<boolean> {
        return NativeMcSdk.isImminentPerilState();
    }

    // ── Floor control ──────────────────────────────────────────────────────────

    requestFloor(callId: string): void     { NativeMcSdk.requestFloor(callId); }
    releaseFloor(callId: string): void     { NativeMcSdk.releaseFloor(callId); }

    // ── Transmission control (MCVideo) ─────────────────────────────────────────

    /** Asks to send video; the answer arrives as onTransmissionUpdated. */
    requestTransmission(callId: string): void { NativeMcSdk.requestTransmission(callId); }
    /** Stops sending video, or withdraws a request still waiting. */
    endTransmission(callId: string): void     { NativeMcSdk.endTransmission(callId); }
    /** Starts receiving a transmitter that onReceptionUpdated reported AVAILABLE. */
    receiveMedia(callId: string, transmitterId: string): void {
        NativeMcSdk.receiveMedia(callId, transmitterId);
    }

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

    /** A call's audio stream came up: its negotiated format. */
    onAudioInfoUpdated(handler: (e: AudioInfoUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.AudioInfoUpdated, handler);
    }

    /** A call's video stream changed: negotiated format, or RTP starting/stopping. */
    onVideoUpdated(handler: (e: VideoUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.VideoUpdated, handler);
    }

    /** Our own video transmission changed: requested, queued, granted, ended. */
    onTransmissionUpdated(handler: (e: TransmissionUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.TransmissionUpdated, handler);
    }

    /** A remote transmitter's stream changed, from our side. */
    onReceptionUpdated(handler: (e: ReceptionUpdatedEvent) => void) {
        return emitter().addListener(McSdkEvents.ReceptionUpdated, handler);
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

    // ── The SDK's own log ──────────────────────────────────────────────────────
    // Pulled, not pushed. With the default params the SDK writes ~450 lines a
    // second; delivered one by one as events they kept the JS thread busy whether
    // or not anybody was reading them (and every tap waits on that thread). The
    // Android bridge keeps the stream in a process-level ring instead, and the
    // SDK Logs screen asks for what is new while it is open. The ring outlives a
    // JS reload, so the history is still there afterwards.

    /**
     * Lines newer than `sinceSeq` (exclusive; -1 for the newest tail) at
     * `minLevel` or above, the newest `max` of them, oldest first. Pass the
     * batch's `latestSeq` back as `sinceSeq` on the next call.
     */
    getSdkLogs(sinceSeq: number, max: number, minLevel: McSdkLogLevel = 0): Promise<SdkLogBatch> {
        return NativeMcSdk.getSdkLogs(sinceSeq, max, minLevel) as Promise<SdkLogBatch>;
    }

    /** Empties the ring. The file log keeps every line. */
    clearSdkLogs(): void {
        NativeMcSdk.clearSdkLogs();
    }

    getSdkLogCount(): Promise<number> {
        return NativeMcSdk.getSdkLogCount();
    }

    /**
     * Every listener event with its raw payload, for logging. McSdkLog is left
     * out: it is the SDK's own log stream, read through getSdkLogs, and at
     * ~450/s it would bury everything else.
     */
    onAnyEvent(handler: (event: string, payload: unknown) => void) {
        const subs = Object.values(McSdkEvents)
            .filter(event => event !== McSdkEvents.Log)
            .map(event => emitter().addListener(event, payload => handler(event, payload)));
        return { remove: () => subs.forEach(sub => sub.remove()) };
    }

    /**
     * SDK-level failures (SdkListener::onSdkError). Covers the whole SdkError
     * set — IDENTITY_NOT_SET, NOT_REGISTERED, SIP_*, HTTP_*, FLOOR_*, AUDIO_*.
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
