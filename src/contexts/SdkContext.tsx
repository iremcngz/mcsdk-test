/**
 * contexts/SdkContext.tsx — SDK lifecycle state, parameter state, log
 * buffers, IP monitoring, and all SDK action handlers.
 *
 * Must be rendered inside <AppContextProvider> because handleIpChange
 * reads `tr` from AppContext to produce the translated log message.
 *
 * Consumed via: useSdkContext()
 */

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { McSdk, type McSdkParams, type LogEvent, type RegistrationEvent, type StoreDocumentsEvent } from '../mcsdk';
import { SdkSettings, type SdkSettingsSchema } from '../core/settings';
import { AppLogger, SdkLogger } from '../core/logger';
import { useIpMonitor, type IpInfo } from '../core/netMonitor';
import { useAppContext } from './AppContext';
import { getCredentials } from '../core/auth';
import { AuthSettings } from '../core/settings';
import { saveDocuments } from '../core/db';
import type { LogEntry, SdkLogEntry } from '../shared/types';

// ── Module-level counters (reset across hot-reloads intentionally) ─────────────

let nextId    = 0;
let sdkLogId  = 0;

function stamp(): string {
  const d = new Date();
  return (
    d.getHours().toString().padStart(2, '0') + ':' +
    d.getMinutes().toString().padStart(2, '0') + ':' +
    d.getSeconds().toString().padStart(2, '0')
  );
}

const PHASE_LABELS: Record<number, string> = {
  0: 'Idle',
  1: 'Downloading BMS',
  2: 'Authenticating',
  3: 'Downloading Config',
  4: 'SIP Registering',
  5: 'SIP Affiliating',
  6: 'Done',
};

const STATE_LABELS: Record<number, string> = {
  0: 'Unregistered',
  1: 'Registering',
  2: 'Registered',
  3: 'Unregistering',
};

function phaseLabel(phase: number | string): string {
  if (typeof phase === 'number') return PHASE_LABELS[phase] ?? `Phase ${phase}`;
  return phase.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function stateLabel(state: number | string): string {
  if (typeof state === 'number') return STATE_LABELS[state] ?? `State ${state}`;
  return state.charAt(0) + state.slice(1).toLowerCase();
}

// ── Context value ──────────────────────────────────────────────────────────────

export interface SdkContextValue {
  sdkRef: React.RefObject<McSdk | null>;

  // Lifecycle flags
  created:     boolean;
  initialized: boolean;
  paramsSet:   boolean;

  // Log buffers
  logs:    LogEntry[];
  sdkLogs: SdkLogEntry[];
  addLog:  (msg: string, level?: LogEntry['level']) => void;
  clearLogs:    () => void;
  clearSdkLogs: () => void;

  // Network
  ipInfo: IpInfo;

  // SDK actions
  handleCreate:    () => Promise<void>;
  handleSetParams: () => void;
  handleInit:      () => Promise<void>;
  handleDestroy:   () => void;

  // Registration
  registrationProgress: number;
  registrationPhase:    string;
  registrationState:    string;

  // SDK parameters (18 fields from SdkSettings)
  logEnabled:       boolean;  setLogEnabled:       (v: boolean) => void;
  logLevel:         string;   setLogLevel:         (v: string)  => void;
  pjLogEnabled:     boolean;  setPjLogEnabled:     (v: boolean) => void;
  pjLogLevel:       string;   setPjLogLevel:       (v: string)  => void;
  rxTxEnabled:      boolean;  setRxTxEnabled:      (v: boolean) => void;
  httpPort:         string;   setHttpPort:         (v: string)  => void;
  sipUdpPort:       string;   setSipUdpPort:       (v: string)  => void;
  sipTcpEnabled:    boolean;  setSipTcpEnabled:    (v: boolean) => void;
  sipTcpPort:       string;   setSipTcpPort:       (v: string)  => void;
  sipTlsEnabled:    boolean;  setSipTlsEnabled:    (v: boolean) => void;
  sipTlsPort:       string;   setSipTlsPort:       (v: string)  => void;
  sipIpv6Enabled:   boolean;  setSipIpv6Enabled:   (v: boolean) => void;
  mTlsEnabled:      boolean;  setMTlsEnabled:      (v: boolean) => void;
  certPath:         string;   setCertPath:         (v: string)  => void;
  privKeyPath:      string;   setPrivKeyPath:      (v: string)  => void;
  caListPath:       string;   setCaListPath:       (v: string)  => void;
  sipRxThreads:     string;   setSipRxThreads:     (v: string)  => void;
  sipWorkerThreads: string;   setSipWorkerThreads: (v: string)  => void;
  idmsUrl: string; setIdmsUrl: (v: string)  => void;
  bmsUrl:  string; setBmsUrl:  (v: string)  => void;
  cmsUrl:  string; setCmsUrl:  (v: string)  => void;
  gmsUrl:  string; setGmsUrl:  (v: string)  => void;
  mcxMock: boolean; setMcxMock: (v: boolean) => void;
}

const SdkContext = React.createContext<SdkContextValue | null>(null);

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useSdkContext(): SdkContextValue {
  const ctx = React.useContext(SdkContext);
  if (!ctx) {
    throw new Error('useSdkContext must be used inside <SdkContextProvider>');
  }
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function SdkContextProvider({ children }: { children: React.ReactNode }) {
  const { tr, cachedDocsMap, updateCachedDocs } = useAppContext();

  const sdkRef = useRef<McSdk | null>(null);
  // Tracks the currently authenticated mcId so documents can be scoped per user
  const currentMcIdRef = useRef<string | null>(null);

  // ── Lifecycle flags ────────────────────────────────────────────────────────
  const [created,     setCreated]     = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [paramsSet,   setParamsSet]   = useState(false);

  // ── Registration state ─────────────────────────────────────────────────────
  const [registrationProgress, setRegistrationProgress] = useState(0);
  const [registrationPhase,    setRegistrationPhase]    = useState('');
  const [registrationState,    setRegistrationState]    = useState('');

  // ── SDK parameter state ────────────────────────────────────────────────────
  // All 25 SDK parameters live in a single object (shape = SdkSettingsSchema).
  // Per-field setters below are derived from it, so the public context API
  // (sdk.logLevel / sdk.setLogLevel(...)) stays exactly the same as before.
  const [params, setParams] = useState<SdkSettingsSchema>(() => SdkSettings.load());

  // Generic field updater — the single source of truth for all param changes.
  const updateParam = useCallback(
    <K extends keyof SdkSettingsSchema>(key: K, value: SdkSettingsSchema[K]) => {
      setParams(prev => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Stable per-field setters that preserve the original flat API. Built once so
  // their identity never changes between renders (matches the old useState
  // setters, which were also stable).
  const setters = useMemo(() => ({
    setLogEnabled:       (v: boolean) => updateParam('logEnabled', v),
    setLogLevel:         (v: string)  => updateParam('logLevel', v),
    setPjLogEnabled:     (v: boolean) => updateParam('pjLogEnabled', v),
    setPjLogLevel:       (v: string)  => updateParam('pjLogLevel', v),
    setRxTxEnabled:      (v: boolean) => updateParam('rxTxEnabled', v),
    setHttpPort:         (v: string)  => updateParam('httpPort', v),
    setSipUdpPort:       (v: string)  => updateParam('sipUdpPort', v),
    setSipTcpEnabled:    (v: boolean) => updateParam('sipTcpEnabled', v),
    setSipTcpPort:       (v: string)  => updateParam('sipTcpPort', v),
    setSipTlsEnabled:    (v: boolean) => updateParam('sipTlsEnabled', v),
    setSipTlsPort:       (v: string)  => updateParam('sipTlsPort', v),
    setSipIpv6Enabled:   (v: boolean) => updateParam('sipIpv6Enabled', v),
    setMTlsEnabled:      (v: boolean) => updateParam('mTlsEnabled', v),
    setCertPath:         (v: string)  => updateParam('certPath', v),
    setPrivKeyPath:      (v: string)  => updateParam('privKeyPath', v),
    setCaListPath:       (v: string)  => updateParam('caListPath', v),
    setSipRxThreads:     (v: string)  => updateParam('sipRxThreads', v),
    setSipWorkerThreads: (v: string)  => updateParam('sipWorkerThreads', v),
    setIdmsUrl:          (v: string)  => updateParam('idmsUrl', v),
    setBmsUrl:           (v: string)  => updateParam('bmsUrl', v),
    setCmsUrl:           (v: string)  => updateParam('cmsUrl', v),
    setGmsUrl:           (v: string)  => updateParam('gmsUrl', v),
    // Context exposes this as `mcxMock`; the schema field is `mock`.
    setMcxMock:          (v: boolean) => updateParam('mock', v),
  }), [updateParam]);

  // ── Log buffers ────────────────────────────────────────────────────────────
  const [logs,    setLogs]    = useState<LogEntry[]>([]);
  const [sdkLogs, setSdkLogs] = useState<SdkLogEntry[]>([]);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, { id: nextId++, time: stamp(), msg, level }]);
    if (level === 'error')     { AppLogger.error(msg); }
    else if (level === 'warn') { AppLogger.warn(msg); }
    else                       { AppLogger.info(msg); }
  }, []);

  const clearLogs    = useCallback(() => setLogs([]), []);
  const clearSdkLogs = useCallback(() => setSdkLogs([]), []);

  // ── Network / IP monitor ───────────────────────────────────────────────────
  const handleIpChange = useCallback((prev: IpInfo, curr: IpInfo) => {
    addLog(tr.ipChanged(prev.ip, curr.ip), 'warn');
  }, [addLog, tr]);
  const ipInfo = useIpMonitor(handleIpChange);

  // ── SDK actions ────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    try {
      sdkRef.current = new McSdk();
      setCreated(true);
      setInitialized(false);
      setParamsSet(false);
      setRegistrationProgress(0);
      setRegistrationPhase('');
      setRegistrationState('');
      addLog('McSdk() → nativeCreate() OK — listeners auto-bound');

      sdkRef.current.onLog((e: LogEvent) => {
        const levelNames = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
        addLog(`[SDK ${levelNames[e.level] ?? e.level}] ${e.log}`, 'sdk');
        SdkLogger.write(e.level, e.log);
        setSdkLogs(prev => [
          ...prev,
          { id: sdkLogId++, time: stamp(), level: e.level, msg: e.log },
        ]);
      });

      sdkRef.current.onRegistration((e: RegistrationEvent) => {
        setRegistrationProgress(e.progress);
        setRegistrationPhase(phaseLabel(e.phase));
        setRegistrationState(stateLabel(e.state));
      });

      // Subscribe to BMS document cache events.
      // When the SDK fetches documents from the BMS server it fires
      // onDocumentsUpdated; we persist them and update the in-memory cache
      // so they can be restored on the next session via setDocuments().
      sdkRef.current.onStoreDocuments(async (e: StoreDocumentsEvent) => {
        const mcId = currentMcIdRef.current;
        if (!mcId) return;
        try {
          await saveDocuments(mcId, e.docs);
          updateCachedDocs(mcId, e.docs);
          addLog(`onDocumentsUpdated: saved ${e.docs.length} doc(s) for ${mcId}`);
        } catch (err: any) {
          addLog(`onDocumentsUpdated: save failed — ${err.message}`, 'error');
        }
      });

      // Automatically set identity from stored credentials
      const lastUser = AuthSettings.getLastUsername();
      if (lastUser) {
        const creds = await getCredentials(lastUser);
        if (creds) {
          sdkRef.current.setIdentity(creds.username, creds.password);
          addLog(`setIdentity(${creds.username}) called`);
          currentMcIdRef.current = creds.username;
        }
      }
    } catch (err: any) {
      addLog(`Create failed: ${err.message}`, 'error');
    }
  }, [addLog, updateCachedDocs]);

  const handleSetParams = useCallback(() => {
    if (!sdkRef.current) {
      addLog('SDK not created yet — call Create first', 'warn');
      return;
    }
    try {
      const mcParams: McSdkParams = {
        Logging: {
          enabled: params.logEnabled,
          level: Number(params.logLevel) as any,
          pjEnabled: params.pjLogEnabled,
          pjLevel: Number(params.pjLogLevel) as any,
          rxTxEnabled: params.rxTxEnabled,
        },
        Http: { port: Number(params.httpPort) },
        Sip: {
          udpPort:     Number(params.sipUdpPort),
          tcpEnabled:  params.sipTcpEnabled,
          tcpPort:     Number(params.sipTcpPort),
          tlsEnabled:  params.sipTlsEnabled,
          tlsPort:     Number(params.sipTlsPort),
          ipv6Enabled: params.sipIpv6Enabled,
        },
        Tls: {
          mTlsEnabled: params.mTlsEnabled,
          certPath:    params.certPath,
          privKeyPath: params.privKeyPath,
          caListPath:  params.caListPath,
        },
        Threading: {
          sipRxThreadCount:     Number(params.sipRxThreads),
          sipWorkerThreadCount: Number(params.sipWorkerThreads),
        },
        Mcx: {
          idmsUrl: params.idmsUrl,
          bmsUrl:  params.bmsUrl,
          cmsUrl:  params.cmsUrl,
          gmsUrl:  params.gmsUrl,
          mock:    params.mock,
        },
      };
      sdkRef.current.setParams(mcParams);
      setParamsSet(true);
      addLog('setParams() called successfully');
      addLog(`  Logging: enabled=${params.logEnabled} level=${params.logLevel}`);
      addLog(`  Http: port=${params.httpPort}`);
      addLog(`  Sip: udp=${params.sipUdpPort} tcp=${params.sipTcpEnabled}:${params.sipTcpPort} tls=${params.sipTlsEnabled}:${params.sipTlsPort}`);
      SdkSettings.save(params);
    } catch (err: any) {
      addLog(`setParams() failed: ${err.message}`, 'error');
    }
  }, [addLog, params]);

  const handleInit = useCallback(async () => {
    if (!sdkRef.current) {
      addLog('SDK not created yet — call Create first', 'warn');
      return;
    }
    if (!paramsSet) {
      addLog('setParams() not called yet — call Set Parameters first', 'warn');
    }
    try {
      const result = await sdkRef.current.init();
      setInitialized(result);
      addLog(`init() returned: ${result}`, result ? 'info' : 'error');
      if (result) {
        // Restore cached BMS documents before registration (FIFO queue —
        // setDocuments is processed by the engine before Register()).
        const mcId = currentMcIdRef.current;
        if (mcId) {
          try {
            const docs = cachedDocsMap.get(mcId) ?? [];
            if (docs.length > 0) {
              sdkRef.current.setDocuments(docs);
              addLog(`setDocuments(): ${docs.length} cached doc(s) provided to SDK`);
            }
          } catch (err: any) {
            addLog(`setDocuments() cache read failed — ${err.message}`, 'warn');
          }
        }
        sdkRef.current.register();
        addLog('register() called → waiting for registration callbacks...');
      }
    } catch (err: any) {
      addLog(`init() threw: ${err.message}`, 'error');
    }
  }, [addLog, cachedDocsMap, paramsSet]);

  const handleDestroy = useCallback(() => {
    if (!sdkRef.current) {
      addLog('SDK not created — nothing to destroy', 'warn');
      return;
    }
    try {
      sdkRef.current.destroy();
      sdkRef.current = null;
      setCreated(false);
      setInitialized(false);
      setParamsSet(false);
      addLog('destroy() called — C++ Sdk destroyed');
    } catch (err: any) {
      addLog(`destroy() failed: ${err.message}`, 'error');
    }
  }, [addLog]);

  // ── Memoised value ────────────────────────────────────────────────────────
  // The flat per-field API is rebuilt here by spreading `params` (the single
  // state object) and `setters` (the stable derived setters). Consumers still
  // read sdk.logLevel / call sdk.setLogLevel(...) exactly as before; the
  // `mcxMock` field maps onto the schema's `mock` key.
  const value: SdkContextValue = useMemo(() => ({
    sdkRef,
    created, initialized, paramsSet,
    logs, sdkLogs, addLog, clearLogs, clearSdkLogs,
    ipInfo,
    registrationProgress, registrationPhase, registrationState,
    handleCreate, handleSetParams, handleInit, handleDestroy,
    ...params,
    mcxMock: params.mock,
    ...setters,
  }), [
    created, initialized, paramsSet,
    logs, sdkLogs, addLog, clearLogs, clearSdkLogs,
    ipInfo,
    registrationProgress, registrationPhase, registrationState,
    handleCreate, handleSetParams, handleInit, handleDestroy,
    params, setters,
  ]);

  return <SdkContext.Provider value={value}>{children}</SdkContext.Provider>;
}
