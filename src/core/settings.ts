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

// Auto-restore on module load (runs synchronously before AppContext renders).
const _lastUser = globalStorage.getString('auth.lastUsername');
if (
  (globalStorage.getBoolean('auth.stayLoggedIn') ?? false) &&
  (globalStorage.getBoolean('auth.isLoggedIn')   ?? false) &&
  _lastUser
) {
  userStorage = new MMKV({ id: `user-${_lastUser}` });
}

/** Switch to app-anonymous partition. Call on logout. */
export function clearUserStorage(): void {
  userStorage = new MMKV({ id: 'app-anonymous' });
}

/** Switch to the given user's partition. Call on successful login. */
export function initUserStorage(username: string): void {
  userStorage = new MMKV({ id: `user-${username}` });
}

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

interface SdkSettingsSchema {
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
}

export const SDK_DEFAULTS: SdkSettingsSchema = {
  logEnabled:       true,
  logLevel:         '0',
  pjLogEnabled:     true,
  pjLogLevel:       '0',
  rxTxEnabled:      true,
  httpPort:         '8008',
  sipUdpPort:       '5060',
  sipTcpEnabled:    false,
  sipTcpPort:       '5060',
  sipTlsEnabled:    false,
  sipTlsPort:       '5061',
  sipIpv6Enabled:   false,
  mTlsEnabled:      false,
  certPath:         'cert/client.crt',
  privKeyPath:      'cert/client.key',
  caListPath:       'cert/ca.pem',
  sipRxThreads:     '1',
  sipWorkerThreads: '1',
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
      sipTcpEnabled:    userStorage.getBoolean(sdkKey('sipTcpEnabled')) ?? SDK_DEFAULTS.sipTcpEnabled,
      sipTcpPort:       userStorage.getString(sdkKey('sipTcpPort'))     ?? SDK_DEFAULTS.sipTcpPort,
      sipTlsEnabled:    userStorage.getBoolean(sdkKey('sipTlsEnabled')) ?? SDK_DEFAULTS.sipTlsEnabled,
      sipTlsPort:       userStorage.getString(sdkKey('sipTlsPort'))     ?? SDK_DEFAULTS.sipTlsPort,
      sipIpv6Enabled:   userStorage.getBoolean(sdkKey('sipIpv6Enabled'))?? SDK_DEFAULTS.sipIpv6Enabled,
      mTlsEnabled:      userStorage.getBoolean(sdkKey('mTlsEnabled'))   ?? SDK_DEFAULTS.mTlsEnabled,
      certPath:         userStorage.getString(sdkKey('certPath'))       ?? SDK_DEFAULTS.certPath,
      privKeyPath:      userStorage.getString(sdkKey('privKeyPath'))    ?? SDK_DEFAULTS.privKeyPath,
      caListPath:       userStorage.getString(sdkKey('caListPath'))     ?? SDK_DEFAULTS.caListPath,
      sipRxThreads:     userStorage.getString(sdkKey('sipRxThreads'))   ?? SDK_DEFAULTS.sipRxThreads,
      sipWorkerThreads: userStorage.getString(sdkKey('sipWorkerThreads'))?? SDK_DEFAULTS.sipWorkerThreads,
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
