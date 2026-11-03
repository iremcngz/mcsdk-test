/**
 * features/talk/TalkScreen.tsx
 *
 * The Talk tab: a horizontal group selector, a push-to-talk action area,
 * receive/transmit/messages controls, and start/end call buttons.
 *
 * A group's call is the SDK's (TalkContext.sdkGroupCalls) whenever it has one:
 * Start places it, PTT asks for the floor and letting go gives it back, End
 * leaves it, and every state shown comes from the SDK's callbacks. Without an
 * SDK call the group shows the mock panel's simulated state, kept per group
 * in groupCalls, so the UI can still be exercised offline.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import { ensureMicPermission } from '../../core/permissions';
import { MediaSession } from '../../core/mediaSession';
import { useAppContext } from '../../contexts/AppContext';
import { useTalkContext, PushState, type GroupCallState, type SdkGroupCall } from '../../contexts/TalkContext';
import { displayMcId } from '../calls/mcId';
import { floorNoticeText, useTransientText } from '../calls/floorText';
import { mapSoundLevel, useVoiceBars, VoiceMeterBars } from '../../shared/VoiceMeter';
import { makeTalkStyles } from './styles';
import { GroupActionMenu } from './components/GroupActionMenu';
import { TalkMockPanel } from './components/TalkMockPanel';
import { GroupSelector } from './components/GroupSelector';
import { AffiliationEditor } from './components/AffiliationEditor';
import { MessagesScreen } from './MessagesScreen';
import { BroadcastScreen } from './BroadcastScreen';


// A simulated incoming call (mock panel) auto-answers after this delay. Real
// group calls need no such thing: the SDK answers them itself.
const MOCK_AUTO_ACCEPT_MS = 3000;

type TalkMode = 'receive' | 'transmit' | 'messages';

/**
 * The PTT button's state for an SDK group call. The floor is shown as ours
 * only while PTT is held: on letting go the release is sent at once, so the
 * button returns to "active" without waiting for the server's IDLE.
 */
function pushStateOf(call: SdkGroupCall, holding: boolean): PushState {
  if (call.floorState === 'busy') return 'occupied';
  if (call.floorState === 'granted' && holding) return 'accepted';
  return 'idle';
}

/** An SDK group call in the shape the group selector and ordering read. */
function viewOf(call: SdkGroupCall, holding: boolean): GroupCallState {
  return { callActive: call.state === 'active', pushState: pushStateOf(call, holding), isHolding: holding };
}

/** Who holds the floor, for the PTT button: every talker in a multi-talker group. */
function talkerNames(call: SdkGroupCall): string {
  const ids = call.talkers.length ? call.talkers : call.floorOwner ? [call.floorOwner] : [];
  return ids.map(displayMcId).join(', ');
}

export function TalkScreen() {
  const { c, tr, theme } = useAppContext();
  const { affiliatedGroups, affiliationByGroup, applyAffiliation, groups: allGroups, groupsLoaded, setActiveGroups, pendingGroup, setPendingGroup, groupCalls, setGroupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, sdkGroupCalls, startGroupCall, endGroupCall, requestGroupFloor, releaseGroupFloor, setFocusedGroup, mutedGroups, toggleGroupMuted, isBroadcasting, setIsBroadcasting } = useTalkContext();
  const styles = useMemo(() => makeTalkStyles(c), [c]);

  // Only affiliated groups are selectable/listed; the rest live in the editor.
  const GROUPS = useMemo(() => affiliatedGroups.map(g => g.groupId), [affiliatedGroups]);
  // Names come from the full provisioned list, which also covers groups that are
  // not affiliated (so the editor can label them too).
  const groupLabels = useMemo(
    () => Object.fromEntries(allGroups.map(g => [g.groupId, g.name || g.groupId])),
    [allGroups],
  );
  // Mode availability follows the group's own capabilities (onGroupsUpdated),
  // not what the current affiliation happens to cover (onAffiliationsUpdated).
  // The two differ — a group can support MCVideo while the affiliation was only
  // established for MCPTT — and the editor shows the supported set, so keying
  // off anything else makes the chips and the buttons disagree.
  /** Groups that support MCData — these get the Messages mode. */
  const dataGroups = useMemo(
    () => new Set(allGroups.filter(g => g.isData).map(g => g.groupId)),
    [allGroups],
  );
  /** Groups that support MCVideo — these get Receive / Transmit. */
  const videoGroups = useMemo(
    () => new Set(allGroups.filter(g => g.isVideo).map(g => g.groupId)),
    [allGroups],
  );

  const initialGroup = pendingGroup ?? GROUPS[0] ?? '';
  const initialGroupState = groupCalls[initialGroup];
  const [selectedGroup, setSelectedGroup] = useState(initialGroup);
  const [mode, setMode] = useState<TalkMode>('receive');
  // The mock panel's simulated call for the selected group; see the header.
  const [mockCallActive, setCallActive] = useState(initialGroupState?.callActive ?? false);
  const [mockPushState, setPushState] = useState(initialGroupState?.pushState ?? 'idle');
  const [isHolding, setIsHolding] = useState(initialGroupState?.isHolding ?? false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [occupiedSpeaker, setOccupiedSpeaker] = useState('Another user');
  const [soundMonitoring, setSoundMonitoring] = useState(false);
  const [showMockPanel, setShowMockPanel] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showAffEditor, setShowAffEditor] = useState(false);
  const isFirstRender = useRef(true);
  const [messagesGroup, setMessagesGroup] = useState<string | null>(null);
  const [incomingCalls, setIncomingCalls] = useState<Set<string>>(new Set());
  const [startFailedText, setStartFailedText] = useState<string | undefined>(undefined);

  // ── What the selected group shows ──────────────────────────────────────────
  const sdkCall: SdkGroupCall | undefined = sdkGroupCalls[selectedGroup];
  const groupMuted = !!mutedGroups[selectedGroup];

  // The group shown is the one heard, when its call is up.
  useEffect(() => { setFocusedGroup(selectedGroup); }, [selectedGroup, setFocusedGroup]);
  const callActive = sdkCall ? sdkCall.state === 'active' : mockCallActive;
  const pushState: PushState = sdkCall ? pushStateOf(sdkCall, isHolding) : mockPushState;
  // Setting the call up, or waiting for the floor while PTT is held.
  const isLoading = sdkCall
    ? sdkCall.state !== 'active'
      || (isHolding && (sdkCall.floorState === 'requesting' || sdkCall.floorState === 'queued'))
    : false;
  const occupiedName = sdkCall ? talkerNames(sdkCall) : occupiedSpeaker;
  const floorNotice = useTransientText(floorNoticeText(tr, sdkCall?.floorNotice) ?? startFailedText);

  /** Every group's call as shown: the SDK's where it has one, the mock's elsewhere. */
  const viewCalls = useMemo(() => {
    const view: Record<string, GroupCallState> = { ...groupCalls };
    Object.values(sdkGroupCalls).forEach(call => {
      view[call.groupId] = viewOf(call, call.groupId === selectedGroup && isHolding);
    });
    return view;
  }, [groupCalls, sdkGroupCalls, selectedGroup, isHolding]);

  const orderedGroups = useMemo(() => {
    const activeSet = new Set(GROUPS.filter(g => viewCalls[g]?.callActive));
    const everActive = activationOrder.filter(g => GROUPS.includes(g));
    const activeSorted = everActive.filter(g => activeSet.has(g)).reverse();
    const inactiveSorted = everActive.filter(g => !activeSet.has(g))
      .sort((a, b) => (lastClosedAt[b] ?? 0) - (lastClosedAt[a] ?? 0));
    const neverActive = GROUPS.filter(g => !everActive.includes(g));
    return [...activeSorted, ...inactiveSorted, ...neverActive];
  }, [GROUPS, viewCalls, activationOrder, lastClosedAt]);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const incomingPulse = useRef(new Animated.Value(1)).current;
  const contentFade = useRef(new Animated.Value(1)).current;
  const contentSlide = useRef(new Animated.Value(0)).current;
  const prevSelectedRef = useRef(selectedGroup);
  const soundActiveRef = useRef(false);

  const barAnims = useVoiceBars(voiceLevel);

  const talking = isHolding && callActive && pushState === 'accepted';
  // Not while waiting for the floor: letting go then withdraws the request.
  const buttonDisabled = pushState === 'occupied' || (isLoading && !isHolding);

  const pushButtonState = pushState === 'occupied'
    ? 'occupied'
    : talking
      ? 'accepted'
      : pushState === 'accepted'
        ? (isHolding ? 'accepted' : 'active')
        : callActive
          ? 'active'
          : 'idle';

  const isDark = theme === 'dark';
  const pushButtonColor = callActive 
  ? (pushState === 'occupied' ? c.surface : (isDark ? c.bg : c.inputBg))
  : c.textMuted;

// 2. Dışarıdaki ince halkanın (Ring) rengini duruma göre yönetelim
const ringColor = pushState === 'occupied'
  ? c.error     // Meşgulse kırmızı halka
  : talking
    ? c.success // Konuşuyorsa yeşil halka
    : callActive
      ? c.accent  // Boşta ve aktifse mavi/accent halka
      : c.border; // Çağrı yoksa gri halka

  const pushStatusLabel = talking
    ? tr.talkStatusTalking
    : pushState === 'accepted'
      ? tr.talkStatusAccepted
      : pushState === 'occupied'
        ? tr.talkStatusOccupied
        : callActive
          ? tr.talkStatusActive
          : '';

  const buttonLabel = talking ? tr.talkButtonHold : tr.talkButton;
  const localSpeakerName = 'mcuser-222';
  const currentSpeakerName = pushState === 'occupied' ? occupiedSpeaker : localSpeakerName;
  const buttonStatusLabel = pushStatusLabel;
  const buttonHint = callActive ? tr.talkHoldHint : tr.talkNoCallHint;

  // Save the mock state on every change (skip initial mount to not overwrite
  // persisted state). Only the mock's: an SDK call's state lives in TalkContext.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setGroupCalls(prev => ({
      ...prev,
      [selectedGroup]: { callActive: mockCallActive, pushState: mockPushState, isHolding },
    }));
  }, [mockCallActive, mockPushState, isHolding, selectedGroup]);

  // Record each group's call going up and down — any group, since an SDK call
  // comes up on its own, selected or not.
  const activeRef = useRef(new Set<string>());
  useEffect(() => {
    const active = new Set(Object.keys(viewCalls).filter(g => viewCalls[g].callActive));
    active.forEach(g => { if (!activeRef.current.has(g)) recordActivation(g); });
    activeRef.current.forEach(g => { if (!active.has(g)) recordClose(g); });
    activeRef.current = active;
  }, [viewCalls, recordActivation, recordClose]);

  // Sync active groups to TalkContext for the header badge
  useEffect(() => {
    const active = Object.entries(viewCalls)
      .filter(([, v]) => v.callActive)
      .map(([k]) => ({ name: k, callActive: true }));
    setActiveGroups(active);
  }, [viewCalls, setActiveGroups]);

  // A call we started that went away before it came up was refused — by the
  // SDK, or by the server. Said once; the next Start clears it.
  const prevSdkCallRef = useRef(sdkCall);
  useEffect(() => {
    const prev = prevSdkCallRef.current;
    prevSdkCallRef.current = sdkCall;
    if (prev && !sdkCall && prev.groupId === selectedGroup
        && prev.startedBy === 'me' && prev.state !== 'active') {
      setStartFailedText(tr.talkCallStartFailed);
    }
  }, [sdkCall, selectedGroup, tr]);

  // The floor can turn busy while PTT is held (a deny, then someone else
  // takes it); the button goes passive, so the hold ends here.
  useEffect(() => {
    if (sdkCall && pushState === 'occupied' && isHolding) {
      setIsHolding(false);
      releaseGroupFloor(selectedGroup);
    }
  }, [sdkCall, pushState, isHolding, selectedGroup, releaseGroupFloor]);

  // The level meter follows talking, whichever way it was granted.
  useEffect(() => {
    if (talking) startSoundMonitoring();
    else stopSoundMonitoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talking]);

  // Navigate to pending group when TalkScreen mounts
  useEffect(() => {
    if (pendingGroup) {
      handleSelectGroup(pendingGroup);
      setPendingGroup(null);
    }
  }, [pendingGroup]);

  // Keep the selection valid: deaffiliating the selected group (or the first
  // group set arriving from the SDK) has to move the selection somewhere real.
  // handleSelectGroup is recreated every render, so it stays out of the deps
  // (including it would re-run this on every render).
  useEffect(() => {
    if (GROUPS.length === 0) return;
    if (!GROUPS.includes(selectedGroup)) {
      handleSelectGroup(GROUPS[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [GROUPS, selectedGroup]);

  // Slide + fade animation when switching between groups
  useEffect(() => {
    if (prevSelectedRef.current !== selectedGroup) {
      prevSelectedRef.current = selectedGroup;
      contentFade.setValue(0);
      contentSlide.setValue(15);
      Animated.parallel([
        Animated.timing(contentFade, {
          toValue: 1,
          duration: 350,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(contentSlide, {
          toValue: 0,
          duration: 350,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [selectedGroup, contentFade, contentSlide]);

  // Auto-accept incoming calls after 3 seconds (simulates SDK call establishment)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    incomingCalls.forEach(group => {
      if (!groupCalls[group]?.callActive) {
        const timer = setTimeout(() => {
          if (group === selectedGroup) {
            setCallActive(true);
            setPushState('idle');
            setIsHolding(false);
          }
          setGroupCalls(prev => ({
            ...prev,
            [group]: { callActive: true, pushState: 'idle', isHolding: false },
          }));
        }, MOCK_AUTO_ACCEPT_MS);
        timers.push(timer);
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [incomingCalls]);

  const handleSelectGroup = (group: string) => {
    const gs = groupCalls[group];
    setSelectedGroup(group);
    setStartFailedText(undefined);
    setCallActive(gs?.callActive ?? false);
    setPushState(gs?.pushState ?? 'idle');
    setIsHolding(gs?.isHolding ?? false);
  };

  useEffect(() => {
    if (!soundMonitoring) {
      setVoiceLevel(0);
      return;
    }

    const handleSound = (data: { value: number }) => {
      setVoiceLevel(mapSoundLevel(data.value));
    };

    soundActiveRef.current = true;
    SoundLevel.onNewFrame = handleSound;

    return () => {
      SoundLevel.onNewFrame = () => {};
    };
  }, [soundMonitoring]);

  useEffect(() => {
    return () => {
      if (soundActiveRef.current) {
        SoundLevel.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
      return;
    }

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
  }, [isLoading, spinAnim]);

  // Continuous gentle pulse while call is active (blue) or talking (green)
  useEffect(() => {
    if (!callActive) {
      pulseAnim.stopAnimation();
      Animated.spring(pulseAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start();
      return;
    }

    const targetScale = talking ? 1.03 : 1.025;
    const duration = talking ? 700 : 800;
    const basePulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: targetScale, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    basePulse.start();
    return () => basePulse.stop();
  }, [callActive, talking, pulseAnim]);

  useEffect(() => {
    if (incomingCalls.size === 0) {
      incomingPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(incomingPulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(incomingPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [incomingCalls.size, incomingPulse]);

  const startCall = () => {
    setStartFailedText(undefined);
    startGroupCall(selectedGroup);
  };

  const startSoundMonitoring = async () => {
    if (soundMonitoring) return;
    if ((await ensureMicPermission()) !== 'granted') return;
    // One physical microphone: the media pipeline outranks the level meter, so
    // a refusal here means capture would fight it and must not be started.
    if (!(await MediaSession.claimMicForMeter())) return;
    setVoiceLevel(0);
    setSoundMonitoring(true);
    SoundLevel.start();
  };

  const stopSoundMonitoring = () => {
    if (!soundMonitoring) return;
    setSoundMonitoring(false);
    if (soundActiveRef.current) {
      SoundLevel.stop();
    }
    MediaSession.releaseMicForMeter();
    setVoiceLevel(0);
  };

  if (isBroadcasting) {
    return <BroadcastScreen group={selectedGroup} onStop={() => setIsBroadcasting(false)} />;
  }

  if (messagesGroup) {
    return <MessagesScreen group={messagesGroup} onClose={() => setMessagesGroup(null)} />;
  }

  return (
    <View style={styles.root}>
      <GroupSelector
        styles={styles}
        c={c}
        orderedGroups={orderedGroups}
        groupLabels={groupLabels}
        groupCalls={viewCalls}
        selectedGroup={selectedGroup}
        incomingCalls={incomingCalls}
        incomingPulse={incomingPulse}
        onSelectGroup={handleSelectGroup}
        onEditAffiliation={() => setShowAffEditor(true)}
        editLabel={tr.talkAffEdit}
        emptyLabel={groupsLoaded ? tr.talkAffNoneAffiliated : tr.talkAffNotRegistered}
      />

      <View style={styles.centerCard}>
        <Animated.View style={{ opacity: contentFade, transform: [{ translateY: contentSlide }], flex: 1 }}>
        <View style={styles.selectedRow}>
          <Text
            style={styles.selectedLabel}
            numberOfLines={1}
            ellipsizeMode="tail"
            testID="talk-selected-group">
            {selectedGroup}
          </Text>
          {groupMuted && (
            <Text style={styles.mutedIcon} accessibilityLabel={tr.talkGroupMutedHint} testID="talk-group-muted">
              🔇
            </Text>
          )}
          <View style={styles.selectedActions}>
            <TouchableOpacity
              onPress={() => setShowMockPanel(!showMockPanel)}
              activeOpacity={0.8}
              style={[styles.menuToggleButton, { borderColor: c.warn + '44', backgroundColor: c.warn + '0a' }]}
              testID="talk-mock-toggle">
              <Text style={[styles.menuToggleIcon, { fontSize: 14 }]}>
                ⚙️
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowGroupMenu(!showGroupMenu)}
              activeOpacity={0.8}
              style={styles.menuToggleButton}
              testID="talk-group-menu-toggle">
              <Text style={styles.menuToggleIcon}>
                {showGroupMenu ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {showGroupMenu && (
          <GroupActionMenu
            styles={styles}
            tr={tr}
            onClose={() => setShowGroupMenu(false)}
            muted={groupMuted}
            onToggleMute={() => toggleGroupMuted(selectedGroup)}
          />
        )}

        <View style={styles.centerBody}>
          <View style={styles.pushButtonWrapper}>
            {isLoading ? (
              <Animated.View
                style={[
                  styles.pushButtonRing,
                  {
                    borderColor: c.border,
                    borderTopColor: c.primary,
                    borderRightColor: c.primary,
                    borderWidth: 4,
                    opacity: 1,
                    shadowColor: c.primary,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                    elevation: 6,
                    transform: [
                      {
                        rotate: spinAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ) : talking ? (
              <Animated.View style={[styles.pushButtonRing, {
                borderColor: c.success,
                shadowColor: c.success,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.8,
                shadowRadius: 20,
                elevation: 12,
                transform: [{ scale: Animated.multiply(pulseAnim, 1.05) }],
              }]} />
            ) : callActive ? (
              <Animated.View style={[styles.pushButtonRing, {
                borderColor: c.primary,
                shadowColor: c.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.8,
                shadowRadius: 20,
                elevation: 12,
                transform: [{ scale: Animated.multiply(pulseAnim, 1.05) }],
              }]} />
            ) : (
              <View style={[styles.pushButtonRing, { borderColor: c.border, opacity: 0.5 }]} />
            )}
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Pressable
                testID="talk-push-button"
                onPressIn={() => {
                  if (pushState === 'occupied') return;
                  // No call yet: this press starts one. MCPTT group calls ask
                  // for no floor on setup, so talking takes another press.
                  if (!callActive) {
                    if (!sdkCall) startCall();
                    return;
                  }
                  setIsHolding(true);
                  if (sdkCall) requestGroupFloor(selectedGroup);
                }}
                onPressOut={() => {
                  if (!isHolding) return;
                  setIsHolding(false);
                  if (sdkCall) releaseGroupFloor(selectedGroup);
                }}
                disabled={buttonDisabled}
                style={[
                  styles.pushButton,
                  { backgroundColor: pushButtonColor },
                  buttonDisabled && styles.pushButtonDisabled,
                ]}>
                {pushState === 'occupied' && !!occupiedName && <Text style={styles.buttonSpeakerName} testID="talk-speaker-name">{occupiedName}</Text>}
                <View style={styles.voiceMeterContainer}>
                  <VoiceMeterBars
                    barAnims={barAnims}
                    barStyle={styles.voiceBar}
                    heightScale={36}
                    inactiveColor={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}
                    inactiveOpacity={0.25}
                  />
                </View>
                <Text testID="talk-status-text" style={[styles.pushButtonStatus, { color: c.textOnAccent }]}>{buttonStatusLabel}</Text>
              </Pressable>
            </Animated.View>
            {/* Absolute, under the button, so a notice never moves the button. */}
            {!!floorNotice && (
              <Text style={styles.floorNotice} numberOfLines={2} testID="talk-floor-notice">
                {floorNotice}
              </Text>
            )}
          </View>

        </View>

        <View style={{ marginTop: 'auto' }}>

          <View style={[styles.modeRow, !callActive && styles.modeRowHidden]}>
            {/* Each mode needs the matching MC service: video for the
                receive/transmit pair, data for messages. */}
            {(['receive', 'transmit', 'messages'] as TalkMode[]).filter(
              v => v === 'messages'
                ? dataGroups.has(selectedGroup)
                : videoGroups.has(selectedGroup)
            ).map(value => {
              const isActive = mode === value;
              const icon = value === 'transmit' ? '📹'
                : value === 'receive' ? '📺'
                : '💬';
              const label = value === 'receive' ? tr.talkModeReceive
                : value === 'transmit' ? tr.talkModeTransmit
                : tr.talkModeMessages;
              const isReceiveActive = value === 'receive' && isActive;
              return (
                <TouchableOpacity
                  key={value}
                  testID={`talk-mode-${value}`}
                  disabled={!callActive}
                  onPress={() => {
                    if (value === 'transmit') {
                      setIsBroadcasting(true);
                      return;
                    }
                    if (value === 'messages') {
                      setMessagesGroup(selectedGroup);
                      return;
                    }
                    setMode(value);
                  }}
                  activeOpacity={0.8}
                  style={[
                    styles.modePill,
                    isActive && (isReceiveActive ? styles.modePillActiveReceive : styles.modePillActive),
                  ]}>
                  <View style={styles.modePillContent}>
                    <Text style={[styles.modeIcon, isActive && styles.modeTextActive]}>{icon}</Text>
                    <Text style={[
                      styles.modeText,
                      isActive && styles.modeTextActive,
                    ]}>{label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            {!callActive && (
              <TouchableOpacity
                testID="talk-start-button"
                onPress={startCall}
                disabled={isLoading}
                activeOpacity={0.8}
                style={[styles.actionButton, styles.startButton]}>
                <Text style={styles.actionButtonIcon}>📞</Text>
                <Text style={styles.actionButtonText}>{tr.talkBtnStartCall}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              testID="talk-end-button"
              disabled={!callActive}
              onPress={() => {
                if (sdkCall) endGroupCall(selectedGroup);
                setCallActive(false);
                setPushState('idle');
                setIsHolding(false);
              }}
              activeOpacity={0.8}
              style={[styles.actionButton, styles.endButton, !callActive && styles.actionButtonDisabled]}>
              <Text style={styles.actionButtonIcon}>📵</Text>
              <Text style={[styles.actionButtonText, !callActive && styles.actionButtonTextDisabled]}>{tr.talkBtnEndCall}</Text>
            </TouchableOpacity>
          </View>
          </View>
        </Animated.View>

        </View>

        {showAffEditor && (
          <AffiliationEditor
            styles={styles}
            tr={tr}
            groups={allGroups}
            affiliationByGroup={affiliationByGroup}
            groupsLoaded={groupsLoaded}
            onClose={() => setShowAffEditor(false)}
            onApply={applyAffiliation}
          />
        )}

        {showMockPanel && (
          <TalkMockPanel
            styles={styles}
            tr={tr}
            orderedGroups={orderedGroups}
            incomingCalls={incomingCalls}
            onClose={() => setShowMockPanel(false)}
            setPushState={setPushState}
            setOccupiedSpeaker={setOccupiedSpeaker}
            setIncomingCalls={setIncomingCalls}
            setCallActive={setCallActive}
            setIsHolding={setIsHolding}
          />
        )}
    </View>
  );
}
