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

// ── Singleton MMKV instance ────────────────────────────────────────────────────

const storage = new MMKV({ id: 'app-settings' });

// ── App-level settings (theme, language) ──────────────────────────────────────

export type AppTheme = 'dark' | 'light';
export type AppLanguage = 'tr' | 'en';

export const THEME_KEY    = 'app.theme';
export const LANGUAGE_KEY = 'app.language';

export const AppSettings = {
  getTheme(): AppTheme {
    return (storage.getString(THEME_KEY) as AppTheme) ?? 'dark';
  },
  setTheme(theme: AppTheme): void {
    storage.set(THEME_KEY, theme);
  },

  getLanguage(): AppLanguage {
    return (storage.getString(LANGUAGE_KEY) as AppLanguage) ?? 'en';
  },
  setLanguage(lang: AppLanguage): void {
    storage.set(LANGUAGE_KEY, lang);
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
      logEnabled:       storage.getBoolean(sdkKey('logEnabled'))   ?? SDK_DEFAULTS.logEnabled,
      logLevel:         storage.getString(sdkKey('logLevel'))       ?? SDK_DEFAULTS.logLevel,
      pjLogEnabled:     storage.getBoolean(sdkKey('pjLogEnabled'))  ?? SDK_DEFAULTS.pjLogEnabled,
      pjLogLevel:       storage.getString(sdkKey('pjLogLevel'))     ?? SDK_DEFAULTS.pjLogLevel,
      rxTxEnabled:      storage.getBoolean(sdkKey('rxTxEnabled'))   ?? SDK_DEFAULTS.rxTxEnabled,
      httpPort:         storage.getString(sdkKey('httpPort'))       ?? SDK_DEFAULTS.httpPort,
      sipUdpPort:       storage.getString(sdkKey('sipUdpPort'))     ?? SDK_DEFAULTS.sipUdpPort,
      sipTcpEnabled:    storage.getBoolean(sdkKey('sipTcpEnabled')) ?? SDK_DEFAULTS.sipTcpEnabled,
      sipTcpPort:       storage.getString(sdkKey('sipTcpPort'))     ?? SDK_DEFAULTS.sipTcpPort,
      sipTlsEnabled:    storage.getBoolean(sdkKey('sipTlsEnabled')) ?? SDK_DEFAULTS.sipTlsEnabled,
      sipTlsPort:       storage.getString(sdkKey('sipTlsPort'))     ?? SDK_DEFAULTS.sipTlsPort,
      sipIpv6Enabled:   storage.getBoolean(sdkKey('sipIpv6Enabled'))?? SDK_DEFAULTS.sipIpv6Enabled,
      mTlsEnabled:      storage.getBoolean(sdkKey('mTlsEnabled'))   ?? SDK_DEFAULTS.mTlsEnabled,
      certPath:         storage.getString(sdkKey('certPath'))       ?? SDK_DEFAULTS.certPath,
      privKeyPath:      storage.getString(sdkKey('privKeyPath'))    ?? SDK_DEFAULTS.privKeyPath,
      caListPath:       storage.getString(sdkKey('caListPath'))     ?? SDK_DEFAULTS.caListPath,
      sipRxThreads:     storage.getString(sdkKey('sipRxThreads'))   ?? SDK_DEFAULTS.sipRxThreads,
      sipWorkerThreads: storage.getString(sdkKey('sipWorkerThreads'))?? SDK_DEFAULTS.sipWorkerThreads,
    };
  },

  save(values: SdkSettingsSchema): void {
    storage.set(sdkKey('logEnabled'),       values.logEnabled);
    storage.set(sdkKey('logLevel'),         values.logLevel);
    storage.set(sdkKey('pjLogEnabled'),     values.pjLogEnabled);
    storage.set(sdkKey('pjLogLevel'),       values.pjLogLevel);
    storage.set(sdkKey('rxTxEnabled'),      values.rxTxEnabled);
    storage.set(sdkKey('httpPort'),         values.httpPort);
    storage.set(sdkKey('sipUdpPort'),       values.sipUdpPort);
    storage.set(sdkKey('sipTcpEnabled'),    values.sipTcpEnabled);
    storage.set(sdkKey('sipTcpPort'),       values.sipTcpPort);
    storage.set(sdkKey('sipTlsEnabled'),    values.sipTlsEnabled);
    storage.set(sdkKey('sipTlsPort'),       values.sipTlsPort);
    storage.set(sdkKey('sipIpv6Enabled'),   values.sipIpv6Enabled);
    storage.set(sdkKey('mTlsEnabled'),      values.mTlsEnabled);
    storage.set(sdkKey('certPath'),         values.certPath);
    storage.set(sdkKey('privKeyPath'),      values.privKeyPath);
    storage.set(sdkKey('caListPath'),       values.caListPath);
    storage.set(sdkKey('sipRxThreads'),     values.sipRxThreads);
    storage.set(sdkKey('sipWorkerThreads'), values.sipWorkerThreads);
  },

  reset(): void {
    Object.keys(SDK_DEFAULTS).forEach(k => storage.delete(sdkKey(k as keyof SdkSettingsSchema)));
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
      maxFileSize: storage.getNumber('log.maxFileSize') ?? LOG_ROTATION_DEFAULTS.maxFileSize,
      maxFiles:    storage.getNumber('log.maxFiles')    ?? LOG_ROTATION_DEFAULTS.maxFiles,
    };
  },
  save(v: LogRotationSettings): void {
    storage.set('log.maxFileSize', v.maxFileSize);
    storage.set('log.maxFiles',    v.maxFiles);
  },
} as const;
