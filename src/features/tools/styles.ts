/**
 * features/tools/styles.ts — the Tools menu's rows.
 *
 * Colours come from ThemePalette only, so light and dark both work.
 */

import { StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeToolsStyles(c: ThemePalette) {
  return StyleSheet.create({
    subtitle: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: -4,
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: c.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 14,
      marginBottom: 10,
    },
    rowIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: c.primary + '14',
      borderWidth: 1,
      borderColor: c.primary + '44',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowIcon:      { fontSize: 20 },
    rowTextBlock: { flex: 1 },
    rowTitle:     { fontSize: 15, fontWeight: '700', color: c.textPrimary },
    rowDesc:      { fontSize: 11, color: c.textMuted, marginTop: 2 },
    rowBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 9,
      backgroundColor: c.sdkLog + '22',
      borderWidth: 1,
      borderColor: c.sdkLog + '55',
    },
    rowBadgeText: { fontSize: 10, fontWeight: '800', color: c.sdkLog },
    rowChevron:   { fontSize: 22, color: c.textMuted, fontWeight: '300' },
  });
}
