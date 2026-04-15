// Shared TypeScript types mirroring the C++ core types.

export type McSdkLogLevel = 0 | 1 | 2 | 3 | 4 | 5;
// 0=Verbose 1=Debug 2=Info 3=Warn 4=Error 5=Fatal

export type McSdkError =
    | 'NotInitialized'
    | 'BuildRequestFailed'
    | 'AttachBodyFailed'
    | 'SendFailed';

export type McSdkAlarmSeverity =
    | 'Unknown'
    | 'Resolved'
    | 'ManuallyResolved'
    | 'Minor'
    | 'Major'
    | 'Critical';

export interface McSdkLoggingParams {
    enabled?: boolean;
    level?: McSdkLogLevel;
    pjEnabled?: boolean;
    pjLevel?: McSdkLogLevel;
    rxTxEnabled?: boolean;
}

export interface McSdkHttpParams {
    port?: number;
}

export interface McSdkSipParams {
    udpPort?: number;
    tcpEnabled?: boolean;
    tcpPort?: number;
    tlsEnabled?: boolean;
    tlsPort?: number;
    ipv6Enabled?: boolean;
}

export interface McSdkTlsParams {
    mTlsEnabled?: boolean;
    certPath?: string;
    privKeyPath?: string;
    caListPath?: string;
}

export interface McSdkThreadingParams {
    sipRxThreadCount?: number;
    sipWorkerThreadCount?: number;
}

export interface McSdkParams {
    Logging?: McSdkLoggingParams;
    Http?: McSdkHttpParams;
    Sip?: McSdkSipParams;
    Tls?: McSdkTlsParams;
    Threading?: McSdkThreadingParams;
}

// Callback event payloads
export interface FetchDocumentEvent {
    url: string;
    content: string;
}

export interface SdsSentEvent {
    target: string;
    body: string;
}

export interface SdsReceivedEvent {
    sender: string;
    body: string;
}

export interface SdsErrorEvent {
    target: string;
    error: McSdkError;
}

export interface AlarmEvent {
    alarm: string;
}

export interface LogEvent {
    level: McSdkLogLevel;
    log: string;
}
