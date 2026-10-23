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
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { McSdk, type McSdkParams, type LogEvent, type RegistrationEvent, type SdkErrorEvent, type StoreDocumentsEvent } from '../mcsdk';
import { DeviceIdentity, SdkSettings, type SdkSettingsSchema } from '../core/settings';
import { AppLogger, SdkLogger } from '../core/logger';
import { MediaSession } from '../core/mediaSession';
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
  // The media foreground service is started once per registration, not on every
  // progress event — onRegistration fires repeatedly as the flow advances.
  const serviceStartedRef = useRef(false);

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
  }), [updateParam]);

  // ── Log buffers ────────────────────────────────────────────────────────────
  const [logs,    setLogs]    = useState<LogEntry[]>([]);
  const [sdkLogs, setSdkLogs] = useState<SdkLogEntry[]>([]);

  // Both buffers are batched rather than written per event. With the default
  // params the SDK emits ~450 log events a second, and a setState per event
  // copied the whole array each time — cost growing with length, so O(n²) over
  // a session — and re-rendered the console every time. Measured on device:
  // Choreographer skipping 57 frames and Davey! duration=1735ms, repeatedly.
  //
  // Entries accumulate in a ref (writing a ref does not render) and move into
  // state once per FLUSH_MS, turning ~900 state updates a second into 8.
  // Nothing is dropped; the console just trails real time by at most FLUSH_MS,
  // which is imperceptible for a log view.
  //
  // File logging stays per-event on purpose: cache/logs is where the full,
  // untruncated SIP bodies are read from, and anything still queued would be
  // lost if the process died.
  const FLUSH_MS    = 250;
  const MAX_ENTRIES = 5000;

  const pendingLogs    = useRef<LogEntry[]>([]);
  const pendingSdkLogs = useRef<SdkLogEntry[]>([]);
  const flushTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLogs = useCallback(() => {
    flushTimer.current = null;
    // Capped: unbounded arrays made every copy more expensive than the last, so
    // a long session degraded steadily. The file log stays uncapped.
    if (pendingLogs.current.length) {
      const batch = pendingLogs.current;
      pendingLogs.current = [];
      setLogs(prev => [...prev, ...batch].slice(-MAX_ENTRIES));
    }
    if (pendingSdkLogs.current.length) {
      const batch = pendingSdkLogs.current;
      pendingSdkLogs.current = [];
      setSdkLogs(prev => [...prev, ...batch].slice(-MAX_ENTRIES));
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current === null) {
      flushTimer.current = setTimeout(flushLogs, FLUSH_MS);
    }
  }, [flushLogs]);

  // Flush on the way out instead of just clearing the timer: a batch queued in
  // the last FLUSH_MS would otherwise never reach the console. React drops the
  // setState if the provider is really going away — there is no console left to
  // show it — but when this teardown is a re-mount rather than a shutdown it is
  // the difference between keeping those lines and silently losing them.
  useEffect(() => () => {
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
      flushLogs();
    }
  }, [flushLogs]);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    pendingLogs.current.push({ id: nextId++, time: stamp(), msg, level });
    scheduleFlush();
    if (level === 'error')     { AppLogger.error(msg); }
    else if (level === 'warn') { AppLogger.warn(msg); }
    else                       { AppLogger.info(msg); }
  }, [scheduleFlush]);

  // Clearing drops what is queued too, or the next flush would refill the
  // console with entries from before the clear.
  const clearLogs = useCallback(() => {
    pendingLogs.current = [];
    setLogs([]);
  }, []);
  const clearSdkLogs = useCallback(() => {
    pendingSdkLogs.current = [];
    setSdkLogs([]);
  }, []);

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
        pendingSdkLogs.current.push({
          id: sdkLogId++, time: stamp(), level: e.level, msg: e.log,
        });
        scheduleFlush();
      });

      // Every SdkError the engine raises. These were discarded by the bridge
      // until now, so a failure like IDENTITY_NOT_SET left no trace outside
      // logcat.
      sdkRef.current.onSdkError((e: SdkErrorEvent) => {
        addLog(`onSdkError: ${e.error}`, 'error');
      });

      sdkRef.current.onRegistration((e: RegistrationEvent) => {
        setRegistrationProgress(e.progress);
        setRegistrationPhase(phaseLabel(e.phase));
        setRegistrationState(stateLabel(e.state));

        // Hold the microphone grant for as long as we are registered. Android
        // 11+ cuts background mic access and AudioRecord does not report it —
        // read() just returns silence — so a microphone foreground service is
        // required before any audio work.
        //
        // Started on registration rather than at call setup on purpose:
        // Android 14+ refuses to start a microphone-typed service from the
        // background, which is exactly the situation an incoming call creates.
        // Registration happens with the app on screen, so this is the one
        // moment the start is reliably allowed.
        const state = String(e.state).toUpperCase();
        if (state.includes('REGISTERED') && !state.includes('UN')) {
          if (!serviceStartedRef.current) {
            serviceStartedRef.current = true;
            MediaSession.startService(
              tr.audioServiceTitle,
              tr.audioServiceText,
              tr.audioServiceChannel,
            );
            addLog('media foreground service started (mic grant held)');
          }
        }
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

      // Identity is NOT set here — see applyIdentity(), called from handleInit().
      // Sdk::SetIdentity routes through Sdk::PostWork, which drops the work and
      // raises SdkError::NotInitialized while impl->running is false, i.e. until
      // Init() has completed. Calling it at Create time looks like it works (the
      // SDK logs "Sdk::SetIdentity") but Session::McId stays empty, and the only
      // symptom is "Identity not set" from Register() much later.
    } catch (err: any) {
      addLog(`Create failed: ${err.message}`, 'error');
    }
    // tr is read for the foreground-service notification strings; depending on
    // the whole bundle keeps handleCreate correct when the language changes.
  }, [addLog, scheduleFlush, updateCachedDocs, tr]);

  /**
   * Sends the stored credentials to the SDK. Must run after init(): everything
   * on Sdk goes through PostWork, which silently discards work until the engine
   * is running.
   *
   * Returns the mcId on success, or null when there was nothing to send — the
   * caller needs that to decide whether register() is worth attempting.
   */
  const applyIdentity = useCallback(async (sdk: McSdk): Promise<string | null> => {
    // Both guards used to fall through silently, so a missing identity only
    // surfaced later as the SDK's own "Identity not set" at register() time,
    // which reads like a hung registration rather than a skipped step.
    const lastUser = AuthSettings.getLastUsername();
    if (!lastUser) {
      addLog('setIdentity() skipped — no stored username. Log in first.', 'warn');
      return null;
    }
    const creds = await getCredentials(lastUser);
    if (!creds) {
      addLog(`setIdentity() skipped — no stored credentials for "${lastUser}".`, 'warn');
      return null;
    }
    // A stable per-install "urn:uuid:<uuid>" (TS 24.379). The SDK embeds it in
    // the PUBLISH poc-settings body, where an empty value is rejected with
    // 400 "Invalid Info XML".
    const clientId = DeviceIdentity.getMcClientId();
    sdk.setIdentity(creds.username, creds.password, clientId);
    addLog(`setIdentity(${creds.username}, clientId=${clientId}) called`);
    currentMcIdRef.current = creds.username;
    return creds.username;
  }, [addLog]);

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
        // Order matters, and the SDK enforces it only by failing late:
        //   init() → setIdentity() → setDocuments() → register()
        // Everything after init goes through the engine's FIFO queue, so the
        // identity is in Session by the time Register() reads McId.
        const mcId = await applyIdentity(sdkRef.current);

        // Restore cached BMS documents before registration (FIFO queue —
        // setDocuments is processed by the engine before Register()).
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
        // Registering without an identity fails inside the SDK with
        // SdkError::IdentityNotSet (RegistrationMachine::Register bails when
        // Session::McId is empty). applyIdentity already told us whether one
        // was sent, so report the actual cause rather than letting the SDK
        // reject a request the app knows is incomplete.
        if (!mcId) {
          addLog(
            'register() not called — no identity to send. Log in, then Create → Set Parameters → Init.',
            'error',
          );
        } else {
          sdkRef.current.register();
          addLog('register() called → waiting for registration callbacks...');
        }
      }
    } catch (err: any) {
      addLog(`init() threw: ${err.message}`, 'error');
    }
  }, [addLog, applyIdentity, cachedDocsMap, paramsSet]);

  const handleDestroy = useCallback(() => {
    if (!sdkRef.current) {
      addLog('SDK not created — nothing to destroy', 'warn');
      return;
    }
    try {
      // Release the mic grant before tearing the SDK down: nothing is going to
      // capture once the SDK is gone, and leaving the notification up would
      // claim otherwise.
      MediaSession.stopService();
      serviceStartedRef.current = false;
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
  const value: SdkContextValue = useMemo(() => ({
    sdkRef,
    created, initialized, paramsSet,
    logs, sdkLogs, addLog, clearLogs, clearSdkLogs,
    ipInfo,
    registrationProgress, registrationPhase, registrationState,
    handleCreate, handleSetParams, handleInit, handleDestroy,
    ...params,
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
