// TurboModule spec — Codegen input for New Architecture.
// This file is parsed by @react-native/codegen to generate the native bindings.

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
    // Lifecycle
    create(): void;
    setListener(): void;
    destroy(): void;

    // Configuration
    setParams(
        logEnabled: boolean,
        logLevel: number,
        pjLogEnabled: boolean,
        pjLogLevel: number,
        rxTxEnabled: boolean,
        httpPort: number,
        sipUdpPort: number,
        sipTcpEnabled: boolean,
        sipTcpPort: number,
        sipTlsEnabled: boolean,
        sipTlsPort: number,
        sipIpv6Enabled: boolean,
        mTlsEnabled: boolean,
        certPath: string,
        privKeyPath: string,
        caListPath: string,
        sipRxThreads: number,
        sipWorkerThreads: number,
    ): void;

    init(): boolean;

    // Alarm
    raiseAlarm(name: string, info: string, severity: number): void;
    resolveAlarm(name: string): void;
    listAlarms(): string;

    // Metrics
    listMetrics(): string;

    // DAO
    createData(key: string, value: string): void;
    updateData(key: string, value: string): void;
    deleteData(key: string): void;
    getData(key: string): string;
    importData(data: string): void;
    exportData(): string;

    // Messaging
    fetchDocument(url: string): void;
    sendSds(target: string, body: string): void;

    // Adds a native event listener (required by RCTEventEmitter protocol on iOS)
    addListener(eventName: string): void;
    removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('McSdk');
