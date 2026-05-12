import { StyleSheet, Platform } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeSdkLogStyles(c: ThemePalette) {
  return StyleSheet.create({
    toolbar:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    hint:        { color: c.textMuted, fontSize: 12 },
    clearBtn:    { color: c.accent, fontSize: 13, fontWeight: '600' },
    logBox:      { flex: 1, backgroundColor: c.logBg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: c.border },
    placeholder: { color: c.textMuted, fontStyle: 'italic', fontSize: 12, textAlign: 'center', marginTop: 40 },
    line:        { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
    time:        { color: c.textMuted },
    lbl:         { fontWeight: '700' },
  });
}
