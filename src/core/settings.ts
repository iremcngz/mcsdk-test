/**
 * settings.ts — Persistent app settings via react-native-mmkv.
 *
 * All reads are synchronous (no await needed).
 * Values survive app restarts on both Android and iOS.
 *
 * Storage locations:
 *   Android: /data/data/<package>/files/mmkv/app-settings
 *   iOS:     <sandbox>/Library/Application Support/<bundle_id>/mmkv/app-settings
 */

import { MMKV } from 'react-native-mmkv';

// ── Global storage ─────────────────────────────────────────────────────────────
// Auth data (stayLoggedIn, isLoggedIn, lastUsername) is device-level and lives
// here regardless of which user is logged in.

const globalStorage = new MMKV({ id: 'app-global' });

// ── User-scoped storage ────────────────────────────────────────────────────────
// All user-specific settings (theme, language, SDK params, log rotation) live
// in a partition named `user-<username>`.  Starts as anonymous until a user
// logs in.  Module-level code below restores the last user's partition when
// "Stay Logged In" is active so that initial React state reads are correct.

let userStorage = new MMKV({ id: 'app-anonymous' });

/**
 * Clears TLS paths left over from when they had non-empty defaults.
 *
 * These are handed to OpenSSL as filesystem paths, and the old defaults
 * ('cert/client.crt', 'cert/ca.pem') named files that were never on the device,
 * so TLS setup failed before the request was sent and IDMS login could not
 * complete. The stored copy would survive the default change, hence the drop.
 *
 * Only removes values equal to those old defaults — a path the user typed is
 * left alone. Runs per partition, after each storage switch.
 */
function dropStaleTlsPaths(): void {
  // Keys spelled out rather than built from SDK_PREFIX/sdkKey(): both are
  // declared further down the module and `const` does not hoist, so calling
  // this during module load — which the stay-logged-in restore does — would
  // throw.
  const stale: Record<string, string> = {
    'sdk.certPath':    'cert/client.crt',
    'sdk.privKeyPath': 'cert/client.key',
    'sdk.caListPath':  'cert/ca.pem',
  };
  for (const [key, old] of Object.entries(stale)) {
    if (userStorage.getString(key) === old) userStorage.delete(key);
  }
}

// Auto-restore on module load (runs synchronously before AppContext renders).
const _lastUser = globalStorage.getString('auth.lastUsername');
if (
  (globalStorage.getBoolean('auth.stayLoggedIn') ?? false) &&
  (globalStorage.getBoolean('auth.isLoggedIn')   ?? false) &&
  _lastUser
) {
  userStorage = new MMKV({ id: `user-${_lastUser}` });
}
// Covers the restore above as well as the plain anonymous start: a logged-in
// launch never calls initUserStorage(), so clearing only there would miss the
// partition the app actually reads.
dropStaleTlsPaths();

/** Switch to app-anonymous partition. Call on logout. */
export function clearUserStorage(): void {
  userStorage = new MMKV({ id: 'app-anonymous' });
  dropStaleTlsPaths();
}

/** Switch to the given user's partition. Call on successful login. */
export function initUserStorage(username: string): void {
  userStorage = new MMKV({ id: `user-${username}` });
  dropStaleTlsPaths();
}

// ── MC client id ───────────────────────────────────────────────────────────────
// TS 24.379 requires the client to identify itself with a stable URN of the form
// "urn:uuid:<uuid>". It surfaces in the PUBLISH poc-settings body (as the
// <mcptt-client-id> element and the <entity id> attribute) and is passed to the
// SDK via setIdentity().
//
// It identifies the *client instance*, not the user, so it lives in global
// storage: it must survive logout and stay the same across users on this device,
// and it must NOT be regenerated on each launch (the server treats a new id as a
// different client instance).

const CLIENT_ID_KEY = 'device.mcClientId';

/** RFC 4122 version 4 UUID. Math.random is adequate here — this is an instance
 *  label, not a secret, and avoiding crypto keeps it free of a polyfill. */
function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const DeviceIdentity = {
  /** Stable "urn:uuid:<uuid>" for this install; generated once, then reused. */
  getMcClientId(): string {
    const existing = globalStorage.getString(CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = `urn:uuid:${uuidV4()}`;
    globalStorage.set(CLIENT_ID_KEY, generated);
    return generated;
  },

  /** Forces a new client id on the next read. For testing/support only. */
  resetMcClientId(): void {
    globalStorage.delete(CLIENT_ID_KEY);
  },
} as const;

// ── App-level settings (theme, language) ──────────────────────────────────────

export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'tr' | 'en';

export const THEME_KEY    = 'app.theme';
export const LANGUAGE_KEY = 'app.language';

export const AppSettings = {
  getTheme(): AppTheme {
    return (userStorage.getString(THEME_KEY) as AppTheme) ?? 'dark';
  },
  setTheme(theme: AppTheme): void {
    userStorage.set(THEME_KEY, theme);
  },

  getLanguage(): AppLanguage {
    return (userStorage.getString(LANGUAGE_KEY) as AppLanguage) ?? 'en';
  },
  setLanguage(lang: AppLanguage): void {
    userStorage.set(LANGUAGE_KEY, lang);
  },
} as const;

// ── SDK parameter settings ─────────────────────────────────────────────────────

const SDK_PREFIX = 'sdk.';

export interface SdkSettingsSchema {
  logEnabled:       boolean;
  logLevel:         string;
  pjLogEnabled:     boolean;
  pjLogLevel:       string;
  rxTxEnabled:      boolean;
  httpPort:         string;
  sipUdpPort:       string;
  sipTcpEnabled:    boolean;
  sipTcpPort:       string;
  sipTlsEnabled:    boolean;
  sipTlsPort:       string;
  sipIpv6Enabled:   boolean;
  mTlsEnabled:      boolean;
  certPath:         string;
  privKeyPath:      string;
  caListPath:       string;
  sipRxThreads:     string;
  sipWorkerThreads: string;
  idmsUrl: string;
  bmsUrl:  string;
  cmsUrl:  string;
  gmsUrl:  string;
}

export const SDK_DEFAULTS: SdkSettingsSchema = {
  logEnabled:       true,
  logLevel:         '0',
  pjLogEnabled:     true,
  pjLogLevel:       '0',
  rxTxEnabled:      true,
  httpPort:         '8008',
  sipUdpPort:       '5060',
  // SIP over TCP, on by default. Over UDP the MCX server accepts the
  // affiliation SUBSCRIBE with 200 OK but never sends the initial NOTIFY, so the
  // subscription never reaches ACTIVE and registration stalls in
  // SipAffiliating (AffiliationModule gates the phase on that state).
  sipTcpEnabled:    true,
  sipTcpPort:       '5060',
  sipTlsEnabled:    false,
  sipTlsPort:       '5061',
  sipIpv6Enabled:   false,
  mTlsEnabled:      false,
  // Empty on purpose. The SDK hands these straight to OpenSSL as filesystem
  // paths, so a non-empty default has to name a file that exists on the device
  // or the connection fails before it is made: httplib turns a failed
  // SSL_CTX_load_verify_locations into Error::SSLLoadingCerts ("SSL certificate
  // loading failed") and never sends the request. The old 'cert/ca.pem' default
  // pointed at nothing and blocked IDMS login once the SDK started applying it
  // (98fb4c6). Empty means httplib falls back to the system certificate store,
  // which is the right default; set a real absolute path to pin a CA.
  certPath:         '',
  privKeyPath:      '',
  caListPath:       '',
  sipRxThreads:     '1',
  sipWorkerThreads: '1',
  idmsUrl: '',
  // Required: the SDK has no default for it, and registration cannot start
  // without it (the IDMS/CMS/GMS endpoints are all read from the BMS documents).
  bmsUrl:  'http://10.11.100.109',
  cmsUrl:  '',
  gmsUrl:  '',
};

function sdkKey(k: keyof SdkSettingsSchema): string {
  return SDK_PREFIX + k;
}

export const SdkSettings = {
  load(): SdkSettingsSchema {
    return {
      logEnabled:       userStorage.getBoolean(sdkKey('logEnabled'))   ?? SDK_DEFAULTS.logEnabled,
      logLevel:         userStorage.getString(sdkKey('logLevel'))       ?? SDK_DEFAULTS.logLevel,
      pjLogEnabled:     userStorage.getBoolean(sdkKey('pjLogEnabled'))  ?? SDK_DEFAULTS.pjLogEnabled,
      pjLogLevel:       userStorage.getString(sdkKey('pjLogLevel'))     ?? SDK_DEFAULTS.pjLogLevel,
      rxTxEnabled:      userStorage.getBoolean(sdkKey('rxTxEnabled'))   ?? SDK_DEFAULTS.rxTxEnabled,
      httpPort:         userStorage.getString(sdkKey('httpPort'))       ?? SDK_DEFAULTS.httpPort,
      sipUdpPort:       userStorage.getString(sdkKey('sipUdpPort'))     ?? SDK_DEFAULTS.sipUdpPort,
      // Forced on rather than read back: registration needs SIP over TCP, and a
      // stored `false` from before this was the default would silently stall the
      // SipAffiliating phase again. The settings switch still works for the
      // current session; it just does not persist an off state across restarts.
      sipTcpEnabled:    true,
      sipTcpPort:       userStorage.getString(sdkKey('sipTcpPort'))     ?? SDK_DEFAULTS.sipTcpPort,
      sipTlsEnabled:    userStorage.getBoolean(sdkKey('sipTlsEnabled')) ?? SDK_DEFAULTS.sipTlsEnabled,
      sipTlsPort:       userStorage.getString(sdkKey('sipTlsPort'))     ?? SDK_DEFAULTS.sipTlsPort,
      sipIpv6Enabled:   userStorage.getBoolean(sdkKey('sipIpv6Enabled'))?? SDK_DEFAULTS.sipIpv6Enabled,
      mTlsEnabled:      userStorage.getBoolean(sdkKey('mTlsEnabled'))   ?? SDK_DEFAULTS.mTlsEnabled,
      // Dropped once, not read back: installs from before these defaults were
      // emptied have 'cert/client.crt' / 'cert/ca.pem' saved, and a stored path
      // naming a file that is not on the device fails TLS setup outright. The
      // one-off clear below removes those so the empty default can take effect;
      // a path typed in settings afterwards persists normally.
      certPath:         userStorage.getString(sdkKey('certPath'))       ?? SDK_DEFAULTS.certPath,
      privKeyPath:      userStorage.getString(sdkKey('privKeyPath'))    ?? SDK_DEFAULTS.privKeyPath,
      caListPath:       userStorage.getString(sdkKey('caListPath'))     ?? SDK_DEFAULTS.caListPath,
      sipRxThreads:     userStorage.getString(sdkKey('sipRxThreads'))   ?? SDK_DEFAULTS.sipRxThreads,
      sipWorkerThreads: userStorage.getString(sdkKey('sipWorkerThreads'))?? SDK_DEFAULTS.sipWorkerThreads,
      idmsUrl:          userStorage.getString(sdkKey('idmsUrl'))        ?? SDK_DEFAULTS.idmsUrl,
      // `|| default`, not `??`: an empty string is a stored value, so `??` would
      // keep it and leave the SDK with no provisioning server. Installs that ran
      // before bmsUrl had a default have exactly that empty string saved.
      bmsUrl:           userStorage.getString(sdkKey('bmsUrl')) || SDK_DEFAULTS.bmsUrl,
      cmsUrl:           userStorage.getString(sdkKey('cmsUrl'))         ?? SDK_DEFAULTS.cmsUrl,
      gmsUrl:           userStorage.getString(sdkKey('gmsUrl'))         ?? SDK_DEFAULTS.gmsUrl,
    };
  },

  save(values: SdkSettingsSchema): void {
    userStorage.set(sdkKey('logEnabled'),       values.logEnabled);
    userStorage.set(sdkKey('logLevel'),         values.logLevel);
    userStorage.set(sdkKey('pjLogEnabled'),     values.pjLogEnabled);
    userStorage.set(sdkKey('pjLogLevel'),       values.pjLogLevel);
    userStorage.set(sdkKey('rxTxEnabled'),      values.rxTxEnabled);
    userStorage.set(sdkKey('httpPort'),         values.httpPort);
    userStorage.set(sdkKey('sipUdpPort'),       values.sipUdpPort);
    userStorage.set(sdkKey('sipTcpEnabled'),    values.sipTcpEnabled);
    userStorage.set(sdkKey('sipTcpPort'),       values.sipTcpPort);
    userStorage.set(sdkKey('sipTlsEnabled'),    values.sipTlsEnabled);
    userStorage.set(sdkKey('sipTlsPort'),       values.sipTlsPort);
    userStorage.set(sdkKey('sipIpv6Enabled'),   values.sipIpv6Enabled);
    userStorage.set(sdkKey('mTlsEnabled'),      values.mTlsEnabled);
    userStorage.set(sdkKey('certPath'),         values.certPath);
    userStorage.set(sdkKey('privKeyPath'),      values.privKeyPath);
    userStorage.set(sdkKey('caListPath'),       values.caListPath);
    userStorage.set(sdkKey('sipRxThreads'),     values.sipRxThreads);
    userStorage.set(sdkKey('sipWorkerThreads'), values.sipWorkerThreads);
    userStorage.set(sdkKey('idmsUrl'),          values.idmsUrl);
    userStorage.set(sdkKey('bmsUrl'),           values.bmsUrl);
    userStorage.set(sdkKey('cmsUrl'),           values.cmsUrl);
    userStorage.set(sdkKey('gmsUrl'),           values.gmsUrl);
  },

  reset(): void {
    Object.keys(SDK_DEFAULTS).forEach(k => userStorage.delete(sdkKey(k as keyof SdkSettingsSchema)));
  },
} as const;

// ── Log rotation settings ──────────────────────────────────────────────────────

export interface LogRotationSettings {
  maxFileSize: number;   // bytes — default 2 MB
  maxFiles:    number;   // how many rotated files to keep — default 3
}

export const LOG_ROTATION_DEFAULTS: LogRotationSettings = {
  maxFileSize: 2 * 1024 * 1024,   // 2 MB
  maxFiles:    0,                 // 0 = unlimited
};

export const LogRotationSettings = {
  load(): LogRotationSettings {
    return {
      maxFileSize: userStorage.getNumber('log.maxFileSize') ?? LOG_ROTATION_DEFAULTS.maxFileSize,
      maxFiles:    userStorage.getNumber('log.maxFiles')    ?? LOG_ROTATION_DEFAULTS.maxFiles,
    };
  },
  save(v: LogRotationSettings): void {
    userStorage.set('log.maxFileSize', v.maxFileSize);
    userStorage.set('log.maxFiles',    v.maxFiles);
  },
} as const;

// ── Auth settings ──────────────────────────────────────────────────────────────
// stayLoggedIn: if true, persists the logged-in flag so the user skips the
// login screen on the next app launch. If false (default), the session is
// ephemeral — the user must log in again after restarting the app.

export const AuthSettings = {
  getStayLoggedIn(): boolean {
    return globalStorage.getBoolean('auth.stayLoggedIn') ?? false;
  },
  setStayLoggedIn(v: boolean): void {
    globalStorage.set('auth.stayLoggedIn', v);
  },
  getIsLoggedIn(): boolean {
    return globalStorage.getBoolean('auth.isLoggedIn') ?? false;
  },
  setIsLoggedIn(v: boolean): void {
    globalStorage.set('auth.isLoggedIn', v);
  },
  getLastUsername(): string | undefined {
    return globalStorage.getString('auth.lastUsername');
  },
  setLastUsername(username: string): void {
    globalStorage.set('auth.lastUsername', username);
  },
} as const;
