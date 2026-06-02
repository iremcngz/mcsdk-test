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
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SoundLevel from 'react-native-sound-level';
import { useAppContext } from '../../contexts/AppContext';
import { makeTalkStyles } from './styles';

const GROUPS = ['group1', 'group2', 'group3', 'group4', 'group5', 'group6', 'group7'];

type TalkMode = 'receive' | 'transmit' | 'messages';

type PushState = 'idle' | 'accepted' | 'occupied';

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
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [soundMonitoring, setSoundMonitoring] = useState(false);
  const [showMockPanel, setShowMockPanel] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const BAR_COUNT = 7;
  const BAR_HEIGHTS = [0.3, 0.7, 0.5, 1.0, 0.55, 0.85, 0.35];
  const BAR_COLORS = ['#4ade80', '#4ade80', '#facc15', '#facc15', '#fb923c', '#ef4444', '#ef4444'];
  const barAnims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0))
  ).current;

  const talking = isHolding && callActive && pushState === 'accepted' && micEnabled;
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

  const pushButtonColor = pushButtonState === 'occupied'
    ? c.error
    : pushButtonState === 'accepted'
      ? c.success
      : pushButtonState === 'active'
        ? c.primary
        : c.border;

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
  const buttonHint = !micEnabled
    ? tr.talkMicDisabledHint
    : callActive
      ? tr.talkHoldHint
      : tr.talkNoCallHint;

  useEffect(() => {
    if (!soundMonitoring) {
      setVoiceLevel(0);
      return;
    }

    const handleSound = (data: { value: number }) => {
      const mapped = Math.max(0, Math.min(5, Math.round((data.value + 100) / 20)));
      setVoiceLevel(mapped);
    };

    SoundLevel.onNewFrame = handleSound;

    return () => {
      SoundLevel.onNewFrame = undefined;
      SoundLevel.stop();
    };
  }, [soundMonitoring]);

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

  const requestMicAccess = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Access',
            message: 'Talk mode needs microphone access to capture your voice.',
            buttonPositive: 'Allow',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          setMicEnabled(true);
          setMicError(null);
        } else {
          setMicEnabled(false);
          setMicError(tr.talkMicDenied);
        }
      } catch {
        setMicEnabled(false);
        setMicError(tr.talkMicDenied);
      }
      return;
    }

    setMicEnabled(true);
    setMicError(null);
  };

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

  return (
    <View style={styles.root}>
      <Text style={styles.sectionTitle}>{tr.talkGroupsTitle}</Text>
      <ScrollView
        style={styles.groupsScroll}
        contentContainerStyle={styles.groupsContainer}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {GROUPS.map(group => {
          const active = group === selectedGroup;
          return (
            <TouchableOpacity
              key={group}
              onPress={() => setSelectedGroup(group)}
              activeOpacity={0.8}
              style={[styles.groupPill, active && styles.groupPillActive]}
              testID={`talk-group-${group}`}>
              <Text style={[styles.groupText, active && styles.groupTextActive]}>{group}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.centerCard}>
        <Text style={styles.selectedLabel} testID="talk-selected-group">
          {tr.talkSelectedGroup}: {selectedGroup}
        </Text>

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
                if (!micEnabled) {
                  requestMicAccess();
                  return;
                }
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
              <Text style={styles.buttonSpeakerName}>{currentSpeakerName}</Text>
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
              <Text style={styles.pushButtonText}>{buttonLabel}</Text>
              <Text style={styles.pushButtonStatus}>{buttonStatusLabel}</Text>
              <Text style={styles.pushButtonMeta}>{buttonHint}</Text>
            </Pressable>
          </Animated.View>
        </View>

        <View>
          <Text style={styles.pushStatus} testID="talk-status-text">{pushStatusLabel}</Text>
          {!micEnabled ? (
            <TouchableOpacity
              testID="talk-mic-button"
              onPress={requestMicAccess}
              activeOpacity={0.8}
              style={[styles.actionButton, styles.micButton]}
            >
              <Text style={styles.actionButtonText}>{tr.talkMicEnable}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.micStatusText}>{tr.talkMicEnabled}</Text>
          )}
          {micError ? <Text style={styles.micErrorText}>{micError}</Text> : null}
        </View>

        <View>
          <View style={styles.modeRow}>
            {(['receive', 'transmit', 'messages'] as TalkMode[]).map(value => (
              <TouchableOpacity
                key={value}
                testID={`talk-mode-${value}`}
                onPress={() => setMode(value)}
                activeOpacity={0.8}
                style={[styles.modePill, mode === value && styles.modePillActive]}>
                <Text style={[styles.modeText, mode === value && styles.modeTextActive]}>
                  {value === 'receive' ? tr.talkModeReceive
                    : value === 'transmit' ? tr.talkModeTransmit
                    : tr.talkModeMessages}
                </Text>
              </TouchableOpacity>
            ))}
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

        {showMockPanel && (
          <View style={styles.mockOverlay}>
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
    </View>
  );
}
