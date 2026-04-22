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
} from './types';

export * from './types';

// ── Event names ───────────────────────────────────────────────────────────────

export const McSdkEvents = {
    FetchDocument: 'McSdkFetchDocument',
    SdsSent: 'McSdkSdsSent',
    SdsReceived: 'McSdkSdsReceived',
    SdsError: 'McSdkSdsError',
    Alarm: 'McSdkAlarm',
    Log: 'McSdkLog',
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

        const flat = {
            logEnabled:     L.enabled!     ? 1 : 0,
            logLevel:       L.level!,
            pjLogEnabled:   L.pjEnabled!   ? 1 : 0,
            pjLogLevel:     L.pjLevel!,
            rxTxEnabled:    L.rxTxEnabled! ? 1 : 0,
            httpPort:       H.port!,
            sipUdpPort:     S.udpPort!,
            sipTcpEnabled:  S.tcpEnabled!  ? 1 : 0,
            sipTcpPort:     S.tcpPort!,
            sipTlsEnabled:  S.tlsEnabled!  ? 1 : 0,
            sipTlsPort:     S.tlsPort!,
            sipIpv6Enabled: S.ipv6Enabled! ? 1 : 0,
            mTlsEnabled:    T.mTlsEnabled! ? 1 : 0,
            certPath:       T.certPath!,
            privKeyPath:    T.privKeyPath!,
            caListPath:     T.caListPath!,
            sipRxThreads:   Th.sipRxThreadCount!,
            sipWorkerThreads: Th.sipWorkerThreadCount!,
        };

        console.log('[McSdk] setParams JSON: sipRxThreads=', flat.sipRxThreads, 'sipWorkerThreads=', flat.sipWorkerThreads);

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

    fetchDocument(url: string): void {
        NativeMcSdk.fetchDocument(url);
    }

    sendSds(target: string, body: string): void {
        NativeMcSdk.sendSds(target, body);
    }

    // ── Event subscriptions ────────────────────────────────────────────────────

    onFetchDocument(handler: (e: FetchDocumentEvent) => void) {
        return emitter().addListener(McSdkEvents.FetchDocument, handler);
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
}
