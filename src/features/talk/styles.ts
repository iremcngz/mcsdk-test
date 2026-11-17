import { Dimensions, StyleSheet } from 'react-native';
import type { ThemePalette } from '../../core/theme';

/**
 * The PTT button's size, from the window's width.
 *
 * It used to be a flat 230 dp with a 266 dp ring around it, which is a different
 * share of the screen on every phone: 411 dp wide (Galaxy A20) gave it 66% of the
 * width, while 360 dp (Galaxy S25) gave it 75% and the ring overlapped the buttons
 * under it. Taking a share of the width instead makes it the same size relative to
 * the screen everywhere.
 *
 * The share is the A20's, so that phone looks as it did; the clamp keeps it sensible
 * on a small phone and from filling a tablet.
 */
const PTT_WIDTH_SHARE = 0.56;
const PTT_MIN = 150;
const PTT_MAX = 230;

/** The ring sits outside the button; the wrapper has to hold the ring. */
const RING_RATIO = 266 / 230;

/**
 * The most the ring is ever scaled to while a call is up.
 *
 * TalkScreen animates it by `pulseAnim * 1.05`, and pulseAnim peaks at 1.03 (1.025
 * idle, 1.03 while talking), so the drawn ring is up to 8.2% wider than its own box.
 * A transform does not grow the layout, so the wrapper has to leave room for it or
 * the ring is painted over whatever sits below — which is what overlapped the
 * buttons under the PTT on the narrow phone once the call went active.
 */
export const PTT_RING_PEAK_SCALE = 1.05 * 1.03;

/**
 * The ring's glow, which is drawn outside its border and outside its layout box.
 *
 * TalkScreen gives the active and talking rings `shadowRadius: 20` with a zero
 * offset, so the glow reaches about that far past the border on every side. It is
 * faint at the edge but plainly visible against the dark card, and it is what still
 * crossed the Receive button after the wrapper had been sized for the pulse.
 */
const RING_GLOW = 20;

/**
 * The card's vertical room for the PTT block, as a share of the window's height.
 *
 * Width alone is not enough. Measured on the S25 (360 x 780 dp) the card leaves about
 * 235 dp between the Video row and the Receive button once the group name, the mode
 * buttons and End Call have taken theirs — but 56% of its width came to a 234 dp ring
 * that reaches 253 dp at the peak of the pulse, so the ring crossed the Receive button
 * however much the wrapper was grown. The wrapper could not fix it: centerBody is
 * `flex: 1` and centres its content, so every dp added to the wrapper is split evenly
 * above and below and the ring keeps reaching down.
 *
 * 25% of the height leaves the ring clear of the Receive button with room to spare on
 * both handsets. 30% was the measured budget exactly, which still read as too big on
 * the S25 — the budget is what fits, not what looks right, and the glow needs air
 * around it. Below about 23% the narrow phone hits the PTT_MIN floor instead, which
 * would make the button small without making it any tidier.
 */
const PTT_HEIGHT_SHARE = 0.25;

/**
 * How far the system font-size setting may grow the text inside a fixed-size box.
 *
 * The PTT circle, the mode pills and the action buttons are sized from the screen,
 * not from their text, and the Talk root is a plain View that does not scroll — so
 * text that outgrows its box is painted over whatever is next to it. Samsung's
 * "Huge" setting is about 1.3x; 1.2x still fits the longest status label on the
 * smallest button (PTT_MIN) in two lines, which is as far as these labels may wrap.
 */
export const TALK_MAX_FONT_SCALE = 1.2;

export function pttSizes(width: number, height = width * 2) {
  // The ring, not the button, is what has to fit: it is what overlapped.
  const fromWidth = width * PTT_WIDTH_SHARE;
  const fromHeight = (height * PTT_HEIGHT_SHARE) / (RING_RATIO * PTT_RING_PEAK_SCALE);
  const button = Math.round(
    Math.min(PTT_MAX, Math.max(PTT_MIN, Math.min(fromWidth, fromHeight))),
  );
  const ring = Math.round(button * RING_RATIO);
  return {
    button,
    ring,
    // Room for the ring at the peak of the pulse AND for its glow beyond that. Sized
    // from the ring rather than the button: the old 270/230 left 4 dp around a 266 dp
    // ring, which the pulse alone overran by ~18 dp.
    wrapper: Math.ceil(ring * PTT_RING_PEAK_SCALE) + RING_GLOW * 2,
  };
}

export function makeTalkStyles(
  c: ThemePalette,
  windowWidth = Dimensions.get('window').width,
  windowHeight = Dimensions.get('window').height,
) {
  const ptt = pttSizes(windowWidth, windowHeight);
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
      width: ptt.wrapper,
      height: ptt.wrapper,
      alignSelf: 'center',
      justifyContent: 'center',
      alignItems: 'center',
      // The wrapper now holds the pulse and the glow, and its slack is split above and
      // below because the ring is centred: that is the clearance. This is only the
      // gap between the two, so it stays small — the narrow phone is 780 dp tall
      // against the other's 891 and still needs End Call and the tab bar below.
      marginBottom: 6,
    },
    // Dış yükleme ve durum halkası
    pushButtonRing: {
      position: 'absolute',
      width: ptt.ring,
      height: ptt.ring,
      borderRadius: ptt.ring / 2,
      // Scaled too: a flat 6.5 reads as a heavier ring on a narrower phone.
      borderWidth: Math.max(4, Math.round(ptt.ring * 6.5 / 266)),
      borderColor: c.accent,
      opacity: 0.8,
    },
    pushButton: {
      width: ptt.button,
      height: ptt.button,
      alignSelf: 'center',
      borderRadius: ptt.button / 2,
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
    // Right after the group name; the auto margin keeps the actions on the right.
    mutedIcon: {
      fontSize: 16,
      marginLeft: 6,
      marginRight: 'auto',
    },
    // Under the PTT button, out of the layout so it never moves the button.
    // The floor notice ("Denied: someone else is talking", "Talk time limit
    // reached", a failed call setup — floorNoticeText), shown INSIDE the PTT button
    // in place of its status label for as long as it lasts (FLOOR_NOTICE_MS).
    //
    // It used to be absolute at top:'100%' of the wrapper, i.e. in the gap below the
    // button. That gap is whatever centerBody has left over, halved — and on a short
    // screen it is nothing, so the text was painted over the mode buttons. The
    // button is the one box pttSizes guarantees to fit every screen, so a notice
    // drawn inside it can overlap nothing, on any device, and nothing outside the
    // button moves when it appears or goes.
    floorNotice: {
      color: c.warn,
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
      // Keeps the two lines inside the circle's chord at the label's height.
      paddingHorizontal: Math.round(ptt.button * 0.1),
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

    // Under the group's name: opens the transmit view. alignSelf keeps the button at
    // its own width, since a stretched row would make it as wide as the card.
    videoStartRow: {
      flexDirection: 'row',
      alignItems: 'center',
      // Video at the left under the group's name, Receive at the right under the menu.
      justifyContent: 'space-between',
      marginTop: 2,
      marginBottom: 10,
    },
    videoStartButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: c.primary + '55',
      backgroundColor: c.primary + '14',
    },
    videoStartIcon: {
      fontSize: 12,
    },
    videoStartText: {
      color: c.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    // The receive side of that row: same size, the accent colour instead, so sending
    // and watching do not read as the same action.
    videoReceiveButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: c.accent + '55',
      backgroundColor: c.accent + '14',
    },
    videoReceiveText: {
      color: c.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    videoReceiveCount: {
      color: c.textOnAccent,
      backgroundColor: c.accent,
      fontSize: 10,
      fontWeight: '800',
      minWidth: 16,
      textAlign: 'center',
      borderRadius: 8,
      paddingHorizontal: 4,
      paddingVertical: 1,
      overflow: 'hidden',
    },

    // The Receive picker's rows, in the shared bottom sheet above.
    watchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      marginTop: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    watchRowName: {
      flex: 1,
      color: c.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    watchRowId: {
      color: c.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    watchEmpty: {
      color: c.textMuted,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
      paddingVertical: 24,
    },
    watchRowBadge: {
      color: c.primary,
      fontSize: 11,
      fontWeight: '700',
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
