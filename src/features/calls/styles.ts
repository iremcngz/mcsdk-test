/**
 * features/calls/styles.ts — Stylesheet factories for the call screens.
 *
 * Convention: a screen's main layout styles live here, one make*Styles(c)
 * factory per screen. Small, one-off inline styles (e.g. `{ flex: 1 }`,
 * `{ opacity: 0.5 }`) may stay inline at the call site.
 */

import { StyleSheet } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import type { ThemePalette } from '../../core/theme';
import type { FloorState } from './types';

export function makeCallStyles(c: ThemePalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.bg,
    },

    // ── Header ──────────────────────────────────────────────────────────────
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      gap: 8,
    },
    headerBack: {
      paddingVertical: 6,
      paddingHorizontal: 2,
    },
    headerBackText: {
      fontSize: 22,
      color: c.primary,
    },
    headerTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: c.textPrimary,
    },

    // ── Pills / badges ───────────────────────────────────────────────────────
    pill: {
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    pillText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#fff',
    },

    // ── Active call card ─────────────────────────────────────────────────────
    callCard: {
      margin: 16,
      borderRadius: 16,
      backgroundColor: c.surface,
      padding: 20,
      alignItems: 'center',
      gap: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    contactName: {
      fontSize: 22,
      fontWeight: '700',
      color: c.textPrimary,
      textAlign: 'center',
    },
    sipUri: {
      fontSize: 13,
      color: c.textSecondary,
      textAlign: 'center',
    },
    callStateBadge: {
      marginTop: 4,
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
    },
    stateText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
    },
    timerText: {
      fontSize: 13,
      color: c.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    commencementPill: {
      position: 'absolute',
      top: 12,
      right: 12,
    },

    // ── Floor button ─────────────────────────────────────────────────────────
    floorButtonWrap: {
      alignItems: 'center',
      marginTop: 24,
      gap: 12,
    },
    floorButton: {
      width: 120,
      height: 120,
      borderRadius: 60,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 10,
      elevation: 6,
    },
    floorButtonIcon: {
      fontSize: 36,
    },
    floorButtonLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: '#fff',
      marginTop: 2,
    },

    // ── Join button ──────────────────────────────────────────────────────────
    joinButton: {
      marginHorizontal: 32,
      marginTop: 16,
      borderRadius: 28,
      backgroundColor: c.primary,
      paddingVertical: 14,
      alignItems: 'center',
    },
    joinButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff',
    },

    // ── End call button ──────────────────────────────────────────────────────
    endCallButton: {
      marginHorizontal: 32,
      marginTop: 16,
      marginBottom: 8,
      borderRadius: 28,
      backgroundColor: c.error,
      paddingVertical: 14,
      alignItems: 'center',
    },
    endCallText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#fff',
    },

    // ── History list ─────────────────────────────────────────────────────────
    historyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    historyTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: '700',
      color: c.textPrimary,
    },
    clearBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.error,
    },
    clearBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.error,
    },

    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    emptyIcon: {
      fontSize: 48,
    },
    emptyText: {
      fontSize: 15,
      color: c.textSecondary,
    },
    countText: {
      fontSize: 12,
      color: c.textSecondary,
      paddingHorizontal: 16,
      marginBottom: 4,
    },

    // ── History item ─────────────────────────────────────────────────────────
    historyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
      gap: 12,
    },
    directionArrow: {
      fontSize: 20,
      width: 24,
      textAlign: 'center',
    },
    historyItemBody: {
      flex: 1,
      gap: 2,
    },
    historyContactName: {
      fontSize: 15,
      fontWeight: '600',
      color: c.textPrimary,
    },
    historySipUri: {
      fontSize: 12,
      color: c.textSecondary,
    },
    historyMeta: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
      marginTop: 2,
    },
    historyMetaText: {
      fontSize: 12,
      color: c.textSecondary,
    },
    callBackBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: c.primary,
    },
    callBackBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#fff',
    },
  });
}

// ── CallsTab — connecting banner ───────────────────────────────────────────
export function makeCallsTabStyles(c: ThemePalette) {
  return StyleSheet.create({
    banner: {
      backgroundColor: c.warn,
      paddingVertical: 6,
      alignItems: 'center',
    },
    bannerText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#fff',
    },
  });
}

// ── MockCallsPanel — collapsible dev/test panel ────────────────────────────
export function makeMockCallsPanelStyles(c: ThemePalette) {
  return StyleSheet.create({
    card: {
      margin: 12,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.warn + '88',
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: c.warn + '18',
      gap: 8,
    },
    headerTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: c.warn,
    },
    chevron: {
      fontSize: 14,
      color: c.textSecondary,
    },
    body: {
      padding: 14,
      gap: 14,
    },
    inputRow: {
      gap: 6,
    },
    inputLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 13,
      color: c.textSecondary,
      backgroundColor: c.bg,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    btn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#fff',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    commencementRow: {
      flexDirection: 'row',
      gap: 8,
    },
    commBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1.5,
      alignItems: 'center',
    },
    commBtnText: {
      fontSize: 12,
      fontWeight: '700',
    },
  });
}

// ── OutgoingCallScreen — connecting/outgoing call ──────────────────────────
export function makeOutgoingCallStyles(c: ThemePalette, insets: EdgeInsets) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      paddingTop: insets.top + 60,
      paddingBottom: insets.bottom + 50,
      paddingHorizontal: 32,
      alignItems: 'center',
    },
    avatarRing: {
      width: 110,
      height: 110,
      borderRadius: 55,
      backgroundColor: c.surface,
      borderWidth: 3,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    avatarIcon: {
      fontSize: 48,
    },
    contactName: {
      fontSize: 30,
      fontWeight: '700',
      color: c.textPrimary,
      textAlign: 'center',
      marginBottom: 8,
    },
    statusText: {
      fontSize: 18,
      fontWeight: '500',
      color: c.textSecondary,
      marginTop: 16,
      letterSpacing: 1,
    },
    spacer: {
      flex: 1,
    },
    mockAnswerBtn: {
      paddingHorizontal: 32,
      paddingVertical: 14,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 24,
    },
    mockAnswerText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.textSecondary,
    },
    endCallButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.error,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 10,
    },
    endCallIcon: {
      fontSize: 28,
      color: '#fff',
    },
    endCallLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textSecondary,
      marginTop: 8,
    },
  });
}

// ── IncomingCallOverlay — full-screen ringing overlay ──────────────────────
export function makeIncomingCallOverlayStyles(c: ThemePalette, insets: EdgeInsets, isDark: boolean) {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(248, 250, 252, 0.95)',
      zIndex: 9999,
      justifyContent: 'space-between',
    },
    header: {
      paddingTop: insets.top + 40,
      alignItems: 'center',
    },
    incomingLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: c.textSecondary,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: 40,
    },
    avatarContainer: {
      alignItems: 'center',
      marginBottom: 32,
    },
    avatarRing: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: c.surface,
      borderWidth: 4,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 10,
    },
    avatarIcon: {
      fontSize: 54,
    },
    contactInfo: {
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    contactName: {
      fontSize: 34,
      fontWeight: '800',
      color: c.textPrimary,
      textAlign: 'center',
      marginBottom: 12,
      letterSpacing: -0.5,
    },
    actionsContainer: {
      paddingBottom: insets.bottom + 40,
      paddingHorizontal: 32,
      alignItems: 'center',
      gap: 32,
    },
    sliderWrap: {
      width: '100%',
      height: 72,
      borderRadius: 36,
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    sliderTrack: {
      flex: 1,
      borderRadius: 36,
      justifyContent: 'center',
      position: 'relative',
    },
    sliderThumb: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.success || '#10b981',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'absolute',
      left: 4,
      zIndex: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    sliderThumbIcon: {
      fontSize: 28,
      color: '#fff',
    },
    sliderLabelContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1,
    },
    sliderLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
      letterSpacing: 0.5,
      paddingLeft: 40, // Thumb'ın arkasında kalmaması için
    },
    declineBtn: {
      paddingHorizontal: 40,
      paddingVertical: 14,
      borderRadius: 28,
      backgroundColor: 'transparent',
    },
    declineText: {
      fontSize: 16,
      fontWeight: '700',
      color: c.error || '#ef4444',
      letterSpacing: 0.5,
    },
  });
}

// ── ActiveCallFullScreen — full-screen active call ─────────────────────────
// Several styles depend on live values (floor state, computed button size), so
// those are passed in alongside the palette.
interface ActiveCallFullScreenStyleOpts {
  insets: EdgeInsets;
  isDark: boolean;
  ringColor: string;
  isGranted: boolean;
  floorState: FloorState;
  buttonSize: number;
  ringSize: number;
}

export function makeActiveCallFullScreenStyles(
  c: ThemePalette,
  { insets, isDark, ringColor, isGranted, floorState, buttonSize, ringSize }: ActiveCallFullScreenStyleOpts,
) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      paddingTop: insets.top ,
      paddingBottom: insets.bottom + 30,
    },
    header: {
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    avatarContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    avatarRing: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.surface,
      borderWidth: 3,
      borderColor: isGranted ? (c.success || '#10b981') : c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: isGranted ? (c.success || '#10b981') : c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 5,
    },
    avatarIcon: {
      fontSize: 36,
    },
    contactName: {
      fontSize: 30,
      fontWeight: '800',
      color: c.textPrimary,
      textAlign: 'center',
      letterSpacing: -0.5,
    },
    timer: {
      fontSize: 42,
      fontWeight: '200',
      color: c.textPrimary,
      fontVariant: ['tabular-nums'],
      letterSpacing: 2,
      marginTop: 12,
    },
    centerBody: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      marginVertical: 32, // ÜST VE ALT TARAFTA GÜVENLİ BOŞLUK GARANTİSİ EKLENDİ
      minHeight: ringSize,
    },
    pushButtonWrapper: {
      width: ringSize,
      height: ringSize,
      justifyContent: 'center',
      alignItems: 'center',
    },
    pushButtonRing: {
      position: 'absolute',
      width: ringSize,
      height: ringSize,
      borderRadius: ringSize / 2,
      borderWidth: 2,
      borderColor: ringColor,
      opacity: 0.5,
    },
    pushButton: {
      width: buttonSize,
      height: buttonSize,
      borderRadius: buttonSize / 2,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
      shadowColor: floorState === 'busy' ? '#000' : ringColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 8,
    },
    pushButtonDisabled: {
      opacity: 0.6,
    },
    voiceMeterContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 36,
      marginBottom: 8,
      paddingHorizontal: 20,
    },
    voiceBar: {
      flex: 1,
      borderRadius: 3,
      minHeight: 4,
    },
    pushButtonStatus: {
      color: isDark ? '#ffffff' : c.textPrimary,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
      textAlign: 'center',
    },
    pushStat: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '500',
      textAlign: 'center',
      marginTop: 28,
      letterSpacing: 0.5,
    },
    actionsContainer: {
      alignItems: 'center',
      paddingHorizontal: 24,
      gap: 12,
    },
    endCallButton: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.error || '#ef4444',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.error || '#ef4444',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 10,
    },
    endCallIcon: {
      fontSize: 32,
      color: '#fff',
      transform: [{ rotate: '135deg' }],
    },
    endCallLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: c.textSecondary,
    },
  });
}

// ── IncomingCallScreen — in-tab ringing view ───────────────────────────────
export function makeIncomingCallScreenStyles(c: ThemePalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      paddingHorizontal: 32,
    },
    callLabel: {
      fontSize: 14,
      color: c.textSecondary,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    ringWrap: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: c.primary + '22',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringIcon: {
      fontSize: 52,
    },
    name: {
      fontSize: 26,
      fontWeight: '700',
      color: c.textPrimary,
      textAlign: 'center',
    },
    uri: {
      fontSize: 13,
      color: c.textSecondary,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      gap: 40,
      marginTop: 24,
    },
    actionBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 5,
    },
    actionIcon: {
      fontSize: 28,
    },
    actionLabel: {
      fontSize: 12,
      fontWeight: '600',
      marginTop: 6,
      color: c.textSecondary,
    },
    actionWrap: {
      alignItems: 'center',
    },
  });
}

// ── MockActiveCallControls — dev/test panel inside ActiveCallCard ───────────
export function makeMockActiveCallControlsStyles(c: ThemePalette) {
  return StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginTop: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: c.warn + '88',
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: c.warn + '18',
    },
    headerTitle: {
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
      color: c.warn,
    },
    chevron: { fontSize: 12, color: c.textSecondary },
    body: {
      padding: 12,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    btn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
    },
    btnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  });
}
