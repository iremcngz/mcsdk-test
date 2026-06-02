/**
 * features/calls/styles.ts — Shared stylesheet factory for all call screens.
 */

import { StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeCallStyles(c: ThemePalette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: c.background,
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
      color: c.text,
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
      color: c.text,
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
      color: c.text,
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
      color: c.text,
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
