// Shared TypeScript types mirroring the C++ core types.

export type McSdkLogLevel = 0 | 1 | 2 | 3 | 4 | 5;
// 0=Verbose 1=Debug 2=Info 3=Warn 4=Error 5=Fatal

/**
 * Mirrors SdkError in core. Android sends the enum *name* over the bridge,
 * iOS sends the ordinal. The SIP_* and IDMS_* members were added in SDK 072fad0.
 */
export type McSdkError =
    | 'NOT_INITIALIZED'
    | 'BUILD_REQUEST_FAILED'
    | 'ATTACH_BODY_FAILED'
    | 'SEND_FAILED'
    | 'INIT_SIP_FAILED'
    | 'INIT_HTTP_FAILED'
    | 'INIT_ENGINE_FAILED'
    | 'SIP_STACK_FAIL'
    | 'SIP_NETWORK_ERROR'
    | 'SIP_TIMEOUT'
    | 'SIP_FORBIDDEN'
    | 'SIP_NOT_FOUND'
    | 'SIP_AUTH_FAILED'
    | 'SIP_INTERVAL_TOO_BRIEF'
    | 'SIP_SERVER_ERROR'
    | 'SIP_REJECTED'
    | 'SIP_FAILED'
    | 'IDMS_TOKEN_REFRESH_FAILED';

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
    bmsUrl?: string;
    mock?:   boolean;

    // Added in SDK 072fad0 (Android). The iOS xcframework does not read these yet.
    mcdataSds?:       boolean;
    mcdataFd?:        boolean;
    mcdataIpconn?:    boolean;
    authViaPublish?:  boolean;
    registerExpires?: number;
    pocExpires?:      number;
    userAgent?:       string;
    imei?:            string;

    /** @deprecated Removed from the Android SDK in 072fad0; still read by the iOS xcframework. */
    idmsUrl?: string;
    /** @deprecated Removed from the Android SDK in 072fad0; still read by the iOS xcframework. */
    cmsUrl?:  string;
    /** @deprecated Removed from the Android SDK in 072fad0; still read by the iOS xcframework. */
    gmsUrl?:  string;
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
 *
 * Renumbered in SDK 072fad0: the old flat set (UeInit/UeConfig/ServiceConfig/
 * UserProfile/GroupProfile) was replaced by per-service MCPTT/MCVIDEO/MCDATA
 * variants. Ordinals 4-6 now mean something different than they did before, and
 * GroupProfile(6) moved to GroupConfig(13) — documents persisted under the old
 * numbering must be migrated (see migrateLegacyDocumentType).
 */
export enum DocumentType {
    Unknown              = 0,
    UeInitialConfig      = 1,
    UeInitConfig         = 2,
    UserAdditions        = 3,
    McpttUeConfig        = 4,
    McpttServiceConfig   = 5,
    McpttUserProfile     = 6,
    McvideoUeConfig      = 7,
    McvideoServiceConfig = 8,
    McvideoUserProfile   = 9,
    McdataUeConfig       = 10,
    McdataServiceConfig  = 11,
    McdataUserProfile    = 12,
    GroupConfig          = 13,
}

/**
 * Maps a DocumentType ordinal persisted under the pre-072fad0 numbering onto
 * its current equivalent. Documents cached by an older build carry ordinals
 * that now denote different types, so run this once when loading them.
 */
export function migrateLegacyDocumentType(legacy: number): DocumentType {
    switch (legacy) {
        case 1: return DocumentType.UeInitialConfig;     // UE_INIT
        case 2: return DocumentType.UeInitConfig;        // UE_CONFIG
        case 3: return DocumentType.UserAdditions;       // unchanged
        case 4: return DocumentType.McpttServiceConfig;  // SERVICE_CONFIG
        case 5: return DocumentType.McpttUserProfile;    // USER_PROFILE
        case 6: return DocumentType.GroupConfig;         // GROUP_PROFILE
        default: return DocumentType.Unknown;
    }
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

// ── Call & Floor (added in SDK 072fad0; Android only) ─────────────────────────

export type McSdkCallType =
    | 'UNKNOWN' | 'PRIVATE' | 'GROUP' | 'FIRST_TO_ANSWER' | 'AMBIENT_LISTENING';

export type McSdkCallState =
    | 'UNKNOWN' | 'INCOMING' | 'ACCEPTING' | 'OUTGOING' | 'CALLING' | 'RINGING'
    | 'ESTABLISHING' | 'ACTIVE' | 'HELD' | 'REESTABLISHING' | 'TERMINATING'
    | 'TERMINATED';

export type McSdkFloorStatus =
    | 'UNKNOWN' | 'IDLE' | 'REQUESTED' | 'QUEUED' | 'RELEASED' | 'GRANTED'
    | 'DENIED' | 'REVOKED' | 'TAKEN' | 'REQUEST_TIMEOUT' | 'RELEASE_TIMEOUT'
    | 'QUEUE_TIMEOUT' | 'GRANT_PENDING' | 'GRANT_EXPIRED';

export type McSdkTerminationMode =
    | 'UNKNOWN' | 'CLOSED_LOCALLY' | 'CLOSED_REMOTELY' | 'REJECTED_LOCALLY'
    | 'REJECTED_REMOTELY' | 'CANCELLED_LOCALLY' | 'CANCELLED_REMOTELY' | 'TIMEOUT';

export type McSdkTerminationReason =
    | 'UNKNOWN' | 'BUSY' | 'NO_ANSWER' | 'UNAVAILABLE' | 'CONNECTION_LOST'
    | 'PREEMPTED';

/** Mirrors CallInfo. Payload of McSdkIncomingCall and McSdkCallUpdated. */
export interface CallInfoEvent {
    callId:          string;
    type:            McSdkCallType;
    state:           McSdkCallState;
    outgoing:        boolean;
    isEmergency:     boolean;
    isImminentPeril: boolean;
    callerId:        string;
    calleeId:        string;
    groupId:         string;
}

/** Mirrors TerminationInfo. Payload of McSdkCallTerminated. */
export interface CallTerminatedEvent {
    callId: string;
    mode:   McSdkTerminationMode;
    reason: McSdkTerminationReason;
}

/** Payload of McSdkCallSelected. */
export interface CallSelectedEvent {
    callId: string;
}

/** Mirrors FloorInfo. Payload of McSdkFloorUpdated. */
export interface FloorUpdatedEvent {
    callId:        string;
    ownerId:       string;
    status:        McSdkFloorStatus;
    queuePosition: number;
}
