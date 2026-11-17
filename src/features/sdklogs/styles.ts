import { StyleSheet, Platform } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeSdkLogStyles(c: ThemePalette) {
  const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
  return StyleSheet.create({
    root:        { flex: 1, padding: 12, backgroundColor: c.bg },
    toolbar:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    hint:        { color: c.textMuted, fontSize: 12 },
    clearBtn:    { color: c.accent, fontSize: 13, fontWeight: '600' },
    // The level filter. Same shape as the Log Console's two tabs.
    filterRow:   { flexDirection: 'row', gap: 6, marginBottom: 8 },
    filterTab:   { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingVertical: 6 },
    filterTabActive: { backgroundColor: c.accent, borderColor: c.accent },
    filterTabText:   { color: c.textMuted, fontSize: 12 },
    filterTabTextActive: { color: c.textOnAccent, fontWeight: '700' },
    logBox:      { flex: 1, backgroundColor: c.logBg, borderRadius: 8, borderWidth: 1, borderColor: c.border },
    logContent:  { padding: 10 },
    placeholder: { color: c.textMuted, fontStyle: 'italic', fontSize: 12, textAlign: 'center', marginTop: 40 },
    line:        { fontSize: 11, fontFamily: mono, marginBottom: 2 },
    time:        { color: c.textMuted },
    lbl:         { fontWeight: '700' },
    // One colour per level, as fixed style objects: a `{ color }` literal built
    // in render was a new object for every row on every update, which made the
    // whole list re-lay out each time it was given new data.
    lvlVerbose:  { color: c.textMuted },
    lvlInfo:     { color: c.sdkLog },
    lvlWarn:     { color: c.warn },
    lvlError:    { color: c.error },
    // A marker row for lines that left the native ring before they were fetched.
    gap:         { fontSize: 11, fontFamily: mono, color: c.warn, textAlign: 'center', marginVertical: 4 },
  });
}
