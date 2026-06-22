/**
 * features/talk/TalkScreen.tsx
 *
 * Lightweight mock talk screen for the new Talk bottom tab.
 * This screen is intentionally UI-first: it renders a horizontal
 * group selector, a push-to-talk action area, receive/transmit/messages
 * controls, and simple start/end call buttons.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PermissionsAndroid,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import { useAppContext } from '../../contexts/AppContext';
import { useTalkContext, PushState } from '../../contexts/TalkContext';
import { mapSoundLevel, useVoiceBars, VoiceMeterBars } from '../../shared/VoiceMeter';
import { makeTalkStyles } from './styles';
import { GroupActionMenu } from './components/GroupActionMenu';
import { TalkMockPanel } from './components/TalkMockPanel';
import { GroupSelector } from './components/GroupSelector';
import { MessagesScreen } from './MessagesScreen';
import { BroadcastScreen } from './BroadcastScreen';

const GROUPS = ['group1', 'group2', 'group3', 'group4', 'group5', 'group6', 'group7'];
const DATA_GROUPS = new Set(['group3', 'group5', 'group6', 'group7']);

// ── Mock timings ───────────────────────────────────────────────────────────
// Artificial delays that stand in for real SDK round-trips while the native
// bridge doesn't yet expose call/floor callbacks. When real callbacks land,
// these spinners should be driven by SDK events instead of fixed timeouts.
const MOCK_CALL_SETUP_MS  = 600;  // "starting call" spinner before it goes active
const MOCK_FLOOR_GRANT_MS = 500;  // "requesting floor" spinner before push is granted
const MOCK_AUTO_ACCEPT_MS = 3000; // incoming call auto-answers after this delay

type TalkMode = 'receive' | 'transmit' | 'messages';

export function TalkScreen() {
  const { c, tr, theme } = useAppContext();
  const { setActiveGroups, pendingGroup, setPendingGroup, groupCalls, setGroupCalls, activationOrder, lastClosedAt, recordActivation, recordClose, isBroadcasting, setIsBroadcasting } = useTalkContext();
  const styles = useMemo(() => makeTalkStyles(c), [c]);

  const initialGroup = pendingGroup ?? GROUPS[0];
  const initialGroupState = groupCalls[initialGroup];
  const [selectedGroup, setSelectedGroup] = useState(initialGroup);
  const [mode, setMode] = useState<TalkMode>('receive');
  const [callActive, setCallActive] = useState(initialGroupState?.callActive ?? false);
  const [pushState, setPushState] = useState(initialGroupState?.pushState ?? 'idle');
  const [isHolding, setIsHolding] = useState(initialGroupState?.isHolding ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [occupiedSpeaker, setOccupiedSpeaker] = useState('Another user');
  const [soundMonitoring, setSoundMonitoring] = useState(false);
  const [showMockPanel, setShowMockPanel] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [muted, setMuted] = useState(false);
  const isFirstRender = useRef(true);
  const prevCallActive = useRef(callActive);
  const [messagesGroup, setMessagesGroup] = useState<string | null>(null);
  const [incomingCalls, setIncomingCalls] = useState<Set<string>>(new Set());

  const orderedGroups = useMemo(() => {
    const activeSet = new Set(GROUPS.filter(g => groupCalls[g]?.callActive));
    const everActive = activationOrder.filter(g => GROUPS.includes(g));
    const activeSorted = everActive.filter(g => activeSet.has(g)).reverse();
    const inactiveSorted = everActive.filter(g => !activeSet.has(g))
      .sort((a, b) => (lastClosedAt[b] ?? 0) - (lastClosedAt[a] ?? 0));
    const neverActive = GROUPS.filter(g => !everActive.includes(g));
    return [...activeSorted, ...inactiveSorted, ...neverActive];
  }, [groupCalls, activationOrder, lastClosedAt]);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const incomingPulse = useRef(new Animated.Value(1)).current;
  const contentFade = useRef(new Animated.Value(1)).current;
  const contentSlide = useRef(new Animated.Value(0)).current;
  const prevSelectedRef = useRef(selectedGroup);
  const soundActiveRef = useRef(false);

  const barAnims = useVoiceBars(voiceLevel);

  const talking = isHolding && callActive && pushState === 'accepted';
  const buttonDisabled = pushState === 'occupied' || isLoading;

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

  // Save current group state on every change (skip initial mount to not overwrite persisted state)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setGroupCalls(prev => ({
      ...prev,
      [selectedGroup]: { callActive, pushState, isHolding },
    }));
  }, [callActive, pushState, isHolding, selectedGroup]);

  // Track activation: record when a group becomes active
  useEffect(() => {
    if (callActive) {
      recordActivation(selectedGroup);
    }
  }, [callActive, selectedGroup, recordActivation]);

  // Track close: record when a group's call transitions from active → inactive
  useEffect(() => {
    if (prevCallActive.current && !callActive) {
      recordClose(selectedGroup);
    }
    prevCallActive.current = callActive;
  }, [callActive, selectedGroup, recordClose]);

  // Sync active groups to TalkContext for the header badge
  useEffect(() => {
    const active = Object.entries(groupCalls)
      .filter(([, v]) => v.callActive)
      .map(([k]) => ({ name: k, callActive: true }));
    setActiveGroups(active);
  }, [groupCalls, setActiveGroups]);

  // Navigate to pending group when TalkScreen mounts
  useEffect(() => {
    if (pendingGroup) {
      handleSelectGroup(pendingGroup);
      setPendingGroup(null);
    }
  }, [pendingGroup]);

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
    if (gs?.callActive) {
      setCallActive(true);
      setPushState(gs.pushState);
      setIsHolding(gs.isHolding);
      setIsLoading(false);
    } else if (gs) {
      setCallActive(gs.callActive);
      setPushState(gs.pushState);
      setIsHolding(gs.isHolding);
      setIsLoading(false);
    } else {
      setCallActive(false);
      setPushState('idle');
      setIsHolding(false);
      setIsLoading(false);
    }
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

  const startSoundMonitoring = async () => {
    if (soundMonitoring) return;
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
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
        groupCalls={groupCalls}
        selectedGroup={selectedGroup}
        incomingCalls={incomingCalls}
        incomingPulse={incomingPulse}
        onSelectGroup={handleSelectGroup}
      />

      <View style={styles.centerCard}>
        <Animated.View style={{ opacity: contentFade, transform: [{ translateY: contentSlide }], flex: 1 }}>
        <View style={styles.selectedRow}>
          <Text style={styles.selectedLabel} testID="talk-selected-group">
            {selectedGroup}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
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
            onToggleMute={() => setMuted(prev => !prev)}
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
                  if (!callActive) {
                    setIsLoading(true);
                    setTimeout(() => {
                      setCallActive(true);
                      setPushState('idle');
                      setIsHolding(false);
                      setIsLoading(false);
                    }, MOCK_CALL_SETUP_MS);
                    return;
                  }
                  if (pushState === 'idle') {
                    setIsLoading(true);
                    setTimeout(() => {
                      setPushState('accepted');
                      setIsHolding(true);
                      startSoundMonitoring();
                      setIsLoading(false);
                    }, MOCK_FLOOR_GRANT_MS);
                    return;
                  }
                  setIsHolding(true);
                  startSoundMonitoring();
                }}
                onPressOut={() => {
                  if (isHolding) {
                    setIsHolding(false);
                    stopSoundMonitoring();
                  }
                }}
                disabled={buttonDisabled}
                style={[
                  styles.pushButton,
                  { backgroundColor: pushButtonColor },
                  buttonDisabled && styles.pushButtonDisabled,
                ]}>
                {pushState === 'occupied' && <Text style={styles.buttonSpeakerName}>{occupiedSpeaker}</Text>}
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
          </View>

        </View>

        <View style={{ marginTop: 'auto' }}>

          <View style={[styles.modeRow, !callActive && styles.modeRowHidden]}>
            {(['receive', 'transmit', 'messages'] as TalkMode[]).filter(
              v => v !== 'messages' || DATA_GROUPS.has(selectedGroup)
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
                onPress={() => {
                  setIsLoading(true);
                  setTimeout(() => {
                    setCallActive(true);
                    setPushState('idle');
                    setIsHolding(false);
                    setIsLoading(false);
                  }, MOCK_CALL_SETUP_MS);
                }}
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
