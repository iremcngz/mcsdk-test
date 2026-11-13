import { Platform, StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeLogConsoleStyles(c: ThemePalette) {
  return StyleSheet.create({
    root:      { flex: 1, padding: 12, backgroundColor: c.bg },
    toolbar:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    hint:      { color: c.textSecondary, fontSize: 13, flex: 1, marginRight: 12 },
    clearBtn:  { color: c.accent, fontSize: 14, fontWeight: '700' },
    // The Listener-only filter, as a two-way segmented control rather than the
    // single toggling link Home had: which of the two views is showing has to
    // be readable at a glance on a screen that is nothing but the console.
    filterRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    filterTab: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: 'center',
    },
    filterTabActive:     { backgroundColor: c.accent, borderColor: c.accent },
    filterTabText:       { color: c.textSecondary, fontSize: 13, fontWeight: '600' },
    filterTabTextActive: { color: c.textOnAccent },
    logBox: {
      flex: 1,
      backgroundColor: c.logBg,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    logContent:  { padding: 10 },
    placeholder: { color: c.textMuted, fontStyle: 'italic', fontSize: 12, padding: 10 },
    line: {
      color: c.textSecondary,
      fontSize: 11,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginBottom: 2,
    },
    time:  { color: c.textMuted },
    error: { color: c.error },
    warn:  { color: c.warn },
    sdk:   { color: c.sdkLog },
  });
}
