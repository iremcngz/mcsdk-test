// TurboModule spec — Codegen input for New Architecture.
// This file is parsed by @react-native/codegen to generate the native bindings.

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
    // Lifecycle
    create(): void;
    destroy(): void;

    // Configuration — all params encoded as JSON to avoid New Architecture
    // interop issues with mixed NSString*/double argument lists.
    setParams(paramsJson: string): void;

    init(): Promise<boolean>;

    // Alarm
    raiseAlarm(name: string, info: string, severity: number): void;
    resolveAlarm(name: string): void;
    // The readers below are Promise-based, never synchronous: a synchronous
    // native method runs on the JS thread, where every touch is handled too, so
    // the SDK's serialisation would hold up the UI for as long as it takes.
    listAlarms(): Promise<string>;

    // Metrics
    listMetrics(): Promise<string>;

    // The SDK's own log stream (Android). It never reaches JS line by line: the
    // bridge keeps it in a process-level ring and the SDK Logs screen pulls it in
    // batches while open. sinceSeq is exclusive (-1 for the tail); minLevel is
    // 0 VERBOSE .. 5 FATAL. Resolves an SdkLogBatch (src/mcsdk/types.ts).
    // Promise-based on purpose — a synchronous method would run on the JS thread.
    getSdkLogs(sinceSeq: number, max: number, minLevel: number): Promise<Object>;
    clearSdkLogs(): void;
    getSdkLogCount(): Promise<number>;

    // DAO
    createData(key: string, value: string): void;
    updateData(key: string, value: string): void;
    deleteData(key: string): void;
    getData(key: string): Promise<string>;
    importData(data: string): void;
    exportData(): Promise<string>;

    // Messaging
    // fetchDocument was dropped from the Android SDK in 072fad0 (the engine now
    // fetches documents itself). Kept in the spec because the iOS xcframework
    // still implements it; the Android bridge no longer exports it.
    fetchDocument(url: string): void;

    // Calling (Android only until the iOS xcframework is rebuilt)
    // autoCommence: Answer-Mode header on the INVITE (RFC 5373).
    // fullDuplex: TS 24.379 §11.1.2, a private call with no floor control.
    // audioCodec: an McSdkAudioCodec name, or '' for the SDK's default.
    startPrivateCall(mcId: string, autoCommence: boolean, fullDuplex: boolean, audioCodec: string): void;
    startGroupCall(groupId: string, audioCodec: string): void;
    startVideoGroupCall(groupId: string): void;
    // An MCVideo private call (TS 24.281 §10.2): video only, no transmission control.
    startVideoPrivateCall(mcId: string, autoCommence: boolean): void;
    answerCall(callId: string, audioCodec: string): void;
    rejectCall(callId: string): void;
    terminateCall(callId: string): void;

    // The USER's emergency / imminent-peril state, not one call's: every active
    // call is re-INVITEd to follow it and later calls start in it. These took a
    // callId until the SDK made the state per-user.
    setEmergency(emergency: boolean): void;
    setImminentPeril(imminentPeril: boolean): void;
    isEmergencyState(): Promise<boolean>;
    isImminentPerilState(): Promise<boolean>;

    // Affiliation (Android only until the iOS xcframework is rebuilt).
    // requestsJson is a JSON-encoded McSdkAffiliateRequest[] (same pattern as
    // setDocuments). State-replacing: the array is the complete desired set.
    affiliate(requestsJson: string): void;
    deaffiliate(): void;

    // Floor control
    requestFloor(callId: string): void;
    releaseFloor(callId: string): void;

    // Transmission control (MCVideo)
    requestTransmission(callId: string): void;
    endTransmission(callId: string): void;
    receiveMedia(callId: string, transmitterId: string): void;

    // Identity and registration
    setIdentity(mcId: string, password: string, clientId: string): void;
    // docsJson is a JSON-encoded McSdkDocument[] array (same pattern as setParams)
    setDocuments(docsJson: string): void;
    register(): void;
    unregister(): void;

    // Adds a native event listener (required by RCTEventEmitter protocol on iOS)
    addListener(eventName: string): void;
    removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('McSdk');
