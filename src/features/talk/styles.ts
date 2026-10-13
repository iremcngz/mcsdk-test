import { StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

export function makeTalkStyles(c: ThemePalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      padding: 16,
    },
    groupsScroll: {
      height: 75,
      marginBottom: 8,
    },
    groupsContainer: {
      paddingRight: 20,
      paddingLeft: 4,
      alignItems: 'center',
    },
    groupCol: {
      alignItems: 'center',
      marginRight: 16,
    },
    groupAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 2,
      borderColor: c.border,
      backgroundColor: c.surface,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
    },
    groupAvatarWrap: {
      position: 'relative',
    },
    incomingBadge: {
      position: 'absolute',
      top: -4,
      left: -4,
      width: 60,
      height: 60,
      borderRadius: 30,
      borderWidth: 3,
      borderColor: c.error,
    },
    groupAvatarActive: {
      backgroundColor: c.accent,
      borderColor: c.accent,
    },
    groupLabel: {
      color: c.textSecondary,
      fontSize: 10,
      fontWeight: '700',
      marginTop: 2,
      textAlign: 'center',
    },
    groupLabelActive: {
      color: c.textPrimary,
    },
    groupIconWrap: {
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    groupIconPerson: {
      alignItems: 'center',
    },
    groupIconHead: {
      width: 16,
      height: 16,
      borderRadius: 8,
    },
    groupIconBody: {
      width: 20,
      height: 10,
      borderRadius: 3,
      marginTop: 2,
    },
    centerCard: {
      flex: 25,
      backgroundColor: c.surface,
      borderRadius: 16,
      padding: 18,
      borderWidth: 1,
      borderColor: c.border,
    },
    centerBody: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    selectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    selectedLabel: {
      color: c.textPrimary,
      fontSize: 16,
      fontWeight: '800',
      // Group ids can be full SIP URIs. flexShrink lets the label give way and
      // ellipsise rather than pushing the action buttons out of the row;
      // minWidth:0 is what actually allows a flex child to shrink below its
      // content width. Horizontal only — the row's height is unchanged.
      flexShrink: 1,
      minWidth: 0,
      marginRight: 10,
    },
    // Replaces the inline row style so the buttons can be told never to shrink.
    selectedActions: {
      flexDirection: 'row',
      gap: 8,
      flexShrink: 0,
    },
    menuToggleButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
      // Keeps the 40x40 circle from being squeezed by a long group label.
      flexShrink: 0,
    },
    menuToggleIcon: {
      color: c.textPrimary,
      fontSize: 18,
      fontWeight: '700',
      lineHeight: 20,
    },
    mockToggleMini: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mockToggleMiniText: {
      fontSize: 14,
      color: c.textMuted,
    },
    menuOverlayContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
    },
    menuBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    menuCard: {
      position: 'absolute',
      top: 52,
      left: 0,
      right: 0,
      backgroundColor: c.bg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: 8,
      zIndex: 21,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 20,
      elevation: 12,
    },
    menuItem: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
    },
    menuItemText: {
      color: c.textPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    pushButtonWrapper: {
      width: 270,
      height: 270,
      alignSelf: 'center',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 14,
    },
    // Dış yükleme ve durum halkası
    pushButtonRing: {
      position: 'absolute',
      width: 266,
      height: 266,
      borderRadius: 133,
      borderWidth: 6.5,
      borderColor: c.accent,
      opacity: 0.8,
    },
    pushButton: {
      width: 230,
      height: 230,
      alignSelf: 'center',
      borderRadius: 115,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      // Sabit ve temiz bir border, derinlik hissi için şık gölgeler
      borderColor: 'rgba(255, 255, 255, 0.1)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.24,
      shadowRadius: 16,
      elevation: 10,
    },
    pushButtonDisabled: {
      opacity: 0.4,
    },
    buttonSpeakerName: {
      color: 'rgba(255, 255, 255, 0.6)',
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 8,
    },
    voiceMeterContainer: {
      flexDirection: 'row',
      alignItems: 'center', // Barları ortalayarak daha modern bir görünüm elde edebiliriz
      justifyContent: 'center',
      gap: 4,
      height: 40,
      marginBottom: 12,
      paddingHorizontal: 30,
    },
    voiceBar: {
      flex: 1,
      borderRadius: 3,
      minHeight: 4,
    },
    pushButtonStatus: {
      fontSize: 22,
      fontWeight: '700',
      letterSpacing: 0.5,
      textAlign: 'center',
    },
    speakerName: {
      color: c.textOnAccent,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 12,
    },

    pushButtonText: {
      color: c.textOnAccent,
      fontSize: 20,
      fontWeight: '800',
      textAlign: 'center',
      marginBottom: 6,
    },

    voiceLevelRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 10,
      minHeight: 20,
    },
    voiceLevelBar: {
      width: 10,
      height: 10,
      backgroundColor: c.inputBg,
      borderRadius: 4,
      opacity: 0.35,
    },
    voiceLevelBarActive: {
      backgroundColor: c.success,
    },
    pushButtonMeta: {
      color: c.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },
    pushStatus: {
      color: c.textSecondary,
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 22,
    },
    modeRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 16,
    },
    modeRowHidden: {
      opacity: 0,
      pointerEvents: 'none',
    },
    modePill: {
      flex: 1,
      backgroundColor: c.bg,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 2,
    },
    modePillActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 5,
    },
    modePillActiveReceive: {
      backgroundColor: c.success,
      borderColor: c.success,
      shadowColor: c.success,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 5,
    },
    modePillDisabled: {
      opacity: 0.4,
    },
    modePillContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    modeIcon: {
      fontSize: 16,
    },
    modeText: {
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: '800',
    },
    modeTextActive: {
      color: c.textOnAccent,
      fontSize: 14,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: -12
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      paddingVertical: 8,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
    },
    startButton: {
      backgroundColor: c.primary,
    },
    endButton: {
      backgroundColor: c.error,
    },
    actionButtonDisabled: {
      opacity: 0.35,
    },
    actionButtonText: {
      color: c.textOnAccent,
      fontWeight: '700',
      fontSize: 14,
    },
    actionButtonTextDisabled: {
      opacity: 0.5,
    },
    actionButtonIcon: {
      fontSize: 18,
    },
    mockOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
      justifyContent: 'flex-end',
    },
    mockBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    mockCard: {
      backgroundColor: c.bg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 16,
    },
    mockHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    mockTitle: {
      color: c.textPrimary,
      fontWeight: '700',
    },
    mockCloseButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    mockCloseText: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    mockSectionLabel: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    mockRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    mockButton: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 11,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mockButtonPrimary: {
      backgroundColor: c.primary,
    },
    mockButtonDanger: {
      backgroundColor: c.error,
    },
    mockButtonReset: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    mockButtonText: {
      color: c.textOnAccent,
      fontSize: 12,
      fontWeight: '800',
    },
    mockButtonTextReset: {
      color: c.textSecondary,
    },

    // ── Affiliation editor ──────────────────────────────────────────────────
    // Edit button sits in the group strip, styled as a dashed "add/edit" slot so
    // it reads as an action rather than another group avatar.
    affEditButton: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: c.textMuted,
      backgroundColor: c.surface,
      justifyContent: 'center',
      alignItems: 'center',
    },
    affEditIcon: {
      fontSize: 20,
      color: c.textSecondary,
    },
    affEditLabel: {
      color: c.textMuted,
      fontSize: 10,
      fontWeight: '700',
      marginTop: 2,
      textAlign: 'center',
    },
    affEmptyWrap: {
      flex: 1,
      justifyContent: 'center',
      paddingLeft: 4,
    },
    affEmptyText: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },

    // Bottom-sheet overlay, matching the mock panel's overlay geometry.
    affOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 30,
      justifyContent: 'flex-end',
    },
    affBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    affSheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 16,
      maxHeight: '82%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 16,
    },
    affGrabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: 12,
    },
    affHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    affTitle: {
      color: c.textPrimary,
      fontSize: 17,
      fontWeight: '800',
    },
    affSubtitle: {
      color: c.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    affCountText: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '700',
      marginTop: 6,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    affBulkRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
      marginBottom: 10,
    },
    affBulkButton: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    affBulkButtonText: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    affList: {
      marginBottom: 12,
    },
    // Row is now two-part: a tappable main area (checkbox + name) and a service
    // chip row underneath, so both live inside one bordered card.
    affRow: {
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      marginBottom: 8,
    },
    affRowMain: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    affRowSelected: {
      borderColor: c.primary,
      backgroundColor: c.primary + '14',
    },
    affRowDisabled: {
      opacity: 0.55,
    },
    affHeaderText: {
      flex: 1,
    },
    // Service chips (PTT / Video / Data). Unsupported services stay visible but
    // muted and dashed, so a group's capabilities read at a glance.
    affSvcRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 10,
      marginLeft: 36,
    },
    affSvcChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
    },
    affSvcChipOn: {
      borderColor: c.primary,
      backgroundColor: c.primary,
    },
    affSvcChipUnsupported: {
      borderStyle: 'dashed',
      borderColor: c.textMuted,
      backgroundColor: 'transparent',
      opacity: 0.5,
    },
    affSvcChipText: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: c.textSecondary,
    },
    affSvcChipTextOn: {
      color: c.textOnAccent,
    },
    affSvcChipTextUnsupported: {
      color: c.textMuted,
      textDecorationLine: 'line-through',
    },
    // Square check control — deliberately distinct from the round group avatars.
    affCheck: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: c.textMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    affCheckSelected: {
      borderColor: c.primary,
      backgroundColor: c.primary,
    },
    affCheckMark: {
      color: c.textOnAccent,
      fontSize: 13,
      fontWeight: '900',
      lineHeight: 16,
    },
    affRowTextWrap: {
      flex: 1,
    },
    affRowName: {
      color: c.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    affRowId: {
      color: c.textMuted,
      fontSize: 11,
      marginTop: 1,
    },
    affDiffRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
      minHeight: 22,
    },
    affDiffChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 9,
    },
    affDiffChipAdd: {
      backgroundColor: c.success + '22',
    },
    affDiffChipRemove: {
      backgroundColor: c.error + '22',
    },
    // Service-only change: group stays affiliated, its service set differs.
    affDiffChipChange: {
      backgroundColor: c.warn + '22',
    },
    affDiffChipTextChange: {
      color: c.warn,
      fontSize: 11,
      fontWeight: '800',
    },
    affDiffChipTextAdd: {
      color: c.success,
      fontSize: 11,
      fontWeight: '800',
    },
    affDiffChipTextRemove: {
      color: c.error,
      fontSize: 11,
      fontWeight: '800',
    },
    affDiffNone: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    // Footer actions reuse the actionButton proportions from the call controls.
    affFooter: {
      flexDirection: 'row',
      gap: 12,
    },
    affFooterButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
    },
    affCancelButton: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    affApplyButton: {
      backgroundColor: c.primary,
    },
    affApplyButtonDisabled: {
      opacity: 0.4,
    },
    affCancelText: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '700',
    },
    affApplyText: {
      color: c.textOnAccent,
      fontSize: 14,
      fontWeight: '800',
    },
  });
}
