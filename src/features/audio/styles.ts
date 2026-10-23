/**
 * features/audio/styles.ts — styles for the audio capture diagnostics screen.
 *
 * Every colour comes from ThemePalette so light and dark both work; nothing is
 * hardcoded.
 */

import { StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeAudioStyles(c: ThemePalette) {
  return StyleSheet.create({
    section: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 18,
      marginBottom: 8,
    },

    card: {
      backgroundColor: c.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },

    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    rowLabel: {
      fontSize: 13,
      color: c.textSecondary,
      flexShrink: 1,
    },
    rowValue: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    // Used for a dropped-frame count above zero and a missing permission.
    rowValueWarn: {
      color: c.error,
    },

    fileName: {
      fontSize: 12,
      color: c.textPrimary,
      flexShrink: 1,
      marginRight: 10,
    },

    empty: {
      fontSize: 13,
      color: c.textSecondary,
      paddingVertical: 10,
      fontStyle: 'italic',
    },

    hint: {
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 8,
      lineHeight: 15,
    },

    // ── Player card (shown only while playing) ────────────────────────────
    playerCard: {
      marginTop: 14,
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.primary,
      padding: 14,
    },
    playerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    playerFile: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
      color: c.textPrimary,
      marginRight: 10,
    },
    stopButton: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: c.error,
    },
    stopButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textOnAccent,
    },

    progressTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginTop: 14,
      overflow: 'hidden',
    },
    progressFill: {
      height: 4,
      borderRadius: 2,
      backgroundColor: c.primary,
    },
    playerElapsed: {
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 7,
      fontVariant: ['tabular-nums'],
    },

    tileRow: {
      flexDirection: 'row',
      marginTop: 14,
    },
    tile: {
      flex: 1,
      alignItems: 'center',
    },
    tileValue: {
      fontSize: 17,
      fontWeight: '700',
      color: c.textPrimary,
      fontVariant: ['tabular-nums'],
    },
    // A counter that must stay 0 and did not.
    tileValueWarn: {
      color: c.error,
    },
    tileLabel: {
      fontSize: 10,
      color: c.textSecondary,
      marginTop: 3,
      textAlign: 'center',
    },

    playButton: {
      marginLeft: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: c.primary,
    },
    playButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textOnAccent,
    },

    subLabel: {
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 10,
      marginBottom: 6,
    },

    chipSmall: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      marginRight: 6,
      marginBottom: 6,
    },
    chipTextSmall: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textPrimary,
    },

    evidenceRow: {
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    evidenceText: {
      fontSize: 11,
      color: c.textSecondary,
      fontVariant: ['tabular-nums'],
    },

    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    chip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      marginRight: 8,
    },
    chipActive: {
      borderColor: c.primary,
      backgroundColor: c.primary,
    },
    chipDisabled: {
      opacity: 0.5,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.textPrimary,
    },
    chipTextActive: {
      color: c.textOnAccent,
    },

    actionButton: {
      marginTop: 18,
      paddingVertical: 15,
      borderRadius: 10,
      alignItems: 'center',
    },
    actionButtonDisabled: {
      opacity: 0.6,
    },
    actionButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: c.textOnAccent,
      letterSpacing: 0.5,
    },

    errorBox: {
      marginTop: 12,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.error,
      backgroundColor: c.surface,
    },
    errorText: {
      fontSize: 12,
      color: c.error,
      lineHeight: 17,
    },
  });
}
