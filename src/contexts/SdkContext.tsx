/**
 * contexts/SdkContext.tsx — SDK lifecycle state, parameter state, IP
 * monitoring, and all SDK action handlers.
 *
 * Must be rendered inside <AppContextProvider> (handleIpChange reads `tr` for
 * the translated log message) and inside <LogContextProvider>, which holds
 * the console buffers this used to own. They moved out so that a log flush no
 * longer re-renders every consumer of this context — TabNavigator and the
 * screen under it among them.
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
import { McSdk, type McSdkParams, type RegistrationEvent, type StoreDocumentsEvent } from '../mcsdk';
import { formatListenerEvent } from '../mcsdk/listenerLog';
import { DeviceIdentity, SdkSettings, type SdkSettingsSchema } from '../core/settings';
import { MediaSession } from '../core/mediaSession';
import { useIpMonitor, type IpInfo } from '../core/netMonitor';
import { useAppContext } from './AppContext';
import { useLogContext } from './LogContext';
import { getCredentials } from '../core/auth';
import { AuthSettings } from '../core/settings';
import { saveDocuments } from '../core/db';

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

/**
 * Whether a RegistrationEvent's `state` means "registered with the server".
 *
 * Android sends `RegistrationState.name` (UNREGISTERED / REGISTERING /
 * REGISTERED / UNREGISTERING, verified against the AAR), plus two values the
 * bridge writes itself: "REGISTERED" from `onRegistered()` and "FAILED" from
 * `onRegistrationFailed()`. iOS sends the enum ordinal, where 2 is Registered.
 *
 * The `UN` test is what makes the string path correct: UNREGISTERED contains
 * "REGISTERED" and UNREGISTERING contains "REGISTERI", so a plain `includes`
 * would read both of them as success.
 */
function isRegisteredState(state: number | string): boolean {
  if (typeof state === 'number') return state === 2;
  const s = state.toUpperCase();
  return s.includes('REGISTERED') && !s.includes('UN');
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

  // The console buffers are LogContext's (useLogContext), not here: see the
  // header. The SDK's own log stream is in neither — it never reaches JS line
  // by line (McSdk.getSdkLogs).

  // Network
  ipInfo: IpInfo;

  // SDK actions
  handleCreate:    () => Promise<void>;
  handleSetParams: () => void;
  handleInit:      (opts?: { skipParamsCheck?: boolean }) => Promise<void>;
  handleDestroy:   () => void;
  /** Create → Set Parameters → Init in one press. */
  handleStartAll:  () => Promise<void>;

  // Registration
  registrationProgress: number;
  registrationPhase:    string;
  registrationState:    string;
  /**
   * The SDK has told us it is registered with the server. Separate from
   * `initialized`, which only means init() returned: registration runs for
   * ~35 s after that and can still fail. Drives the status badge.
   */
  registered:           boolean;

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
  const [registered,           setRegistered]           = useState(false);
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

  // ── Logging ────────────────────────────────────────────────────────────────
  // Both writers are stable callbacks, so depending on them below costs nothing.
  const { addLog, addListenerLog } = useLogContext();
  const listenerLogSub = useRef<{ remove: () => void } | null>(null);

  useEffect(() => () => {
    listenerLogSub.current?.remove();
    listenerLogSub.current = null;
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
      setRegistered(false);
      addLog('McSdk() → nativeCreate() OK — listeners auto-bound');

      // The SDK's own log stream is deliberately not subscribed to here. It is
      // ~450 lines a second with the default params, and as events every one of
      // them ran on the JS thread whether or not anybody was reading them. The
      // Android bridge keeps it in a process-level ring and writes the file
      // itself; the SDK Logs screen pulls from the ring while open
      // (McSdk.getSdkLogs). Nothing SDK-related is lost: the stream is complete
      // there and in the file, it just never passes through this context.

      // Everything the listener reports, contents included: call and floor
      // state, SdkErrors, registration, groups. The handlers elsewhere each read
      // the fields they need and log nothing, so this is the one place that shows
      // what the SDK actually said.
      //
      // Replaced rather than added to, because the emitter outlives the McSdk
      // instance and a Create after a Destroy would log everything twice. Not
      // removed on Destroy: onTerminated arrives after it.
      listenerLogSub.current?.remove();
      listenerLogSub.current = sdkRef.current.onAnyEvent((event, payload) => {
        const line = formatListenerEvent(event, payload);
        addListenerLog(line.msg, line.level, line.fileDetail);
      });

      sdkRef.current.onRegistration((e: RegistrationEvent) => {
        setRegistrationProgress(e.progress);
        setRegistrationPhase(phaseLabel(e.phase));
        setRegistrationState(stateLabel(e.state));
        // A replay, not something the SDK just did: the native SDK outlived the
        // last JS side (closing the app does not kill the process) and the
        // bridge is telling this fresh JS side where it stands. Worth saying so
        // in the console — otherwise a REGISTERED badge with no registration
        // flow in the log reads as a bug.
        if (e.replayed) {
          addLog(
            `registration state restored from the running SDK: ${stateLabel(e.state)}` +
              ' (the app was closed, the SDK kept running)',
            'warn',
          );
        }
        // Latches on REGISTERED and off again on anything else, so losing the
        // registration (UNREGISTERED, or FAILED from onRegistrationFailed)
        // takes the badge back rather than leaving a stale "REGISTERED".
        setRegistered(isRegisteredState(e.state));

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
        if (isRegisteredState(e.state)) {
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
  }, [addLog, addListenerLog, updateCachedDocs, tr]);

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

  /**
   * `skipParamsCheck` is for a caller that has just run setParams itself in this
   * same tick: `paramsSet` is React state and is still false here, so the check
   * would warn about a step that did happen. Only Start All passes it.
   */
  const handleInit = useCallback(async (opts?: { skipParamsCheck?: boolean }) => {
    if (!sdkRef.current) {
      addLog('SDK not created yet — call Create first', 'warn');
      return;
    }
    if (!paramsSet && !opts?.skipParamsCheck) {
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

  /**
   * The whole bring-up in one press: Create → Set Parameters → Init.
   *
   * It calls the same three handlers the separate buttons do rather than
   * repeating their bodies, so each step keeps its own logging, error handling
   * and settings save, and a later change to one of them is picked up here.
   *
   * Sequencing works on refs, not on React state, which is what makes it safe
   * to run all three in one tick: handleCreate assigns sdkRef.current
   * synchronously, and that ref is the guard handleSetParams and handleInit
   * actually check. The `paramsSet` state they would read is still false this
   * tick — handleInit only warns on that and proceeds, so the chain is correct,
   * but it does log one misleading "setParams() not called yet" line. Suppressed
   * via skipParamsCheck so the console does not accuse the press of skipping a
   * step it just performed.
   *
   * Already-created is not an error: Create is skipped and the run continues
   * with Set Parameters, which is what re-pressing it after a partial bring-up
   * should do. An initialised SDK is left alone — re-initialising is what
   * Destroy is for.
   */
  const handleStartAll = useCallback(async () => {
    if (initialized) {
      addLog('SDK already initialised — Destroy first to start over', 'warn');
      return;
    }
    addLog('Start: Create → Set Parameters → Init');
    if (!sdkRef.current) {
      await handleCreate();
      // handleCreate swallows its own failures into the log, so the ref is the
      // only reliable signal that it worked. Carrying on without it would add
      // two more "SDK not created yet" lines on top of the real cause.
      if (!sdkRef.current) {
        addLog('Start stopped: Create failed', 'error');
        return;
      }
    } else {
      addLog('Create skipped — SDK already created');
    }
    handleSetParams();
    await handleInit({ skipParamsCheck: true });
  }, [addLog, handleCreate, handleSetParams, handleInit, initialized]);

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
      setRegistered(false);
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
    ipInfo,
    registrationProgress, registrationPhase, registrationState, registered,
    handleCreate, handleSetParams, handleInit, handleDestroy, handleStartAll,
    ...params,
    ...setters,
  }), [
    created, initialized, paramsSet,
    ipInfo,
    registrationProgress, registrationPhase, registrationState, registered,
    handleCreate, handleSetParams, handleInit, handleDestroy, handleStartAll,
    params, setters,
  ]);

  return <SdkContext.Provider value={value}>{children}</SdkContext.Provider>;
}
