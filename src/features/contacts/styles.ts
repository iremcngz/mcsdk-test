import { Platform, StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeContactsStyles(c: ThemePalette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },

    // ── Search bar ────────────────────────────────────────────────────────────
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      margin: 12,
      borderRadius: 10,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    searchIcon:  { fontSize: 16, marginRight: 6 },
    searchInput: {
      flex: 1,
      color: c.textPrimary,
      fontSize: 14,
      paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    },

    countText: { color: c.textMuted, fontSize: 11, paddingHorizontal: 14, marginBottom: 4 },

    // ── Filter tabs ─────────────────────────────────────────────────────────────
    filterRow: {
      flexDirection: 'row',
      marginHorizontal: 12,
      marginBottom: 8,
      backgroundColor: c.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    filterTab: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: 9,
    },
    filterTabActive: {
      backgroundColor: c.accent,
    },
    filterTabText: {
      color: c.textSecondary,
      fontWeight: '600',
      fontSize: 13,
    },
    filterTabTextActive: {
      color: c.textOnAccent,
    },

    // ── Group row ────────────────────────────────────────────────────────────────
    groupIcon: { fontSize: 18, marginRight: 10 },

    // ── Contact row ───────────────────────────────────────────────────────────
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      marginHorizontal: 12,
      marginBottom: 6,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    rowSelected:   { borderColor: c.accent },
    presenceDot:   { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
    rowName:       { flex: 1, color: c.textPrimary, fontWeight: '600', fontSize: 14 },
    presenceLabel: { color: c.textMuted, fontSize: 11, marginRight: 8 },
    chevron:       { color: c.textMuted, fontSize: 11 },

    // ── Detail panel ──────────────────────────────────────────────────────────
    detail: {
      backgroundColor: c.surface,
      marginHorizontal: 12,
      marginTop: -6,
      marginBottom: 6,
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: c.accent,
      borderTopWidth: 0,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    },
    detailName: { color: c.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 2 },
    detailUri:  {
      color: c.accent,
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginBottom: 12,
    },

    // ── MC buttons ────────────────────────────────────────────────────────────
    mcRow:    { flexDirection: 'row', gap: 10, marginBottom: 8 },
    mcBtn:    { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
    mcHalf:   { backgroundColor: c.primary },
    mcFull:   { backgroundColor: c.secondary },
    mcBtnText: { color: c.textOnAccent, fontWeight: '700', fontSize: 12 },

    // ── Duplex call buttons ───────────────────────────────────────────────────
    duplexRow:  { flexDirection: 'row', gap: 10, marginBottom: 14 },
    duplexBtn:  { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1.5 },
    duplexHalf: { borderColor: c.primary, backgroundColor: 'transparent' },
    duplexFull: { borderColor: c.secondary, backgroundColor: 'transparent' },
    duplexBtnText: { color: c.textPrimary, fontWeight: '700', fontSize: 12 },

    // ── Info sections ─────────────────────────────────────────────────────────
    infoSection: {
      backgroundColor: c.bg,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
    },
    infoSectionTitle: { color: c.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 8 },
    infoRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    infoLabel: { color: c.textMuted, fontSize: 12 },
    infoValue: { color: c.textSecondary, fontSize: 12 },
    infoActive: { color: c.success },
    infoMissed: { color: c.error },

    // ── Callback section ──────────────────────────────────────────────────────
    callbackSection:  { backgroundColor: c.bg, borderRadius: 8, padding: 10 },
    callbackTitle:    { color: c.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 8 },
    callbackInfoRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    callbackLabel:    { color: c.textMuted, fontSize: 12 },
    callbackValue:    { color: c.textSecondary, fontSize: 12 },
    cbPending:        { color: c.warn },
    cbAccepted:       { color: c.success },
    cbRejected:       { color: c.error },
    requestBtn:       { backgroundColor: c.success, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 6 },
    requestBtnText:   { color: c.textOnAccent, fontWeight: '700', fontSize: 13 },

    // ── Empty state ───────────────────────────────────────────────────────────
    emptyWrap: { alignItems: 'center', marginTop: 60 },
    emptyIcon: { fontSize: 40, marginBottom: 10 },
    emptyText: { color: c.textMuted, fontSize: 14 },
  });
}
