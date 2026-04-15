/**
 * MCSDK Test App — Tests init() and setParams() via TurboModule bridge.
 * @format
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { McSdk, type McSdkParams, type LogEvent } from './src/mcsdk';

// ── Log entry ─────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  time: string;
  msg: string;
  level: 'info' | 'warn' | 'error' | 'sdk';
}

let nextId = 0;
function stamp(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const sdkRef = useRef<McSdk | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ── State: SDK lifecycle ────────────────────────────────────────────────────
  const [created, setCreated] = useState(false);
  const [listenerSet, setListenerSet] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [paramsSet, setParamsSet] = useState(false);

  // ── State: Params ───────────────────────────────────────────────────────────
  const [logEnabled, setLogEnabled] = useState(true);
  const [logLevel, setLogLevel] = useState('1');
  const [pjLogEnabled, setPjLogEnabled] = useState(false);
  const [pjLogLevel, setPjLogLevel] = useState('1');
  const [rxTxEnabled, setRxTxEnabled] = useState(false);
  const [httpPort, setHttpPort] = useState('8008');
  const [sipUdpPort, setSipUdpPort] = useState('5060');
  const [sipTcpEnabled, setSipTcpEnabled] = useState(false);
  const [sipTcpPort, setSipTcpPort] = useState('5060');
  const [sipTlsEnabled, setSipTlsEnabled] = useState(false);
  const [sipTlsPort, setSipTlsPort] = useState('5061');
  const [sipIpv6Enabled, setSipIpv6Enabled] = useState(false);
  const [mTlsEnabled, setMTlsEnabled] = useState(false);
  const [certPath, setCertPath] = useState('cert/client.crt');
  const [privKeyPath, setPrivKeyPath] = useState('cert/client.key');
  const [caListPath, setCaListPath] = useState('cert/ca.pem');
  const [sipRxThreads, setSipRxThreads] = useState('1');
  const [sipWorkerThreads, setSipWorkerThreads] = useState('1');

  // ── State: Logs ─────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, { id: nextId++, time: stamp(), msg, level }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    try {
      sdkRef.current = new McSdk();
      setCreated(true);
      setListenerSet(false);
      setInitialized(false);
      setParamsSet(false);
      addLog('McSdk() → nativeCreate() OK — C++ Sdk instance ready');

      // Subscribe to SDK log events so SDK-emitted logs appear in the console
      sdkRef.current.onLog((e: LogEvent) => {
        const levelNames = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
        addLog(`[SDK ${levelNames[e.level] ?? e.level}] ${e.log}`, 'sdk');
      });
    } catch (err: any) {
      addLog(`Create failed: ${err.message}`, 'error');
    }
  }, [addLog]);

  const handleSetListener = useCallback(() => {
    if (!sdkRef.current) {
      addLog('SDK not created yet — call Create first', 'warn');
      return;
    }
    try {
      sdkRef.current.setListener();
      setListenerSet(true);
      addLog('setListener() called → SdkListener + AlarmListener + LogListener bound');
      addLog('  Verify: [SDK INFO] log line should appear immediately above ^');
    } catch (err: any) {
      addLog(`setListener() failed: ${err.message}`, 'error');
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
          udpPort: Number(sipUdpPort),
          tcpEnabled: sipTcpEnabled,
          tcpPort: Number(sipTcpPort),
          tlsEnabled: sipTlsEnabled,
          tlsPort: Number(sipTlsPort),
          ipv6Enabled: sipIpv6Enabled,
        },
        Tls: { mTlsEnabled, certPath, privKeyPath, caListPath },
        Threading: {
          sipRxThreadCount: Number(sipRxThreads),
          sipWorkerThreadCount: Number(sipWorkerThreads),
        },
      };
      sdkRef.current.setParams(params);
      setParamsSet(true);
      addLog('setParams() called successfully');
      addLog(`  Logging: enabled=${logEnabled} level=${logLevel}`);
      addLog(`  Http: port=${httpPort}`);
      addLog(`  Sip: udp=${sipUdpPort} tcp=${sipTcpEnabled}:${sipTcpPort} tls=${sipTlsEnabled}:${sipTlsPort}`);
    } catch (err: any) {
      addLog(`setParams() failed: ${err.message}`, 'error');
    }
  }, [
    addLog, logEnabled, logLevel, pjLogEnabled, pjLogLevel, rxTxEnabled,
    httpPort, sipUdpPort, sipTcpEnabled, sipTcpPort, sipTlsEnabled, sipTlsPort,
    sipIpv6Enabled, mTlsEnabled, certPath, privKeyPath, caListPath,
    sipRxThreads, sipWorkerThreads,
  ]);

  const handleInit = useCallback(() => {
    if (!sdkRef.current) {
      addLog('SDK not created yet — call Create first', 'warn');
      return;
    }
    if (!paramsSet) {
      addLog('setParams() not called yet — call Set Parameters first', 'warn');
    }
    try {
      const result = sdkRef.current.init();
      setInitialized(result);
      addLog(`init() returned: ${result}`, result ? 'info' : 'error');
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
      setListenerSet(false);
      setInitialized(false);
      setParamsSet(false);
      addLog('destroy() called — JS state reset (C++ singleton retained)');  
    } catch (err: any) {
      addLog(`destroy() failed: ${err.message}`, 'error');
    }
  }, [addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderSwitch = (label: string, value: boolean, onValueChange: (v: boolean) => void) => (
    <View style={s.switchRow}>
      <Text style={s.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: '#4CAF50' }} />
    </View>
  );

  const renderInput = (label: string, value: string, onChangeText: (v: string) => void, keyboard: 'default' | 'numeric' = 'numeric') => (
    <View style={s.inputRow}>
      <Text style={s.inputLabel}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboard}
        placeholderTextColor="#666"
      />
    </View>
  );

  // ── Status badge ────────────────────────────────────────────────────────────
  const statusColor = initialized ? '#4CAF50' : listenerSet ? '#FF9800' : created ? '#2196F3' : '#F44336';
  const statusText = initialized ? 'INITIALIZED' : paramsSet ? 'PARAMS SET' : listenerSet ? 'LISTENER SET' : created ? 'CREATED' : 'NOT CREATED';

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.title}>MCSDK Test</Text>
        <View style={[s.badge, { backgroundColor: statusColor }]}>
          <Text style={s.badgeText}>{statusText}</Text>
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
        {/* ── Lifecycle Buttons ──────────────────────────────────────────── */}
        <Text style={s.sectionTitle}>SDK Lifecycle</Text>

        {/* Step indicators */}
        <View style={s.stepRow}>
          {(['Create','SetListener','SetParams','Init'] as const).map((step, i) => {
            const done = i === 0 ? created : i === 1 ? listenerSet : i === 2 ? paramsSet : initialized;
            return (
              <View key={step} style={s.stepItem}>
                <View style={[s.stepDot, done && s.stepDotDone]}>
                  <Text style={s.stepNum}>{i + 1}</Text>
                </View>
                <Text style={[s.stepLabel, done && s.stepLabelDone]}>{step}</Text>
              </View>
            );
          })}
        </View>

        <View style={s.buttonRow}>
          <TouchableOpacity
            style={[s.btn, s.btnCreate, created && s.btnDisabled]}
            onPress={handleCreate}
            disabled={created}>
            <Text style={s.btnText}>① Create</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, s.btnDestroy, !created && s.btnDisabled]}
            onPress={handleDestroy}
            disabled={!created}>
            <Text style={s.btnText}>Destroy</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[s.btn, s.btnListener, s.btnFull, (!created || listenerSet) && s.btnDisabled]}
          onPress={handleSetListener}
          disabled={!created || listenerSet}>
          <Text style={s.btnText}>② Set Listener  (SdkListener + AlarmListener + LogListener)</Text>
        </TouchableOpacity>

        {/* ── Parameters Section ─────────────────────────────────────────── */}
        <Text style={s.sectionTitle}>Parameters</Text>
        <View style={s.card}>
          <Text style={s.cardTitle}>Logging</Text>
          {renderSwitch('Enabled', logEnabled, setLogEnabled)}
          {renderInput('Level (0-5)', logLevel, setLogLevel)}
          {renderSwitch('PJ Enabled', pjLogEnabled, setPjLogEnabled)}
          {renderInput('PJ Level', pjLogLevel, setPjLogLevel)}
          {renderSwitch('RxTx Enabled', rxTxEnabled, setRxTxEnabled)}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>HTTP</Text>
          {renderInput('Port', httpPort, setHttpPort)}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>SIP</Text>
          {renderInput('UDP Port', sipUdpPort, setSipUdpPort)}
          {renderSwitch('TCP Enabled', sipTcpEnabled, setSipTcpEnabled)}
          {renderInput('TCP Port', sipTcpPort, setSipTcpPort)}
          {renderSwitch('TLS Enabled', sipTlsEnabled, setSipTlsEnabled)}
          {renderInput('TLS Port', sipTlsPort, setSipTlsPort)}
          {renderSwitch('IPv6 Enabled', sipIpv6Enabled, setSipIpv6Enabled)}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>TLS</Text>
          {renderSwitch('mTLS Enabled', mTlsEnabled, setMTlsEnabled)}
          {renderInput('Cert Path', certPath, setCertPath, 'default')}
          {renderInput('Private Key Path', privKeyPath, setPrivKeyPath, 'default')}
          {renderInput('CA List Path', caListPath, setCaListPath, 'default')}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Threading</Text>
          {renderInput('SIP Rx Threads', sipRxThreads, setSipRxThreads)}
          {renderInput('SIP Worker Threads', sipWorkerThreads, setSipWorkerThreads)}
        </View>

        {/* ── Action Buttons ─────────────────────────────────────────────── */}
        <View style={s.buttonRow}>
          <TouchableOpacity
            style={[s.btn, s.btnSetParams, (!created || !listenerSet) && s.btnDisabled]}
            onPress={handleSetParams}
            disabled={!created || !listenerSet}>
            <Text style={s.btnText}>③ Set Parameters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, s.btnInit, (!created || !paramsSet || initialized) && s.btnDisabled]}
            onPress={handleInit}
            disabled={!created || !paramsSet || initialized}>
            <Text style={s.btnText}>④ Initialize SDK</Text>
          </TouchableOpacity>
        </View>

        {/* ── Log Console ────────────────────────────────────────────────── */}
        <View style={s.logHeader}>
          <Text style={s.sectionTitle}>Log Console</Text>
          <TouchableOpacity onPress={clearLogs}>
            <Text style={s.clearBtn}>Clear</Text>
          </TouchableOpacity>
        </View>
        <View style={s.logBox}>
          <ScrollView ref={scrollRef} nestedScrollEnabled>
            {logs.length === 0 ? (
              <Text style={s.logPlaceholder}>Logs will appear here…</Text>
            ) : (
              logs.map(entry => (
                <Text
                  key={entry.id}
                  style={[
                    s.logLine,
                    entry.level === 'error' && s.logError,
                    entry.level === 'warn' && s.logWarn,
                    entry.level === 'sdk' && s.logSdk,
                  ]}>
                  <Text style={s.logTime}>{entry.time} </Text>
                  {entry.msg}
                </Text>
              ))
            )}
          </ScrollView>
        </View>

        <View style={{ height: insets.bottom + 20 }} />
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#e94560' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  body: { flex: 1 },
  bodyContent: { padding: 16 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#e0e0e0', marginTop: 12, marginBottom: 8 },

  card: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#e94560', marginBottom: 8 },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  switchLabel: { fontSize: 13, color: '#ccc' },

  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  inputLabel: { fontSize: 13, color: '#ccc', flex: 1 },
  input: {
    backgroundColor: '#0f3460',
    color: '#fff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    fontSize: 13,
    minWidth: 100,
    textAlign: 'right',
  },

  stepRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  stepDotDone: { backgroundColor: '#4CAF50' },
  stepNum: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepLabel: { color: '#555', fontSize: 10 },
  stepLabelDone: { color: '#4CAF50' },

  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnFull: { flex: 0, marginVertical: 4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnCreate: { backgroundColor: '#4CAF50' },
  btnDestroy: { backgroundColor: '#F44336' },
  btnListener: { backgroundColor: '#9C27B0', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnSetParams: { backgroundColor: '#2196F3' },
  btnInit: { backgroundColor: '#FF9800' },
  btnDisabled: { opacity: 0.4 },

  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearBtn: { color: '#e94560', fontSize: 13, fontWeight: '600' },
  logBox: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    padding: 10,
    height: 200,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  logPlaceholder: { color: '#555', fontStyle: 'italic', fontSize: 12 },
  logLine: { color: '#8b949e', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
  logTime: { color: '#555' },
  logError: { color: '#f85149' },
  logWarn: { color: '#d29922' },
  logSdk: { color: '#58a6ff' },
});

export default App;
