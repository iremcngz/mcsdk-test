import { StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeMessagesStyles(c: ThemePalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    backText: {
      color: c.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    headerInfo: {
      flex: 1,
    },
    headerTitle: {
      color: c.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    headerGroup: {
      color: c.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
    },
    emptyWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      color: c.textMuted,
      fontSize: 14,
    },
    list: {
      flex: 1,
    },
    listContent: {
      padding: 16,
    },
    msgBubble: {
      maxWidth: '80%',
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 8,
    },
    msgOwn: {
      backgroundColor: c.accent,
      alignSelf: 'flex-end',
      borderBottomRightRadius: 4,
    },
    msgOther: {
      backgroundColor: c.surface,
      alignSelf: 'flex-start',
      borderBottomLeftRadius: 4,
      borderWidth: 1,
      borderColor: c.border,
    },
    msgText: {
      color: c.textOnAccent,
      fontSize: 14,
      lineHeight: 20,
    },
    msgImage: {
      width: '100%',
      height: 160,
      borderRadius: 10,
      marginBottom: 6,
    },
    fileAttach: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    fileIcon: {
      fontSize: 20,
      marginRight: 8,
    },
    fileInfo: {
      flex: 1,
    },
    fileName: {
      color: c.textOnAccent,
      fontSize: 13,
      fontWeight: '600',
    },
    fileSize: {
      color: c.textOnAccent,
      fontSize: 11,
      opacity: 0.7,
      marginTop: 2,
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
      gap: 6,
    },
    attachButton: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    attachIcon: {
      fontSize: 16,
    },
    textInput: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: c.textPrimary,
      fontSize: 14,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.accent,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
    sendText: {
      fontSize: 18,
      color: c.textOnAccent,
    },
  });
}
