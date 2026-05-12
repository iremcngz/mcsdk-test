/**
 * shared/commonStyles.ts — Style factory for UI primitives shared across
 * all feature screens. Each feature may extend these with its own StyleSheet.
 */

import { Platform, StyleSheet } from 'react-native';
import type { ThemePalette } from '../core/theme';

export function makeCommonStyles(c: ThemePalette) {
  return StyleSheet.create({
    // ── Layout ──────────────────────────────────────────────────────────────
    root:        { flex: 1, backgroundColor: c.bg },
    body:        { flex: 1 },
    bodyContent: { padding: 16 },

    // ── Header ──────────────────────────────────────────────────────────────
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
    title:     { fontSize: 20, fontWeight: '700', color: c.accent },
    badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeText: { fontSize: 11, fontWeight: '700', color: c.textOnAccent },

    // ── Tab bar ─────────────────────────────────────────────────────────────
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
    tabText:       { color: c.textMuted, fontWeight: '600', fontSize: 11 },
    tabTextActive: { color: c.accent },

    // ── Section / Card ───────────────────────────────────────────────────────
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: c.textPrimary,
      marginTop: 12,
      marginBottom: 8,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardTitle: { fontSize: 13, fontWeight: '600', color: c.accent, marginBottom: 8 },

    // ── Switch row ───────────────────────────────────────────────────────────
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    switchLabel: { fontSize: 13, color: c.textSecondary },

    // ── Input row ────────────────────────────────────────────────────────────
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

    // ── Step indicators ──────────────────────────────────────────────────────
    stepRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    stepItem:    { alignItems: 'center', flex: 1 },
    stepDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.inputBg,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 4,
    },
    stepDotDone:  { backgroundColor: c.success },
    stepNum:      { color: c.textOnAccent, fontSize: 11, fontWeight: '700' },
    stepLabel:    { color: c.textMuted, fontSize: 10 },
    stepLabelDone:{ color: c.success },

    // ── Buttons ──────────────────────────────────────────────────────────────
    buttonRow:   { flexDirection: 'row', gap: 10, marginVertical: 8 },
    btn:         { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    btnText:     { color: c.textOnAccent, fontWeight: '700', fontSize: 13 },
    btnCreate:   { backgroundColor: c.success },
    btnDestroy:  { backgroundColor: c.error },
    btnSetParams:{ backgroundColor: c.primary },
    btnInit:     { backgroundColor: c.warn },
    btnDisabled: { opacity: 0.4 },

    // ── Log console ──────────────────────────────────────────────────────────
    logHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    clearBtn: { color: c.accent, fontSize: 13, fontWeight: '600' },
    logBox: {
      backgroundColor: c.logBg,
      borderRadius: 8,
      padding: 10,
      height: 200,
      borderWidth: 1,
      borderColor: c.border,
    },
    logPlaceholder: { color: c.textMuted, fontStyle: 'italic', fontSize: 12 },
    logLine: {
      color: c.textSecondary,
      fontSize: 11,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginBottom: 2,
    },
    logTime:  { color: c.textMuted },
    logError: { color: c.error },
    logWarn:  { color: c.warn },
    logSdk:   { color: c.sdkLog },

    // ── Registration progress bar ─────────────────────────────────────────────────
    progressTrack: {
      height: 10,
      backgroundColor: c.inputBg,
      borderRadius: 5,
      overflow: 'hidden',
    },
    progressFill: {
      height: 10,
      backgroundColor: c.success,
      borderRadius: 5,
    },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    progressPhase: { fontSize: 12, color: c.textSecondary, flex: 1 },
    progressPct:   { fontSize: 12, fontWeight: '700', color: c.success },
    progressState: { fontSize: 11, color: c.textMuted, marginTop: 4 },

    // ── Segment controls (Settings) ──────────────────────────────────────────
    segRow:        { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
    seg:           { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    segActive:     { backgroundColor: c.accent, borderColor: c.accent },
    segText:       { color: c.textMuted, fontSize: 13 },
    segTextActive: { color: c.textOnAccent, fontWeight: '700' },
    settingsNote:  { color: c.textMuted, fontSize: 11, marginTop: 10, lineHeight: 16 },
    pathText: {
      color: c.sdkLog,
      fontSize: 10,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      marginTop: 6,
    },
  });
}
