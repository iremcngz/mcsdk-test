/**
 * MCSDK Test App — Tests init() and setParams() via TurboModule bridge.
 * @format
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  AppSettings,
  SdkSettings,
  LogRotationSettings,
  LOG_ROTATION_DEFAULTS,
  type AppTheme,
  type AppLanguage,
} from './src/core/settings';
import {
  configureLogger,
  AppLogger,
  SdkLogger,
  getLogFilePaths,
  deleteLogFiles,
} from './src/core/logger';
import { getThemePalette, type ThemePalette } from './src/core/theme';
import { getTranslation, type Translations } from './src/core/i18n';
import {
  initDb,
  insertContact,
  getAllContacts,
  deleteContact,
  clearContacts,
  type Contact,
} from './src/core/db';

// ── Theme + i18n contexts ────────────────────────────────────────────────────

const ThemeCtx = React.createContext<ThemePalette>(getThemePalette('dark'));
const TransCtx = React.createContext<Translations>(getTranslation('en'));

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
  const c  = React.useContext(ThemeCtx);
  const tr = React.useContext(TransCtx);
  const ms = React.useMemo(() => makeMetricsStyles(c), [c]);

  const [rawText, setRawText] = useState('');
  const [families, setFamilies] = useState<MetricFamily[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(() => {
    if (!sdkRef.current) {
      setError(tr.metricsNoSdk);
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
  }, [sdkRef, tr]);

  // Type badge colours are fixed semantic colours, not theme-dependent
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
        <RefreshControl refreshing={refreshing} onRefresh={fetchMetrics} tintColor={c.accent} />
      }>
      <View style={ms.toolbar}>
        <Text style={ms.hint}>
          {lastFetched ? tr.metricsLastFetched(lastFetched) : tr.metricsHintInitial}
        </Text>
        <TouchableOpacity style={ms.fetchBtn} onPress={fetchMetrics}>
          <Text style={ms.fetchBtnText}>{tr.btnFetch}</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={ms.errorBox}>
          <Text style={ms.errorText}>{error}</Text>
        </View>
      ) : families.length === 0 ? (
        <Text style={ms.empty}>{tr.metricsEmpty}</Text>
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
          <Text style={ms.rawTitle}>{tr.metricsRawTitle}</Text>
          <ScrollView horizontal nestedScrollEnabled style={ms.rawBox}>
            <Text style={ms.rawText}>{rawText}</Text>
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

// ── Screen type ───────────────────────────────────────────────────────────────

type Screen = 'home' | 'metrics' | 'sdklogs' | 'settings' | 'contacts';

// ── Contacts Screen ───────────────────────────────────────────────────────────

function ContactsScreen() {
  const c  = React.useContext(ThemeCtx);
  const tr = React.useContext(TransCtx);
  const cs = React.useMemo(() => makeContactsStyles(c), [c]);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName]         = useState('');
  const [sipUri, setSipUri]     = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [feedback, setFeedback] = useState('');

  const loadContacts = useCallback(async () => {
    const rows = await getAllContacts();
    setContacts(rows);
  }, []);

  useEffect(() => {
    initDb().then(loadContacts).catch(e =>
      setFeedback(`DB init failed: ${e.message}`),
    );
  }, [loadContacts]);

  const handleAdd = useCallback(async () => {
    const n = name.trim();
    const s = sipUri.trim();
    if (!n || !s) {
      setFeedback('Name and SIP URI are required.');
      return;
    }
    setSaving(true);
    try {
      await insertContact(n, s, notes.trim());
      setName('');
      setSipUri('');
      setNotes('');
      setFeedback(tr.contactAdded);
      await loadContacts();
    } catch (e: any) {
      setFeedback(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [name, sipUri, notes, loadContacts, tr]);

  const handleDelete = useCallback(async (id: number) => {
    await deleteContact(id);
    await loadContacts();
  }, [loadContacts]);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      tr.contactsAlertClearTitle,
      tr.contactsAlertClearMessage,
      [
        { text: tr.alertCancel, style: 'cancel' },
        { text: tr.alertDelete, style: 'destructive', onPress: async () => {
          await clearContacts();
          await loadContacts();
        }},
      ],
    );
  }, [tr, loadContacts]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled">

      <Text style={cs.section}>{tr.sectionContacts}</Text>

      {/* ── Form ─────────────────────────────────────────────────────── */}
      <View style={cs.card}>
        <TextInput
          style={cs.input}
          placeholder={tr.inputName}
          placeholderTextColor={c.textMuted}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={cs.input}
          placeholder={tr.inputSipUri}
          placeholderTextColor={c.textMuted}
          value={sipUri}
          onChangeText={setSipUri}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TextInput
          style={cs.input}
          placeholder={tr.inputNotes}
          placeholderTextColor={c.textMuted}
          value={notes}
          onChangeText={setNotes}
        />
        {!!feedback && <Text style={cs.feedback}>{feedback}</Text>}
        <TouchableOpacity
          style={[cs.addBtn, saving && { opacity: 0.5 }]}
          onPress={handleAdd}
          disabled={saving}>
          <Text style={cs.addBtnText}>{tr.btnSaveContact}</Text>
        </TouchableOpacity>
      </View>

      {/* ── List header ─────────────────────────────────────────────── */}
      <View style={cs.listHeader}>
        <Text style={cs.countText}>{tr.contactsCount(contacts.length)}</Text>
        {contacts.length > 0 && (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={cs.clearAll}>{tr.btnClearContacts}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── List ────────────────────────────────────────────────────── */}
      {contacts.length === 0 ? (
        <Text style={cs.empty}>{tr.contactsEmpty}</Text>
      ) : (
        contacts.map(contact => (
          <View key={contact.id} style={cs.row}>
            <View style={{ flex: 1 }}>
              <Text style={cs.rowName}>{contact.name}</Text>
              <Text style={cs.rowUri}>{contact.sip_uri}</Text>
              {!!contact.notes && <Text style={cs.rowNotes}>{contact.notes}</Text>}
              <Text style={cs.rowDate}>
                {new Date(contact.created_at).toLocaleString()}
              </Text>
            </View>
            <TouchableOpacity
              style={cs.deleteBtn}
              onPress={() => handleDelete(contact.id)}>
              <Text style={cs.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function makeContactsStyles(c: ThemePalette) {
  return StyleSheet.create({
    section:  { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 8 },
    card:     { backgroundColor: c.surface, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: c.border },
    input:    {
      backgroundColor: c.inputBg,
      color: c.textPrimary,
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 10 : 6,
      fontSize: 13,
      marginBottom: 8,
    },
    feedback:  { color: c.accent, fontSize: 12, marginBottom: 6 },
    addBtn:    { backgroundColor: '#4CAF50', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
    addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    countText:  { color: c.textMuted, fontSize: 12 },
    clearAll:   { color: c.error, fontSize: 13, fontWeight: '600' },
    empty:      { color: c.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 24 },
    row:       {
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    rowName:   { color: c.textPrimary, fontWeight: '600', fontSize: 14 },
    rowUri:    { color: c.accent, fontSize: 12, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    rowNotes:  { color: c.textSecondary, fontSize: 11, marginTop: 2 },
    rowDate:   { color: c.textMuted, fontSize: 10, marginTop: 4 },
    deleteBtn: { padding: 8, marginLeft: 8 },
    deleteBtnText: { color: c.error, fontSize: 16, fontWeight: '700' },
  });
}

// ── SDK Logs Screen ───────────────────────────────────────────────────────────

interface SdkLogEntry {
  id: number;
  time: string;
  level: number;
  msg: string;
}

let sdkLogId = 0;

function SdkLogsScreen({
  entries,
  onClear,
}: {
  entries: SdkLogEntry[];
  onClear: () => void;
}) {
  const c  = React.useContext(ThemeCtx);
  const tr = React.useContext(TransCtx);
  const sl = React.useMemo(() => makeSdkLogStyles(c), [c]);

  const scrollRef = useRef<ScrollView>(null);
  const SDK_LEVEL_NAMES = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
  const levelColor = (l: number) =>
    l >= 4 ? c.error : l === 3 ? c.warn : l === 2 ? c.sdkLog : c.textMuted;

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: c.bg }}>
      <View style={sl.toolbar}>
        <Text style={sl.hint}>{tr.sdkLogHint(entries.length)}</Text>
        <TouchableOpacity onPress={onClear}>
          <Text style={sl.clearBtn}>{tr.btnClear}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        style={sl.logBox}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        {entries.length === 0 ? (
          <Text style={sl.placeholder}>{tr.logSdkPlaceholder}</Text>
        ) : (
          entries.map(e => (
            <Text key={e.id} style={[sl.line, { color: levelColor(e.level) }]}>
              <Text style={sl.time}>{e.time} </Text>
              <Text style={sl.lbl}>[{SDK_LEVEL_NAMES[e.level] ?? e.level}] </Text>
              {e.msg}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ── Settings Screen ───────────────────────────────────────────────────────────

function SettingsScreen({
  theme,
  language,
  onSetTheme,
  onSetLanguage,
  maxFileSize,
  maxFiles,
  onSetMaxFileSize,
  onSetMaxFiles,
}: {
  theme: AppTheme;
  language: AppLanguage;
  onSetTheme: (t: AppTheme) => void;
  onSetLanguage: (l: AppLanguage) => void;
  maxFileSize: number;
  maxFiles: number;
  onSetMaxFileSize: (v: number) => void;
  onSetMaxFiles: (v: number) => void;
}) {
  const c  = React.useContext(ThemeCtx);
  const tr = React.useContext(TransCtx);
  const s  = React.useMemo(() => makeStyles(c), [c]);

  const [logPaths, setLogPaths] = useState<string[]>([]);

  // Auto-load paths when the Settings screen mounts so the user
  // can immediately see where log files are without pressing Show paths.
  useEffect(() => {
    getLogFilePaths().then(setLogPaths);
  }, []);

  const loadPaths = useCallback(async () => {
    const paths = await getLogFilePaths();
    setLogPaths(paths);
  }, []);

  const handleDeleteLogs = useCallback(async () => {
    Alert.alert(tr.alertDeleteTitle, tr.alertDeleteMessage, [
      { text: tr.alertCancel, style: 'cancel' },
      {
        text: tr.alertDelete, style: 'destructive', onPress: async () => {
          await deleteLogFiles();
          setLogPaths([]);
        },
      },
    ]);
  }, [tr]);

  const SIZE_OPTS: { bytes: number; label: string }[] = [
    { bytes: 12 * 1024,       label: '12 KB' },
    { bytes: 1 * 1024 * 1024, label: tr.fileSizeLabel(1) },
    { bytes: 2 * 1024 * 1024, label: tr.fileSizeLabel(2) },
    { bytes: 5 * 1024 * 1024, label: tr.fileSizeLabel(5) },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16 }}>

      {/* App appearance */}
      <Text style={s.sectionTitle}>{tr.sectionAppearance}</Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardTheme}</Text>
        <View style={s.segRow}>
          {(['dark', 'light'] as AppTheme[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.seg, theme === t && s.segActive]}
              onPress={() => onSetTheme(t)}>
              <Text style={[s.segText, theme === t && s.segTextActive]}>
                {t === 'dark' ? tr.themeDark : tr.themeLight}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.cardTitle, { marginTop: 12 }]}>{tr.cardLanguage}</Text>
        <View style={s.segRow}>
          {(['tr', 'en'] as AppLanguage[]).map(l => (
            <TouchableOpacity
              key={l}
              style={[s.seg, language === l && s.segActive]}
              onPress={() => onSetLanguage(l)}>
              <Text style={[s.segText, language === l && s.segTextActive]}>
                {l === 'tr' ? tr.langTr : tr.langEn}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Log rotation */}
      <Text style={s.sectionTitle}>{tr.sectionLogRotation}</Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardMaxFileSize}</Text>
        <View style={s.segRow}>
          {SIZE_OPTS.map(opt => (
            <TouchableOpacity
              key={opt.bytes}
              style={[s.seg, maxFileSize === opt.bytes && s.segActive]}
              onPress={() => onSetMaxFileSize(opt.bytes)}>
              <Text style={[s.segText, maxFileSize === opt.bytes && s.segTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.cardTitle, { marginTop: 12 }]}>{tr.cardMaxKeptFiles}</Text>
        <View style={s.segRow}>
          {[0, 2, 3, 5].map(n => (
            <TouchableOpacity
              key={n}
              style={[s.seg, maxFiles === n && s.segActive]}
              onPress={() => onSetMaxFiles(n)}>
              <Text style={[s.segText, maxFiles === n && s.segTextActive]}>
                {tr.filesCountLabel(n)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.settingsNote}>{tr.settingsFileNote}</Text>
      </View>

      {/* Log files */}
      <Text style={s.sectionTitle}>{tr.sectionLogFiles}</Text>
      <View style={s.card}>
        <View style={s.segRow}>
          <TouchableOpacity style={[s.seg, s.segActive]} onPress={loadPaths}>
            <Text style={[s.segText, s.segTextActive]}>{tr.btnShowPaths}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.seg, { borderColor: c.error }]} onPress={handleDeleteLogs}>
            <Text style={[s.segText, { color: c.error }]}>{tr.btnDeleteAll}</Text>
          </TouchableOpacity>
        </View>
        {logPaths.map((p, i) => (
          <Text key={i} style={s.pathText}>{p}</Text>
        ))}
        {logPaths.length === 0 && (
          <Text style={s.settingsNote}>{tr.logPathsNote}</Text>
        )}
      </View>

    </ScrollView>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const sdkRef = useRef<McSdk | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [screen, setScreen] = useState<Screen>('home');

  // ── App settings (persisted via MMKV) ───────────────────────────────────────
  const [theme, setThemeState] = useState<AppTheme>(() => AppSettings.getTheme());
  const [language, setLanguageState] = useState<AppLanguage>(() => AppSettings.getLanguage());

  // ── Theme palette + translations ────────────────────────────────────────────
  const c  = React.useMemo(() => getThemePalette(theme), [theme]);
  const tr = React.useMemo(() => getTranslation(language), [language]);
  const s  = React.useMemo(() => makeStyles(c), [c]);

  const handleSetTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    AppSettings.setTheme(t);
  }, []);

  const handleSetLanguage = useCallback((l: AppLanguage) => {
    setLanguageState(l);
    AppSettings.setLanguage(l);
  }, []);

  // ── Log rotation settings ────────────────────────────────────────────────────
  const [maxFileSize, setMaxFileSizeState] = useState<number>(
    () => LogRotationSettings.load().maxFileSize,
  );
  const [maxFiles, setMaxFilesState] = useState<number>(
    () => LogRotationSettings.load().maxFiles,
  );

  const handleSetMaxFileSize = useCallback((v: number) => {
    setMaxFileSizeState(v);
    LogRotationSettings.save({ maxFileSize: v, maxFiles });
  }, [maxFiles]);

  const handleSetMaxFiles = useCallback((v: number) => {
    setMaxFilesState(v);
    LogRotationSettings.save({ maxFileSize, maxFiles: v });
  }, [maxFileSize]);

  // ── Initialise FileLogger once on mount ──────────────────────────────────────
  useEffect(() => {
    configureLogger().catch(e =>
      console.warn('[App] configureLogger failed:', e),
    );
  }, []);

  // ── State: SDK lifecycle ────────────────────────────────────────────────────
  const [created, setCreated] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [paramsSet, setParamsSet] = useState(false);

  // ── State: Params (loaded from MMKV on first render) ─────────────────────────
  const [_sdkSettingsLoaded] = useState(() => SdkSettings.load());
  const [logEnabled, setLogEnabled] = useState(_sdkSettingsLoaded.logEnabled);
  const [logLevel, setLogLevel] = useState(_sdkSettingsLoaded.logLevel);
  const [pjLogEnabled, setPjLogEnabled] = useState(_sdkSettingsLoaded.pjLogEnabled);
  const [pjLogLevel, setPjLogLevel] = useState(_sdkSettingsLoaded.pjLogLevel);
  const [rxTxEnabled, setRxTxEnabled] = useState(_sdkSettingsLoaded.rxTxEnabled);
  const [httpPort, setHttpPort] = useState(_sdkSettingsLoaded.httpPort);
  const [sipUdpPort, setSipUdpPort] = useState(_sdkSettingsLoaded.sipUdpPort);
  const [sipTcpEnabled, setSipTcpEnabled] = useState(_sdkSettingsLoaded.sipTcpEnabled);
  const [sipTcpPort, setSipTcpPort] = useState(_sdkSettingsLoaded.sipTcpPort);
  const [sipTlsEnabled, setSipTlsEnabled] = useState(_sdkSettingsLoaded.sipTlsEnabled);
  const [sipTlsPort, setSipTlsPort] = useState(_sdkSettingsLoaded.sipTlsPort);
  const [sipIpv6Enabled, setSipIpv6Enabled] = useState(_sdkSettingsLoaded.sipIpv6Enabled);
  const [mTlsEnabled, setMTlsEnabled] = useState(_sdkSettingsLoaded.mTlsEnabled);
  const [certPath, setCertPath] = useState(_sdkSettingsLoaded.certPath);
  const [privKeyPath, setPrivKeyPath] = useState(_sdkSettingsLoaded.privKeyPath);
  const [caListPath, setCaListPath] = useState(_sdkSettingsLoaded.caListPath);
  const [sipRxThreads, setSipRxThreads] = useState(_sdkSettingsLoaded.sipRxThreads);
  const [sipWorkerThreads, setSipWorkerThreads] = useState(_sdkSettingsLoaded.sipWorkerThreads);

  // ── State: Logs ─────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sdkLogs, setSdkLogs] = useState<SdkLogEntry[]>([]);

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, { id: nextId++, time: stamp(), msg, level }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    // Mirror to file
    if (level === 'error') { AppLogger.error(msg); }
    else if (level === 'warn') { AppLogger.warn(msg); }
    else { AppLogger.info(msg); }
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
        // Also write to file logger (SDK log stream) and SDK Logs tab
        SdkLogger.write(e.level, e.log);
        setSdkLogs(prev => [
          ...prev,
          { id: sdkLogId++, time: stamp(), level: e.level, msg: e.log },
        ]);
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
      // Persist to MMKV so values survive app restart
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
  const clearSdkLogs = useCallback(() => setSdkLogs([]), []);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderSwitch = (label: string, value: boolean, onValueChange: (v: boolean) => void) => (
    <View style={s.switchRow}>
      <Text style={s.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: c.success }} />
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
        placeholderTextColor={c.textMuted}
      />
    </View>
  );

  // ── Status badge ────────────────────────────────────────────────────────────
  const statusColor = initialized ? c.success : paramsSet ? '#FF9800' : created ? '#2196F3' : '#F44336';
  const statusText  = initialized ? tr.statusInitialized : paramsSet ? tr.statusParamsSet : created ? tr.statusCreated : tr.statusNotCreated;

  const tabLabels: Record<Screen, string> = {
    home: tr.tabHome, metrics: tr.tabMetrics, sdklogs: tr.tabSdkLogs, settings: tr.tabSettings, contacts: tr.tabContacts,
  };

  return (
    <ThemeCtx.Provider value={c}>
      <TransCtx.Provider value={tr}>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}
            contentContainerStyle={{ flexDirection: 'row' }}>
            {(['home', 'metrics', 'sdklogs', 'settings', 'contacts'] as Screen[]).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[s.tab, { flex: 0, paddingHorizontal: 18 }, screen === tab && s.tabActive]}
                onPress={() => setScreen(tab)}>
                <Text style={[s.tabText, screen === tab && s.tabTextActive]}>{tabLabels[tab]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Screen Content ──────────────────────────────────────────────── */}
          {screen === 'contacts' ? (
            <ContactsScreen />
          ) : screen === 'metrics' ? (
            <MetricsScreen sdkRef={sdkRef} />
          ) : screen === 'sdklogs' ? (
            <SdkLogsScreen entries={sdkLogs} onClear={clearSdkLogs} />
          ) : screen === 'settings' ? (
            <SettingsScreen
              theme={theme}
              language={language}
              onSetTheme={handleSetTheme}
              onSetLanguage={handleSetLanguage}
              maxFileSize={maxFileSize}
              maxFiles={maxFiles}
              onSetMaxFileSize={handleSetMaxFileSize}
              onSetMaxFiles={handleSetMaxFiles}
            />
          ) : (
            <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
              {/* ── Lifecycle Buttons ──────────────────────────────────────────── */}
              <Text style={s.sectionTitle}>{tr.sectionSdkLifecycle}</Text>

              {/* Step indicators */}
              <View style={s.stepRow}>
                {([tr.stepCreate, tr.stepSetParams, tr.stepInit] as const).map((label, i) => {
                  const done = i === 0 ? created : i === 1 ? paramsSet : initialized;
                  return (
                    <View key={label} style={s.stepItem}>
                      <View style={[s.stepDot, done && s.stepDotDone]}>
                        <Text style={s.stepNum}>{i + 1}</Text>
                      </View>
                      <Text style={[s.stepLabel, done && s.stepLabelDone]}>{label}</Text>
                    </View>
                  );
                })}
              </View>

              <View style={s.buttonRow}>
                <TouchableOpacity
                  style={[s.btn, s.btnCreate, created && s.btnDisabled]}
                  onPress={handleCreate}
                  disabled={created}>
                  <Text style={s.btnText}>{tr.btnCreate}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, s.btnDestroy, !created && s.btnDisabled]}
                  onPress={handleDestroy}
                  disabled={!created}>
                  <Text style={s.btnText}>{tr.btnDestroy}</Text>
                </TouchableOpacity>
              </View>

              {/* ── Parameters Section ─────────────────────────────────────────── */}
              <Text style={s.sectionTitle}>{tr.sectionParameters}</Text>
              <View style={s.card}>
                <Text style={s.cardTitle}>{tr.cardLogging}</Text>
                {renderSwitch(tr.switchEnabled, logEnabled, setLogEnabled)}
                {renderInput(tr.inputLevel, logLevel, setLogLevel)}
                {renderSwitch(tr.switchPjEnabled, pjLogEnabled, setPjLogEnabled)}
                {renderInput(tr.inputPjLevel, pjLogLevel, setPjLogLevel)}
                {renderSwitch(tr.switchRxTxEnabled, rxTxEnabled, setRxTxEnabled)}
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>{tr.cardHttp}</Text>
                {renderInput(tr.inputPort, httpPort, setHttpPort)}
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>{tr.cardSip}</Text>
                {renderInput(tr.inputUdpPort, sipUdpPort, setSipUdpPort)}
                {renderSwitch(tr.switchTcpEnabled, sipTcpEnabled, setSipTcpEnabled)}
                {renderInput(tr.inputTcpPort, sipTcpPort, setSipTcpPort)}
                {renderSwitch(tr.switchTlsEnabled, sipTlsEnabled, setSipTlsEnabled)}
                {renderInput(tr.inputTlsPort, sipTlsPort, setSipTlsPort)}
                {renderSwitch(tr.switchIpv6Enabled, sipIpv6Enabled, setSipIpv6Enabled)}
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>{tr.cardTls}</Text>
                {renderSwitch(tr.switchMtlsEnabled, mTlsEnabled, setMTlsEnabled)}
                {renderInput(tr.inputCertPath, certPath, setCertPath, 'default')}
                {renderInput(tr.inputPrivKeyPath, privKeyPath, setPrivKeyPath, 'default')}
                {renderInput(tr.inputCaListPath, caListPath, setCaListPath, 'default')}
              </View>

              <View style={s.card}>
                <Text style={s.cardTitle}>{tr.cardThreading}</Text>
                {renderInput(tr.inputSipRxThreads, sipRxThreads, setSipRxThreads)}
                {renderInput(tr.inputSipWorkerThreads, sipWorkerThreads, setSipWorkerThreads)}
              </View>

              {/* ── Action Buttons ─────────────────────────────────────────────── */}
              <View style={s.buttonRow}>
                <TouchableOpacity
                  style={[s.btn, s.btnSetParams, !created && s.btnDisabled]}
                  onPress={handleSetParams}
                  disabled={!created}>
                  <Text style={s.btnText}>{tr.btnSetParams}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, s.btnInit, (!created || !paramsSet || initialized) && s.btnDisabled]}
                  onPress={handleInit}
                  disabled={!created || !paramsSet || initialized}>
                  <Text style={s.btnText}>{tr.btnInitSdk}</Text>
                </TouchableOpacity>
              </View>

              {/* ── Log Console ────────────────────────────────────────────────── */}
              <View style={s.logHeader}>
                <Text style={s.sectionTitle}>{tr.sectionLogConsole}</Text>
                <TouchableOpacity onPress={clearLogs}>
                  <Text style={s.clearBtn}>{tr.btnClear}</Text>
                </TouchableOpacity>
              </View>
              <View style={s.logBox}>
                <ScrollView ref={scrollRef} nestedScrollEnabled>
                  {logs.length === 0 ? (
                    <Text style={s.logPlaceholder}>{tr.logPlaceholder}</Text>
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
      </TransCtx.Provider>
    </ThemeCtx.Provider>
  );
}

// ── Style factories ───────────────────────────────────────────────────────────

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    title: { fontSize: 20, fontWeight: '700', color: c.accent },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeText: { fontSize: 11, fontWeight: '700', color: c.textOnAccent },

    body: { flex: 1 },
    bodyContent: { padding: 16 },

    sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginTop: 12, marginBottom: 8 },

    card: {
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardTitle: { fontSize: 13, fontWeight: '600', color: c.accent, marginBottom: 8 },

    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    switchLabel: { fontSize: 13, color: c.textSecondary },

    inputRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    inputLabel: { fontSize: 13, color: c.textSecondary, flex: 1 },
    input: {
      backgroundColor: c.inputBg,
      color: c.textPrimary,
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
      backgroundColor: c.inputBg, justifyContent: 'center', alignItems: 'center',
      marginBottom: 4,
    },
    stepDotDone: { backgroundColor: c.success },
    stepNum: { color: c.textOnAccent, fontSize: 11, fontWeight: '700' },
    stepLabel: { color: c.textMuted, fontSize: 10 },
    stepLabelDone: { color: c.success },

    buttonRow: { flexDirection: 'row', gap: 10, marginVertical: 8 },
    btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    btnFull: { flex: 0, marginVertical: 4 },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    btnCreate:   { backgroundColor: '#4CAF50' },
    btnDestroy:  { backgroundColor: '#F44336' },
    btnListener: { backgroundColor: '#9C27B0', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
    btnSetParams: { backgroundColor: '#2196F3' },
    btnInit:     { backgroundColor: '#FF9800' },
    btnDisabled: { opacity: 0.4 },

    tabBar: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tab: {
      flex: 1,
      paddingVertical: 11,
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive:     { borderBottomColor: c.accent },
    tabText:       { color: c.textMuted, fontWeight: '600', fontSize: 13 },
    tabTextActive: { color: c.accent },

    logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    clearBtn:  { color: c.accent, fontSize: 13, fontWeight: '600' },
    logBox: {
      backgroundColor: c.logBg,
      borderRadius: 8,
      padding: 10,
      height: 200,
      borderWidth: 1,
      borderColor: c.border,
    },
    logPlaceholder: { color: c.textMuted, fontStyle: 'italic', fontSize: 12 },
    logLine: { color: c.textSecondary, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
    logTime:  { color: c.textMuted },
    logError: { color: c.error },
    logWarn:  { color: c.warn },
    logSdk:   { color: c.sdkLog },

    // Settings / segment controls
    segRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
    seg: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    segActive:     { backgroundColor: c.accent, borderColor: c.accent },
    segText:       { color: c.textMuted, fontSize: 13 },
    segTextActive: { color: c.textOnAccent, fontWeight: '700' },
    settingsNote: { color: c.textMuted, fontSize: 11, marginTop: 10, lineHeight: 16 },
    pathText: {
      color: c.sdkLog,
      fontSize: 10,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginTop: 6,
    },
  });
}

function makeSdkLogStyles(c: ThemePalette) {
  return StyleSheet.create({
    toolbar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    hint:       { color: c.textMuted, fontSize: 12 },
    clearBtn:   { color: c.accent, fontSize: 13, fontWeight: '600' },
    logBox:     { flex: 1, backgroundColor: c.logBg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: c.border },
    placeholder: { color: c.textMuted, fontStyle: 'italic', fontSize: 12, textAlign: 'center', marginTop: 40 },
    line:       { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
    time:       { color: c.textMuted },
    lbl:        { fontWeight: '700' },
  });
}

function makeMetricsStyles(c: ThemePalette) {
  return StyleSheet.create({
    root:          { flex: 1, backgroundColor: c.bg },
    content:       { padding: 16, paddingBottom: 40 },
    toolbar:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    hint:          { color: c.textMuted, fontSize: 12 },
    fetchBtn:      { backgroundColor: c.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
    fetchBtnText:  { color: c.textOnAccent, fontWeight: '700', fontSize: 13 },
    errorBox:      { backgroundColor: c.errorBoxBg, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: c.error },
    errorText:     { color: c.error, fontSize: 13 },
    empty:         { color: c.textMuted, textAlign: 'center', marginTop: 60, fontSize: 14, lineHeight: 22 },
    card:          { backgroundColor: c.surface, borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: c.border },
    cardHeader:    { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    famName:       { color: c.textPrimary, fontWeight: '700', fontSize: 13, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    typeBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
    typeBadgeText: { fontSize: 10, fontWeight: '700', color: '#1a1a2e' },
    famHelp:       { color: c.textMuted, fontSize: 11, marginBottom: 10 },
    table:         { borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    tableRow:      { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.tableRowBg },
    tableRowAlt:   { backgroundColor: c.tableRowAltBg },
    tableHead:     { backgroundColor: c.tableHeadBg },
    tableHeadText: { color: c.textSecondary, fontWeight: '700', fontSize: 11 },
    tableCellText: { color: c.textSecondary, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    labelText:     { color: c.textMuted, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
    valueText:     { flex: 2, textAlign: 'right', color: c.valueText, fontWeight: '700' },
    rawSection:    { marginTop: 16 },
    rawTitle:      { color: c.textMuted, fontSize: 11, marginBottom: 6 },
    rawBox:        { backgroundColor: c.logBg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: c.border },
    rawText:       { color: c.sdkLog, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  });
}

export default App;
