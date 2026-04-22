/**
 * MCSDK Test App — Tests init() and setParams() via TurboModule bridge.
 * @format
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
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
import {
  parsePrometheus,
  type MetricFamily,
} from './src/utils/parsePrometheus';

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

// ── Metrics Screen ────────────────────────────────────────────────────────────

function MetricsScreen({ sdkRef }: { sdkRef: React.RefObject<McSdk | null> }) {
  const [rawText, setRawText] = useState('');
  const [families, setFamilies] = useState<MetricFamily[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(() => {
    if (!sdkRef.current) {
      setError('SDK not created. Go to Home and press Create first.');
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const raw = sdkRef.current.listMetrics();
      setRawText(raw);
      setFamilies(parsePrometheus(raw));
      setLastFetched(stamp());
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  }, [sdkRef]);

  const typeColor: Record<string, string> = {
    counter:   '#4fc3f7',
    gauge:     '#81c784',
    histogram: '#ffb74d',
    summary:   '#f48fb1',
  };

  return (
    <ScrollView
      style={ms.root}
      contentContainerStyle={ms.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={fetchMetrics} tintColor="#e94560" />
      }>
      <View style={ms.toolbar}>
        <Text style={ms.hint}>
          {lastFetched ? `Last fetched: ${lastFetched}` : 'Pull down or tap Fetch'}
        </Text>
        <TouchableOpacity style={ms.fetchBtn} onPress={fetchMetrics}>
          <Text style={ms.fetchBtnText}>Fetch</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={ms.errorBox}>
          <Text style={ms.errorText}>{error}</Text>
        </View>
      ) : families.length === 0 ? (
        <Text style={ms.empty}>
          {'No metrics yet.\nInitialize the SDK on the Home tab, then tap Fetch.'}
        </Text>
      ) : (
        families.map(fam => (
          <View key={fam.name} style={ms.card}>
            <View style={ms.cardHeader}>
              <Text style={ms.famName} numberOfLines={1}>{fam.name}</Text>
              <View style={[ms.typeBadge, { backgroundColor: typeColor[fam.type] ?? '#9e9e9e' }]}>
                <Text style={ms.typeBadgeText}>{fam.type.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={ms.famHelp}>{fam.help}</Text>

            <View style={ms.table}>
              <View style={[ms.tableRow, ms.tableHead]}>
                <Text style={[ms.tableCellText, ms.tableHeadText, { flex: 3 }]}>Sample</Text>
                <Text style={[ms.tableCellText, ms.tableHeadText, { flex: 2, textAlign: 'right' }]}>Value</Text>
              </View>
              {fam.samples.map((sample, i) => (
                <View key={i} style={[ms.tableRow, i % 2 === 1 && ms.tableRowAlt]}>
                  <View style={{ flex: 3 }}>
                    <Text style={ms.tableCellText}>
                      {sample.name.replace(fam.name, '').replace(/^_/, '') || fam.name}
                    </Text>
                    {sample.labels ? (
                      <Text style={ms.labelText}>{sample.labels}</Text>
                    ) : null}
                  </View>
                  <Text style={[ms.tableCellText, ms.valueText]}>{sample.value}</Text>
                </View>
              ))}
            </View>
          </View>
        ))
      )}

      {rawText.length > 0 && (
        <View style={ms.rawSection}>
          <Text style={ms.rawTitle}>Raw Prometheus Output</Text>
          <ScrollView horizontal nestedScrollEnabled style={ms.rawBox}>
            <Text style={ms.rawText}>{rawText}</Text>
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

// ── Screen type ───────────────────────────────────────────────────────────────

type Screen = 'home' | 'metrics';

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

  const [screen, setScreen] = useState<Screen>('home');

  // ── State: SDK lifecycle ────────────────────────────────────────────────────
  const [created, setCreated] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [paramsSet, setParamsSet] = useState(false);

  // ── State: Params ───────────────────────────────────────────────────────────
  const [logEnabled, setLogEnabled] = useState(true);
  const [logLevel, setLogLevel] = useState('0');
  const [pjLogEnabled, setPjLogEnabled] = useState(true);
  const [pjLogLevel, setPjLogLevel] = useState('0');
  const [rxTxEnabled, setRxTxEnabled] = useState(true);
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
      setInitialized(false);
      setParamsSet(false);
      addLog('McSdk() → nativeCreate() OK — listeners auto-bound');

      // Subscribe to SDK log events so SDK-emitted logs appear in the console
      sdkRef.current.onLog((e: LogEvent) => {
        const levelNames = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
        addLog(`[SDK ${levelNames[e.level] ?? e.level}] ${e.log}`, 'sdk');
      });
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
  const statusColor = initialized ? '#4CAF50' : paramsSet ? '#FF9800' : created ? '#2196F3' : '#F44336';
  const statusText = initialized ? 'INITIALIZED' : paramsSet ? 'PARAMS SET' : created ? 'CREATED' : 'NOT CREATED';

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.title}>MCSDK Test</Text>
        {screen === 'home' && (
          <View style={[s.badge, { backgroundColor: statusColor }]}>
            <Text style={s.badgeText}>{statusText}</Text>
          </View>
        )}
      </View>

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tab, screen === 'home' && s.tabActive]}
          onPress={() => setScreen('home')}>
          <Text style={[s.tabText, screen === 'home' && s.tabTextActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, screen === 'metrics' && s.tabActive]}
          onPress={() => setScreen('metrics')}>
          <Text style={[s.tabText, screen === 'metrics' && s.tabTextActive]}>Metrics</Text>
        </TouchableOpacity>
      </View>

      {/* ── Screen Content ──────────────────────────────────────────────── */}
      {screen === 'metrics' ? (
        <MetricsScreen sdkRef={sdkRef} />
      ) : (
      <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
        {/* ── Lifecycle Buttons ──────────────────────────────────────────── */}
        <Text style={s.sectionTitle}>SDK Lifecycle</Text>

        {/* Step indicators */}
        <View style={s.stepRow}>
          {(['Create', 'SetParams', 'Init'] as const).map((step, i) => {
            const done = i === 0 ? created : i === 1 ? paramsSet : initialized;
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
            style={[s.btn, s.btnSetParams, !created && s.btnDisabled]}
            onPress={handleSetParams}
            disabled={!created}>
            <Text style={s.btnText}>② Set Parameters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, s.btnInit, (!created || !paramsSet || initialized) && s.btnDisabled]}
            onPress={handleInit}
            disabled={!created || !paramsSet || initialized}>
            <Text style={s.btnText}>③ Initialize SDK</Text>
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
      )}
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

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  tab: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#e94560' },
  tabText: { color: '#555', fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: '#e94560' },

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

// ── Metrics Styles ────────────────────────────────────────────────────────────

const ms = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#1a1a2e' },
  content:       { padding: 16, paddingBottom: 40 },
  toolbar:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  hint:          { color: '#555', fontSize: 12 },
  fetchBtn:      { backgroundColor: '#e94560', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  fetchBtnText:  { color: '#fff', fontWeight: '700', fontSize: 13 },
  errorBox:      { backgroundColor: '#2d1a1a', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#f85149' },
  errorText:     { color: '#f85149', fontSize: 13 },
  empty:         { color: '#555', textAlign: 'center', marginTop: 60, fontSize: 14, lineHeight: 22 },
  card:          { backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#0f3460' },
  cardHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  famName:       { color: '#e0e0e0', fontWeight: '700', fontSize: 13, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  typeBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
  typeBadgeText: { fontSize: 10, fontWeight: '700', color: '#1a1a2e' },
  famHelp:       { color: '#777', fontSize: 11, marginBottom: 10 },
  table:         { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: '#1e3050' },
  tableRow:      { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0d1b30' },
  tableRowAlt:   { backgroundColor: '#0f2040' },
  tableHead:     { backgroundColor: '#0f3460' },
  tableHeadText: { color: '#aaa', fontWeight: '700', fontSize: 11 },
  tableCellText: { color: '#ccc', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  labelText:     { color: '#555', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
  valueText:     { flex: 2, textAlign: 'right', color: '#ffd54f', fontWeight: '700' },
  rawSection:    { marginTop: 16 },
  rawTitle:      { color: '#555', fontSize: 11, marginBottom: 6 },
  rawBox:        { backgroundColor: '#0d1117', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#1e3050' },
  rawText:       { color: '#58a6ff', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

export default App;
