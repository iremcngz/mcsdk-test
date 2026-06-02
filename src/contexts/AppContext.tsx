/**
 * contexts/AppContext.tsx — App-wide UI state: theme, language, log rotation.
 *
 * Wraps: configureLogger (runs once on mount), MMKV-persisted appearance
 * settings, and log rotation settings.
 *
 * Consumed via: useAppContext()
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppSettings,
  AuthSettings,
  LogRotationSettings,
  initUserStorage,
  clearUserStorage,
  type AppTheme,
  type AppLanguage,
} from '../core/settings';
import { configureLogger } from '../core/logger';
import { initDb, getAllDocuments } from '../core/db';
import type { McSdkDocument } from '../mcsdk/types';
import { getThemePalette, type ThemePalette } from '../core/theme';
import { getTranslation, type Translations } from '../core/i18n';
import { saveCredentials, touchLogin } from '../core/auth';

// ── Context value ──────────────────────────────────────────────────────────────

interface AppContextValue {
  theme: AppTheme;
  language: AppLanguage;
  /** Derived theme palette — recalculated on theme change only. */
  c: ThemePalette;
  /** Derived translation bundle — recalculated on language change only. */
  tr: Translations;
  maxFileSize: number;
  maxFiles: number;
  setTheme: (t: AppTheme) => void;
  setLanguage: (l: AppLanguage) => void;
  setMaxFileSize: (v: number) => void;
  setMaxFiles: (v: number) => void;

  // ── Documents cache (pre-loaded at startup for all users)
  /** All cached BMS documents keyed by mcId. Available before login. */
  cachedDocsMap: Map<string, McSdkDocument[]>;
  /** Updates the in-memory cache for a single mcId after onDocumentsUpdated. */
  updateCachedDocs: (mcId: string, docs: McSdkDocument[]) => void;

  // ── Auth
  isLoggedIn: boolean;
  stayLoggedIn: boolean;
  /** Returns true when credentials are saved, false on empty input. */
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setStayLoggedIn: (v: boolean) => void;
}

const AppContext = React.createContext<AppContextValue | null>(null);

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAppContext(): AppContextValue {
  const ctx = React.useContext(AppContext);
  if (!ctx) {
    throw new Error('useAppContext must be used inside <AppContextProvider>');
  }
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState]       = useState<AppTheme>(() => AppSettings.getTheme());
  const [language, setLanguageState] = useState<AppLanguage>(() => AppSettings.getLanguage());
  const [maxFileSize, setMaxFileSizeState] = useState<number>(
    () => LogRotationSettings.load().maxFileSize,
  );
  const [maxFiles, setMaxFilesState] = useState<number>(
    () => LogRotationSettings.load().maxFiles,
  );

  const [stayLoggedIn, setStayLoggedInState] = useState<boolean>(
    () => AuthSettings.getStayLoggedIn(),
  );
  const [isLoggedIn, setIsLoggedInState] = useState<boolean>(
    () => AuthSettings.getStayLoggedIn() && AuthSettings.getIsLoggedIn(),
  );

  const [cachedDocsMap, setCachedDocsMap] = useState<Map<string, McSdkDocument[]>>(
    () => new Map(),
  );

  const c  = useMemo(() => getThemePalette(theme), [theme]);
  const tr = useMemo(() => getTranslation(language), [language]);

  // Initialise FileLogger and SQLite DB once on mount; then pre-load all
  // cached BMS documents so they're available before the user logs in.
  useEffect(() => {
    configureLogger().catch(e =>
      console.warn('[AppContext] configureLogger failed:', e),
    );
    initDb()
      .then(() => getAllDocuments())
      .then(map => setCachedDocsMap(map))
      .catch(e => console.warn('[AppContext] DB init/load failed:', e));
  }, []);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    AppSettings.setTheme(t);
  }, []);

  const setLanguage = useCallback((l: AppLanguage) => {
    setLanguageState(l);
    AppSettings.setLanguage(l);
  }, []);

  const setMaxFileSize = useCallback((v: number) => {
    setMaxFileSizeState(v);
    LogRotationSettings.save({ maxFileSize: v, maxFiles });
  }, [maxFiles]);

  const setMaxFiles = useCallback((v: number) => {
    setMaxFilesState(v);
    LogRotationSettings.save({ maxFileSize, maxFiles: v });
  }, [maxFileSize]);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    if (!username.trim() || !password.trim()) { return false; }
    await saveCredentials(username, password); // upsert credentials + sets last_login_at
    await touchLogin(username);                // ensure last_login_at is always updated on login
    initUserStorage(username);
    AuthSettings.setLastUsername(username);
    setThemeState(AppSettings.getTheme());
    setLanguageState(AppSettings.getLanguage());
    const rot = LogRotationSettings.load();
    setMaxFileSizeState(rot.maxFileSize);
    setMaxFilesState(rot.maxFiles);
    setIsLoggedInState(true);
    if (AuthSettings.getStayLoggedIn()) {
      AuthSettings.setIsLoggedIn(true);
    }
    return true;
  }, []);

  const logout = useCallback(() => {
    setIsLoggedInState(false);
    AuthSettings.setIsLoggedIn(false);
    clearUserStorage();
  }, []);

  const setStayLoggedIn = useCallback((v: boolean) => {
    setStayLoggedInState(v);
    AuthSettings.setStayLoggedIn(v);
    if (v) {
      // Persist session immediately so next restart skips login.
      AuthSettings.setIsLoggedIn(true);
    } else {
      // Disabling clears persistence — next restart requires login.
      AuthSettings.setIsLoggedIn(false);
    }
  }, []);

  const updateCachedDocs = useCallback((mcId: string, docs: McSdkDocument[]) => {
    setCachedDocsMap(prev => new Map(prev).set(mcId, docs));
  }, []);

  const value: AppContextValue = useMemo(() => ({
    theme, language, c, tr,
    maxFileSize, maxFiles,
    setTheme, setLanguage, setMaxFileSize, setMaxFiles,
    cachedDocsMap, updateCachedDocs,
    isLoggedIn, stayLoggedIn, login, logout, setStayLoggedIn,
  }), [
    theme, language, c, tr,
    maxFileSize, maxFiles,
    setTheme, setLanguage, setMaxFileSize, setMaxFiles,
    cachedDocsMap, updateCachedDocs,
    isLoggedIn, stayLoggedIn, login, logout, setStayLoggedIn,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
