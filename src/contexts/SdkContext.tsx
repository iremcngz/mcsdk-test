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
import { McSdk, type McSdkParams, type LogEvent, type RegistrationEvent } from '../mcsdk';
import { SdkSettings } from '../core/settings';
import { AppLogger, SdkLogger } from '../core/logger';
import { useIpMonitor, type IpInfo } from '../core/netMonitor';
import { useAppContext } from './AppContext';
import { getCredentials } from '../core/auth';
import { AuthSettings } from '../core/settings';
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
  const { tr } = useAppContext();

  const sdkRef = useRef<McSdk | null>(null);

  // ── Lifecycle flags ────────────────────────────────────────────────────────
  const [created,     setCreated]     = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [paramsSet,   setParamsSet]   = useState(false);

  // ── Registration state ─────────────────────────────────────────────────────
  const [registrationProgress, setRegistrationProgress] = useState(0);
  const [registrationPhase,    setRegistrationPhase]    = useState('');
  const [registrationState,    setRegistrationState]    = useState('');

  // ── SDK parameter state ────────────────────────────────────────────────────
  const [_init] = useState(() => SdkSettings.load());
  const [logEnabled,       setLogEnabled]       = useState(_init.logEnabled);
  const [logLevel,         setLogLevel]         = useState(_init.logLevel);
  const [pjLogEnabled,     setPjLogEnabled]     = useState(_init.pjLogEnabled);
  const [pjLogLevel,       setPjLogLevel]       = useState(_init.pjLogLevel);
  const [rxTxEnabled,      setRxTxEnabled]      = useState(_init.rxTxEnabled);
  const [httpPort,         setHttpPort]         = useState(_init.httpPort);
  const [sipUdpPort,       setSipUdpPort]       = useState(_init.sipUdpPort);
  const [sipTcpEnabled,    setSipTcpEnabled]    = useState(_init.sipTcpEnabled);
  const [sipTcpPort,       setSipTcpPort]       = useState(_init.sipTcpPort);
  const [sipTlsEnabled,    setSipTlsEnabled]    = useState(_init.sipTlsEnabled);
  const [sipTlsPort,       setSipTlsPort]       = useState(_init.sipTlsPort);
  const [sipIpv6Enabled,   setSipIpv6Enabled]   = useState(_init.sipIpv6Enabled);
  const [mTlsEnabled,      setMTlsEnabled]      = useState(_init.mTlsEnabled);
  const [certPath,         setCertPath]         = useState(_init.certPath);
  const [privKeyPath,      setPrivKeyPath]      = useState(_init.privKeyPath);
  const [caListPath,       setCaListPath]       = useState(_init.caListPath);
  const [sipRxThreads,     setSipRxThreads]     = useState(_init.sipRxThreads);
  const [sipWorkerThreads, setSipWorkerThreads] = useState(_init.sipWorkerThreads);

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

      // Automatically set identity from stored credentials
      const lastUser = AuthSettings.getLastUsername();
      if (lastUser) {
        const creds = await getCredentials(lastUser);
        if (creds) {
          sdkRef.current.setIdentity(creds.username, creds.password);
          addLog(`setIdentity(${creds.username}) called`);
        }
      }
    } catch (err: any) {
      addLog(`Create failed: ${err.message}`, 'error');
    }
  }, [addLog]);

  const handleSetParams = useCallback(() => {
    if (!sdkRef.current) {
      addLog('SDK not created yet — call Create first', 'warn');
      return;
    }
    try {
      const params: McSdkParams = {
        Logging: {
          enabled: logEnabled,
          level: Number(logLevel) as any,
          pjEnabled: pjLogEnabled,
          pjLevel: Number(pjLogLevel) as any,
          rxTxEnabled,
        },
        Http: { port: Number(httpPort) },
        Sip: {
          udpPort:     Number(sipUdpPort),
          tcpEnabled:  sipTcpEnabled,
          tcpPort:     Number(sipTcpPort),
          tlsEnabled:  sipTlsEnabled,
          tlsPort:     Number(sipTlsPort),
          ipv6Enabled: sipIpv6Enabled,
        },
        Tls: { mTlsEnabled, certPath, privKeyPath, caListPath },
        Threading: {
          sipRxThreadCount:     Number(sipRxThreads),
          sipWorkerThreadCount: Number(sipWorkerThreads),
        },
      };
      sdkRef.current.setParams(params);
      setParamsSet(true);
      addLog('setParams() called successfully');
      addLog(`  Logging: enabled=${logEnabled} level=${logLevel}`);
      addLog(`  Http: port=${httpPort}`);
      addLog(`  Sip: udp=${sipUdpPort} tcp=${sipTcpEnabled}:${sipTcpPort} tls=${sipTlsEnabled}:${sipTlsPort}`);
      SdkSettings.save({
        logEnabled, logLevel, pjLogEnabled, pjLogLevel, rxTxEnabled,
        httpPort, sipUdpPort, sipTcpEnabled, sipTcpPort, sipTlsEnabled,
        sipTlsPort, sipIpv6Enabled, mTlsEnabled, certPath, privKeyPath,
        caListPath, sipRxThreads, sipWorkerThreads,
      });
    } catch (err: any) {
      addLog(`setParams() failed: ${err.message}`, 'error');
    }
  }, [
    addLog, logEnabled, logLevel, pjLogEnabled, pjLogLevel, rxTxEnabled,
    httpPort, sipUdpPort, sipTcpEnabled, sipTcpPort, sipTlsEnabled, sipTlsPort,
    sipIpv6Enabled, mTlsEnabled, certPath, privKeyPath, caListPath,
    sipRxThreads, sipWorkerThreads,
  ]);

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
        sdkRef.current.register();
        addLog('register() called → waiting for registration callbacks...');
      }
    } catch (err: any) {
      addLog(`init() threw: ${err.message}`, 'error');
    }
  }, [addLog, paramsSet]);

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
  const value: SdkContextValue = useMemo(() => ({
    sdkRef,
    created, initialized, paramsSet,
    logs, sdkLogs, addLog, clearLogs, clearSdkLogs,
    ipInfo,
    registrationProgress, registrationPhase, registrationState,
    handleCreate, handleSetParams, handleInit, handleDestroy,
    logEnabled,       setLogEnabled,
    logLevel,         setLogLevel,
    pjLogEnabled,     setPjLogEnabled,
    pjLogLevel,       setPjLogLevel,
    rxTxEnabled,      setRxTxEnabled,
    httpPort,         setHttpPort,
    sipUdpPort,       setSipUdpPort,
    sipTcpEnabled,    setSipTcpEnabled,
    sipTcpPort,       setSipTcpPort,
    sipTlsEnabled,    setSipTlsEnabled,
    sipTlsPort,       setSipTlsPort,
    sipIpv6Enabled,   setSipIpv6Enabled,
    mTlsEnabled,      setMTlsEnabled,
    certPath,         setCertPath,
    privKeyPath,      setPrivKeyPath,
    caListPath,       setCaListPath,
    sipRxThreads,     setSipRxThreads,
    sipWorkerThreads, setSipWorkerThreads,
  }), [
    created, initialized, paramsSet,
    logs, sdkLogs, addLog, clearLogs, clearSdkLogs,
    ipInfo,
    registrationProgress, registrationPhase, registrationState,
    handleCreate, handleSetParams, handleInit, handleDestroy,
    logEnabled, logLevel, pjLogEnabled, pjLogLevel, rxTxEnabled,
    httpPort, sipUdpPort, sipTcpEnabled, sipTcpPort, sipTlsEnabled,
    sipTlsPort, sipIpv6Enabled, mTlsEnabled, certPath, privKeyPath,
    caListPath, sipRxThreads, sipWorkerThreads,
  ]);

  return <SdkContext.Provider value={value}>{children}</SdkContext.Provider>;
}
