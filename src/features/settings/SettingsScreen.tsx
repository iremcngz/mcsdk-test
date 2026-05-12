import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { makeCommonStyles } from '../../shared/commonStyles';
import { getLogFilePaths, deleteLogFiles } from '../../core/logger';
import type { AppTheme, AppLanguage } from '../../core/settings';

export function SettingsScreen() {
  const {
    c, tr, theme, language,
    maxFileSize, maxFiles,
    setTheme, setLanguage, setMaxFileSize, setMaxFiles,
    stayLoggedIn, setStayLoggedIn, logout,
  } = useAppContext();

  const s = useMemo(() => makeCommonStyles(c), [c]);
  const [logPaths, setLogPaths] = useState<string[]>([]);

  // Auto-load paths on mount so the user sees them immediately.
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

      {/* Account */}
      <Text style={s.sectionTitle}>{tr.sectionAccount}</Text>
      <View style={s.card}>
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>{tr.cardStayLoggedIn}</Text>
          <Switch
            value={stayLoggedIn}
            onValueChange={setStayLoggedIn}
            trackColor={{ true: c.accent }}
          />
        </View>
        <TouchableOpacity
          style={[s.seg, { borderColor: c.error, marginTop: 10 }]}
          onPress={logout}>
          <Text style={[s.segText, { color: c.error }]}>{tr.btnLogout}</Text>
        </TouchableOpacity>
      </View>

      {/* App appearance */}
      <Text style={s.sectionTitle}>{tr.sectionAppearance}</Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardTheme}</Text>
        <View style={s.segRow}>
          {(['dark', 'light'] as AppTheme[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.seg, theme === t && s.segActive]}
              onPress={() => setTheme(t)}>
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
              onPress={() => setLanguage(l)}>
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
              onPress={() => setMaxFileSize(opt.bytes)}>
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
              onPress={() => setMaxFiles(n)}>
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
