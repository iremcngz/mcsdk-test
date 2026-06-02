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

export interface McSdkMcxParams {
    idmsUrl?: string;
    bmsUrl?:  string;
    cmsUrl?:  string;
    gmsUrl?:  string;
    mock?:    boolean;
}

export interface McSdkParams {
    Logging?:   McSdkLoggingParams;
    Http?:      McSdkHttpParams;
    Sip?:       McSdkSipParams;
    Tls?:       McSdkTlsParams;
    Threading?: McSdkThreadingParams;
    Mcx?:       McSdkMcxParams;
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

export interface RegistrationEvent {
    // iOS sends numbers (enum ordinals), Android sends strings
    state: number | string;
    phase: number | string;
    progress: number;
}

/**
 * Mirrors DocumentType in core/Modules/Session/Document/Document.h.
 * The integer value is the ordinal sent over the bridge.
 */
export enum DocumentType {
    Unknown       = 0,
    UeInit        = 1,
    UeConfig      = 2,
    UserAdditions = 3,
    ServiceConfig = 4,
    UserProfile   = 5,
    GroupProfile  = 6,
}

/**
 * Mirrors the C++ Document struct: {uri, etag, content, type, fetchedAt}.
 * Received in StoreDocumentsEvent and passed back via McSdk.setDocuments().
 */
export interface McSdkDocument {
    uri:       string;
    etag:      string;
    content:   string;
    type:      DocumentType;
    fetchedAt: number;
}

/** Payload of the McSdkStoreDocuments native event. */
export interface StoreDocumentsEvent {
    docs: McSdkDocument[];
}
