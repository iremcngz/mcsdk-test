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
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import { useAppContext } from '../../contexts/AppContext';
import { makeTalkStyles } from './styles';
import { MessagesScreen } from './MessagesScreen';

const GROUPS = ['group1', 'group2', 'group3', 'group4', 'group5', 'group6', 'group7'];
const DATA_GROUPS = new Set(['group3', 'group5', 'group7']);

type TalkMode = 'receive' | 'transmit' | 'messages';

type PushState = 'idle' | 'accepted' | 'occupied';

interface GroupCallState {
  callActive: boolean;
  pushState: PushState;
  isHolding: boolean;
}

export function TalkScreen() {
  const { c, tr } = useAppContext();
  const styles = useMemo(() => makeTalkStyles(c), [c]);

  const [selectedGroup, setSelectedGroup] = useState(GROUPS[0]);
  const [mode, setMode] = useState<TalkMode>('receive');
  const [callActive, setCallActive] = useState(false);
  const [pushState, setPushState] = useState<PushState>('idle');
  const [isHolding, setIsHolding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [occupiedSpeaker, setOccupiedSpeaker] = useState('Another user');
  const [soundMonitoring, setSoundMonitoring] = useState(false);
  const [showMockPanel, setShowMockPanel] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [muted, setMuted] = useState(false);
  const [messagesGroup, setMessagesGroup] = useState<string | null>(null);
  const [incomingCalls, setIncomingCalls] = useState<Set<string>>(new Set());
  const [orderedGroups, setOrderedGroups] = useState<string[]>(() => [...GROUPS]);
  const [groupCalls, setGroupCalls] = useState<Record<string, GroupCallState>>({});
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const incomingPulse = useRef(new Animated.Value(1)).current;
  const soundActiveRef = useRef(false);

  const BAR_COUNT = 7;
  const BAR_HEIGHTS = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0, 1.0];
  const BAR_COLORS = ['#4ade80', '#4ade80', '#facc15', '#facc15', '#fb923c', '#ef4444', '#ef4444'];
  const barAnims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0))
  ).current;

  const talking = isHolding && callActive && pushState === 'accepted';
  const buttonDisabled = !callActive || pushState === 'occupied';

  const pushButtonState = pushState === 'occupied'
    ? 'occupied'
    : talking
      ? 'accepted'
      : pushState === 'accepted'
        ? (isHolding ? 'accepted' : 'active')
        : callActive
          ? 'active'
          : 'idle';

  const pushButtonColor = callActive 
  ? (pushState === 'occupied' ? '#1f2937' : '#0f172a') // Dark/Premium tonlar
  : c.surface; // Çağrı yoksa sönük

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
          : tr.talkStatusIdle;

  const buttonLabel = talking ? tr.talkButtonHold : tr.talkButton;
  const localSpeakerName = 'mcuser-222';
  const currentSpeakerName = pushState === 'occupied' ? occupiedSpeaker : localSpeakerName;
  const buttonStatusLabel = pushStatusLabel;
  const buttonHint = callActive ? tr.talkHoldHint : tr.talkNoCallHint;

  // Save current group state on every change
  useEffect(() => {
    setGroupCalls(prev => ({
      ...prev,
      [selectedGroup]: { callActive, pushState, isHolding },
    }));
  }, [callActive, pushState, isHolding, selectedGroup]);

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
        }, 3000);
        timers.push(timer);
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [incomingCalls]);

  const handleSelectGroup = (group: string) => {
    const gs = groupCalls[group];
    setSelectedGroup(group);
    if (gs) {
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
    const frontCount = incomingCalls.size;
    const alreadyFront = orderedGroups.slice(0, frontCount);
    const newCalling = [...incomingCalls].filter(g => !alreadyFront.includes(g));

    if (newCalling.length > 0) {
      const existingCalling = [...incomingCalls].filter(g => !newCalling.includes(g));
      const rest = orderedGroups.filter(g => !incomingCalls.has(g));
      setOrderedGroups([...newCalling, ...existingCalling, ...rest]);
    }
  }, [incomingCalls]);

  useEffect(() => {
    if (!soundMonitoring) {
      setVoiceLevel(0);
      return;
    }

    const handleSound = (data: { value: number }) => {
      const mapped = Math.max(0, Math.min(5, Math.round((data.value + 100) / 20)));
      setVoiceLevel(mapped);
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
    const activeCount = Math.floor((voiceLevel / 5) * BAR_COUNT);
    barAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: i < activeCount ? 1 : 0,
        duration: 120,
        useNativeDriver: false,
      }).start();
    });
  }, [voiceLevel, barAnims]);

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

  useEffect(() => {
    if (talking && voiceLevel > 0) {
      const scale = 1 + (voiceLevel / 5) * 0.04;
      Animated.spring(pulseAnim, {
        toValue: scale,
        friction: 6,
        tension: 100,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(pulseAnim, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }).start();
    }
  }, [voiceLevel, talking, pulseAnim]);

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

  const startSoundMonitoring = () => {
    if (soundMonitoring) return;
    setVoiceLevel(0);
    setSoundMonitoring(true);
    SoundLevel.start();
  };

  const stopSoundMonitoring = () => {
    if (!soundMonitoring) return;
    setSoundMonitoring(false);
    SoundLevel.stop();
    setVoiceLevel(0);
  };

  if (messagesGroup) {
    return <MessagesScreen group={messagesGroup} onClose={() => setMessagesGroup(null)} />;
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.groupsScroll}
        contentContainerStyle={styles.groupsContainer}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {orderedGroups.map((group, idx) => {
          const gs = groupCalls[group];
          const groupColor = gs?.callActive
            ? (gs.isHolding && gs.pushState === 'accepted' ? c.success
              : gs.pushState === 'occupied' ? c.error
              : c.primary)
            : undefined;
          const isActiveGroup = group === selectedGroup;
          return (
            <View key={group} style={styles.groupCol}>
              <View style={styles.groupAvatarWrap}>
                <TouchableOpacity
                  onPress={() => handleSelectGroup(group)}
                  activeOpacity={0.8}
                  style={[
                    styles.groupAvatar,
                    groupColor
                      ? { backgroundColor: groupColor, borderColor: groupColor }
                      : isActiveGroup && styles.groupAvatarActive,
                  ]}
                  testID={`talk-group-${group}`}>
                  <View style={styles.groupIconWrap}>
                    <View style={styles.groupIconPerson}>
                      <View style={[styles.groupIconHead, { backgroundColor: groupColor || isActiveGroup ? c.textOnAccent : c.textSecondary }]} />
                      <View style={[styles.groupIconBody, { backgroundColor: groupColor || isActiveGroup ? c.textOnAccent : c.textSecondary }]} />
                    </View>
                    <View style={[styles.groupIconPerson, { marginLeft: -4 }]}>
                      <View style={[styles.groupIconHead, { backgroundColor: groupColor || isActiveGroup ? 'rgba(255,255,255,0.5)' : c.textMuted }]} />
                      <View style={[styles.groupIconBody, { backgroundColor: groupColor || isActiveGroup ? 'rgba(255,255,255,0.5)' : c.textMuted }]} />
                    </View>
                  </View>
                </TouchableOpacity>
                {incomingCalls.has(group) && !groupCalls[group]?.callActive && (
                  <Animated.View testID={`talk-incoming-badge-${group}`} pointerEvents="none" style={[styles.incomingBadge, { opacity: incomingPulse }]} />
                )}
              </View>
              <Text style={[styles.groupLabel, isActiveGroup && styles.groupLabelActive]}>{group}</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.centerCard}>
        <View style={styles.selectedRow}>
          <Text style={styles.selectedLabel} testID="talk-selected-group">
            {selectedGroup}
          </Text>
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

        {showGroupMenu && (
          <View style={styles.menuOverlayContainer}>
            <Pressable style={styles.menuBackdrop} onPress={() => setShowGroupMenu(false)} />
            <View style={styles.menuCard}>
              {[
                { key: 'alert',          label: tr.talkMenuStartAlert },
                { key: 'imminent_peril',  label: tr.talkMenuStartImminentPeril },
                { key: 'emergency',      label: tr.talkMenuStartEmergency },
                { key: 'details',        label: tr.talkMenuGroupDetails },
                { key: 'mute',           label: tr.talkMenuMuteOff },
              ].map(item => (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => {
                    if (item.key === 'mute') {
                      setMuted(prev => !prev);
                    }
                    setShowGroupMenu(false);
                  }}
                  activeOpacity={0.7}
                  style={styles.menuItem}
                  testID={`talk-group-menu-${item.key}`}>
                  <Text style={styles.menuItemText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.centerBody}>
          <View style={styles.pushButtonWrapper}>
            {isLoading && (
              <Animated.View
                style={[
                  styles.pushButtonRing,
                  {
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
            )}
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Pressable
                testID="talk-push-button"
                onPressIn={() => {
                  if (!callActive || pushState === 'occupied') return;
                  if (pushState === 'idle') {
                    setIsLoading(true);
                    setTimeout(() => {
                      setPushState('accepted');
                      setIsHolding(true);
                      startSoundMonitoring();
                      setIsLoading(false);
                    }, 500);
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
                  {BAR_HEIGHTS.map((height, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.voiceBar,
                        {
                          height: height * 36,
                          backgroundColor: barAnims[i].interpolate({
                            inputRange: [0, 1],
                            outputRange: ['rgba(255,255,255,0.15)', BAR_COLORS[i]],
                          }),
                          opacity: barAnims[i].interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.25, 1],
                          }),
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={styles.pushButtonStatus}>{buttonStatusLabel}</Text>
              </Pressable>
            </Animated.View>
          </View>

          <Text style={styles.pushStatus} testID="talk-status-text">{pushStatusLabel}</Text>
        </View>

        <View>
          <View style={styles.modeRow}>
            {(['receive', 'transmit', 'messages'] as TalkMode[]).map(value => {
              const isDataGroup = DATA_GROUPS.has(selectedGroup);
              const isMessagesDisabled = value === 'messages' && !isDataGroup;
              return (
                <TouchableOpacity
                  key={value}
                  testID={`talk-mode-${value}`}
                  onPress={() => {
                    if (isMessagesDisabled) return;
                    if (value === 'messages' && isDataGroup) {
                      setMessagesGroup(selectedGroup);
                      return;
                    }
                    setMode(value);
                  }}
                  activeOpacity={0.8}
                  style={[
                    styles.modePill,
                    mode === value && !isMessagesDisabled && styles.modePillActive,
                    isMessagesDisabled && styles.modePillDisabled,
                  ]}>
                  <Text style={[
                    styles.modeText,
                    mode === value && !isMessagesDisabled && styles.modeTextActive,
                    isMessagesDisabled && styles.modeTextDisabled,
                  ]}>
                    {value === 'receive' ? tr.talkModeReceive
                      : value === 'transmit' ? tr.talkModeTransmit
                      : tr.talkModeMessages}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="talk-start-button"
              onPress={() => {
                setIsLoading(true);
                setTimeout(() => {
                  setCallActive(true);
                  setPushState('idle');
                  setIsHolding(false);
                  setIsLoading(false);
                }, 600);
              }}
              activeOpacity={0.8}
              style={[styles.actionButton, styles.startButton]}>
              <Text style={styles.actionButtonText}>{tr.talkBtnStartCall}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="talk-end-button"
              onPress={() => {
                setCallActive(false);
                setPushState('idle');
                setIsHolding(false);
              }}
              activeOpacity={0.8}
              style={[styles.actionButton, styles.endButton]}>
              <Text style={styles.actionButtonText}>{tr.talkBtnEndCall}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="talk-mock-toggle"
              onPress={() => setShowMockPanel(!showMockPanel)}
              activeOpacity={0.8}
              style={[styles.actionButton, { backgroundColor: '#6b7280' }]}>
              <Text style={styles.actionButtonText}>
                {showMockPanel ? '✕ Mock' : '⚙ Mock'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

      </View>

      {showMockPanel && (
        <View style={styles.mockOverlay}>
          <Pressable style={styles.mockBackdrop} onPress={() => setShowMockPanel(false)} />
          <View style={styles.mockCard}>
            <View style={styles.mockHeader}>
              <Text style={styles.mockTitle}>{tr.talkMockPanelTitle}</Text>
              <TouchableOpacity
                onPress={() => setShowMockPanel(false)}
                activeOpacity={0.8}
                style={styles.mockCloseButton}
                testID="talk-mock-close">
                <Text style={styles.mockCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.mockSectionLabel}>Floor</Text>
            <View style={styles.mockRow}>
              <TouchableOpacity
                testID="talk-mock-accept"
                onPress={() => setPushState('accepted')}
                activeOpacity={0.8}
                style={[styles.mockButton, styles.mockButtonPrimary]}>
                <Text style={styles.mockButtonText}>{tr.talkMockAccept}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="talk-mock-occupy"
                onPress={() => { setPushState('occupied'); setOccupiedSpeaker('Alice'); }}
                activeOpacity={0.8}
                style={[styles.mockButton, styles.mockButtonDanger]}>
                <Text style={styles.mockButtonText}>{tr.talkMockOccupy}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="talk-mock-reset"
                onPress={() => setPushState('idle')}
                activeOpacity={0.8}
                style={[styles.mockButton, styles.mockButtonReset]}>
                <Text style={styles.mockButtonText}>{tr.talkMockReset}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.mockSectionLabel}>Incoming Calls</Text>
            <View style={styles.mockRow}>
              {orderedGroups.map(g => {
                const hasCall = incomingCalls.has(g);
                return (
                  <TouchableOpacity
                    key={g}
                    testID={`talk-mock-incoming-${g}`}
                    onPress={() => {
                      const next = new Set(incomingCalls);
                      if (hasCall) next.delete(g); else next.add(g);
                      setIncomingCalls(next);
                    }}
                    activeOpacity={0.8}
                    style={[styles.mockButton, hasCall ? styles.mockButtonPrimary : styles.mockButtonReset]}>
                    <Text style={styles.mockButtonText}>{g}{hasCall ? ' 🔔' : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.mockSectionLabel}>Call</Text>
            <View style={styles.mockRow}>
              <TouchableOpacity
                onPress={() => { setCallActive(true); setPushState('idle'); }}
                activeOpacity={0.8}
                style={[styles.mockButton, styles.mockButtonPrimary]}>
                <Text style={styles.mockButtonText}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setCallActive(false); setPushState('idle'); setIsHolding(false); }}
                activeOpacity={0.8}
                style={[styles.mockButton, styles.mockButtonDanger]}>
                <Text style={styles.mockButtonText}>End</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setOccupiedSpeaker('Bob'); setPushState('occupied'); }}
                activeOpacity={0.8}
                style={[styles.mockButton, styles.mockButtonReset]}>
                <Text style={styles.mockButtonText}>Bob</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
