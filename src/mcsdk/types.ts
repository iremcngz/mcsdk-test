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
    | 'MCPTT_REGISTRATION_FAILED'
    | 'MCVIDEO_REGISTRATION_FAILED'
    | 'MCDATA_REGISTRATION_FAILED'
    | 'HTTP_UNREACHABLE'
    | 'HTTP_REDIRECTED'
    | 'HTTP_BAD_REQUEST'
    | 'HTTP_UNAUTHORIZED'
    | 'HTTP_FORBIDDEN'
    | 'HTTP_NOT_FOUND'
    | 'HTTP_TOO_MANY_REQUESTS'
    | 'HTTP_SERVER_ERROR'
    | 'HTTP_GATEWAY_ERROR'
    | 'HTTP_FAILED'
    | 'IDMS_TOKEN_REFRESH_FAILED'
    /** register() was called before setIdentity() — Session::McId is empty. */
    | 'IDENTITY_NOT_SET'
    | 'NOT_REGISTERED'
    | 'FLOOR_MESSAGE_MALFORMED'
    | 'FLOOR_MESSAGE_UNKNOWN'
    | 'FLOOR_MESSAGE_UNEXPECTED_SOURCE'
    | 'FLOOR_UNKNOWN_CALL'
    | 'FLOOR_CHANNEL_FAILED'
    | 'FLOOR_SDP_INVALID'
    | 'FLOOR_SEND_FAILED';

/** Payload of McSdkSdkError. */
export interface SdkErrorEvent {
    error: McSdkError;
}

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
    /** Seconds to wait for a server to respond. SDK default is 10. */
    requestTimeout?: number;
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

    // Added in SDK 072fad0 (Android). The iOS xcframework does not read these yet.
    mcdataSds?:       boolean;
    mcdataFd?:        boolean;
    mcdataIpconn?:    boolean;
    authViaPublish?:  boolean;
    registerExpires?: number;
    pocExpires?:      number;
    userAgent?:       string;
    imei?:            string;

    // Protocol tuning. Omit to keep the SDK's own defaults.
    sessionExpires?:     number;
    affiliationExpires?: number;
    /**
     * Publish the initial affiliation before the affiliation SUBSCRIBE instead
     * of after the subscription is confirmed.
     *
     * Registration normally waits for the subscription to reach ACTIVE, which
     * requires the server's initial NOTIFY. A server that answers the SUBSCRIBE
     * with 200 OK but never sends that NOTIFY leaves the SipAffiliating phase
     * waiting forever; publishing up front at least gets the affiliation out.
     */
    affiliateBeforeSubscribe?: boolean;
    xcapExpires?:        number;

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
 * GroupProfile(6) moved to GroupConfig(12) — documents persisted under the old
 * numbering must be migrated (see migrateLegacyDocumentType).
 *
 * These values must stay identical to the C++ enum: only the ordinal crosses the
 * bridge (McSdkModule emits `doc.type.ordinal`), so an extra or missing member
 * here silently shifts every type after it. A stray `UeInitialConfig = 1` did
 * exactly that — a cached group document read back as McdataUserProfile.
 */
export enum DocumentType {
    Unknown              = 0,
    UeInitConfig         = 1,
    UserAdditions        = 2,
    McpttUeConfig        = 3,
    McpttServiceConfig   = 4,
    McpttUserProfile     = 5,
    McvideoUeConfig      = 6,
    McvideoServiceConfig = 7,
    McvideoUserProfile   = 8,
    McdataUeConfig       = 9,
    McdataServiceConfig  = 10,
    McdataUserProfile    = 11,
    GroupConfig          = 12,
}

/**
 * Maps a DocumentType ordinal persisted under the pre-072fad0 numbering onto
 * its current equivalent. Documents cached by an older build carry ordinals
 * that now denote different types, so run this once when loading them.
 */
export function migrateLegacyDocumentType(legacy: number): DocumentType {
    switch (legacy) {
        case 1: return DocumentType.UeInitConfig;        // UE_INIT
        case 2: return DocumentType.McpttUeConfig;       // UE_CONFIG
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

/** Why the floor control server said no. Meaningful when status is DENIED. */
export type McSdkFloorDenyReason =
    | 'UNKNOWN'
    | 'ANOTHER_CLIENT_HAS_PERMISSION'
    | 'INTERNAL_ERROR'
    | 'ONLY_ONE_PARTICIPANT'
    | 'RETRY_AFTER_NOT_EXPIRED'
    | 'RECEIVE_ONLY'
    | 'NO_RESOURCES_AVAILABLE'
    | 'QUEUE_FULL'
    | 'OTHER_REASON';

/** Why the floor was taken back. Meaningful when status is REVOKED. */
export type McSdkFloorRevokeReason =
    | 'UNKNOWN'
    | 'ONLY_ONE_CLIENT'
    | 'MEDIA_BURST_TOO_LONG'
    | 'NO_PERMISSION'
    | 'MEDIA_BURST_PREEMPTED'
    | 'NO_RESOURCES_AVAILABLE'
    | 'REVOKED_BY_ANOTHER_CLIENT'
    | 'OTHER_REASON';

/** One current talker. Several at once in a multi-talker group. */
export interface McSdkFloorParticipant {
    id: string;
    /** Media SSRC, unsigned 32-bit; 0 when the server didn't send one. */
    ssrc: number;
}

/**
 * Mirrors FloorInfo. Payload of McSdkFloorUpdated.
 *
 * Most fields only carry meaning for a particular `status`: denyReason for
 * DENIED, revokeReason for REVOKED, queuePosition/queuePriority while QUEUED,
 * grantedDuration once GRANTED. `ownerId` is the first of `talkers`, kept
 * because it is what tells "we hold the floor" from "someone else does".
 */
export interface FloorUpdatedEvent {
    callId:        string;
    ownerId:       string;
    status:        McSdkFloorStatus;
    queuePosition: number;
    /** The priority we were queued at. */
    queuePriority: number;
    /** Seconds the server granted the floor for; 0 if it didn't say. */
    grantedDuration: number;
    isEmergency:     boolean;
    isImminentPeril: boolean;
    denyReason:   McSdkFloorDenyReason;
    revokeReason: McSdkFloorRevokeReason;
    isMultiTalker: boolean;
    /** Dual floor: we talk over the current talker. */
    overridingWithoutRevoke: boolean;
    /** Dual floor: someone talks over us. */
    overriddenWithoutRevoke: boolean;
    // Floor Indicator bits (TS 24.380 §8.2.3.15), decoded by the SDK.
    isBroadcastCall:     boolean;
    isSystemCall:        boolean;
    isQueueingSupported: boolean;
    isDualFloor:         boolean;
    talkers: McSdkFloorParticipant[];
}

// ── Identity, Groups & Affiliation (added in SDK dbb25f5) ─────────────────────

/**
 * Mirrors GroupInfo (core/Modules/Session/GroupInfo.h) — the only group shape the
 * SDK emits. Carried by BOTH McSdkGroupsUpdated and McSdkAffiliationsUpdated, and
 * the service flags mean different things in each:
 *
 *   - onGroupsUpdated:       the service SUPPORTS this group (what you may ask for)
 *   - onAffiliationsUpdated: the affiliation COVERS this service (what you have)
 */
export interface McSdkGroupInfo {
    /** Group MC ID — the identifier used for calls and affiliation requests. */
    groupId: string;
    /** Human-readable group name; may be empty, in which case fall back to groupId. */
    name:    string;
    isPtt:   boolean;
    isVideo: boolean;
    isData:  boolean;
}

/**
 * Mirrors AffiliateRequest (core/Modules/Session/AffiliateRequest.h) — one group
 * and the services to affiliate it to.
 *
 * Note that Sdk::Affiliate is state-REPLACING: the array passed to affiliate() is
 * the complete desired set, never a delta.
 */
export interface McSdkAffiliateRequest {
    groupId: string;
    ptt:     boolean;
    video:   boolean;
    data:    boolean;
}

/**
 * Mirrors IdentityInfo (core/Modules/Session/IdentityInfo.h) minus the access
 * token, which the bridge does not forward — it is a credential the UI has no
 * use for. Flags are the MC services the user is registered (authorized) for.
 */
export interface IdentityUpdatedEvent {
    isPtt:   boolean;
    isVideo: boolean;
    isData:  boolean;
}

/** Payload of McSdkGroupsUpdated — groups the user MAY affiliate to. */
export interface GroupsUpdatedEvent {
    groups: McSdkGroupInfo[];
}

/** Payload of McSdkAffiliationsUpdated — the groups currently affiliated. */
export interface AffiliationsUpdatedEvent {
    groups: McSdkGroupInfo[];
}
