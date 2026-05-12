import { Platform, StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeMetricsStyles(c: ThemePalette) {
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
    typeBadgeText: { fontSize: 10, fontWeight: '700', color: c.bg },
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
