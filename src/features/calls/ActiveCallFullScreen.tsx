import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SoundLevel from 'react-native-sound-level';
import { ensureMicPermission } from '../../core/permissions';
import { MediaSession } from '../../core/mediaSession';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { mapSoundLevel, useVoiceBars, VoiceMeterBars } from '../../shared/VoiceMeter';
import { makeActiveCallFullScreenStyles } from './styles';
import { floorNoticeText, floorTalkerText, useTransientText } from './floorText';

/**
 * features/calls/ActiveCallFullScreen.tsx
 *
 * Full-screen view of an in-progress call (state === 'active'), reached via
 * the 'callactive' route. Shows avatar, timer, and (for half-duplex) the
 * push-to-talk button with a live voice meter. Distinct from ActiveCallCard,
 * which renders the same call compactly inside the Calls tab.
 */
export function ActiveCallFullScreen() {
  const { c, theme, tr } = useAppContext();
  const {
    activeCall, endCall, requestFloor, releaseFloor,
    speakerOn, toggleSpeaker, micMuted, toggleMute,
  } = useCallContext();
  const { leaveCallScreen } = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions(); 

  const [elapsed, setElapsed] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const blinkAnim = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [voiceLevel, setVoiceLevel] = useState(0);
  const soundActiveRef = useRef(false);
  const barAnims = useVoiceBars(voiceLevel);

  const isDark = theme === 'dark';
  const isHalfDuplex = activeCall?.callType === 'half_duplex';
  const floorState = activeCall?.floorState ?? 'idle';
  const isGranted = floorState === 'granted';
  const callState = activeCall?.state;
  const startedAt = activeCall?.startedAt;

  // Busy dims the button against the screen; the ring carries the state.
  const pushButtonColor = floorState === 'busy' ? c.border : c.surface;

  const ringColor =
    floorState === 'busy'    ? c.error   :
    floorState === 'granted' ? c.success :
    floorState === 'queued'  ? c.warn    :
    c.primary;

  const pushStatusLabel =
    floorState === 'busy'       ? tr.floorBusy :
    floorState === 'granted'    ? tr.floorGranted :
    floorState === 'requesting' ? tr.floorRequesting :
    floorState === 'queued'     ? tr.floorQueued(activeCall?.queuePosition ?? 0) :
    tr.floorPressHold;

  const floorDetail =
    floorState === 'busy'    ? (activeCall ? floorTalkerText(tr, activeCall) : tr.floorChannelBusy) :
    floorState === 'granted' ? undefined :
    tr.floorChannelOpen;
  const floorNotice = useTransientText(floorNoticeText(tr, activeCall?.floorNotice));

  // Depends on the two fields it reads, not on activeCall: every floor update
  // replaces that object, and would restart the timer each time.
  useEffect(() => {
    if (callState !== 'active' || startedAt === undefined || isClosing) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [callState, startedAt, isClosing]);

  useEffect(() => {
    if (isGranted && !isClosing) {
      setVoiceLevel(0);
      const start = async () => {
        if ((await ensureMicPermission()) !== 'granted') return;
        // One physical microphone: the media pipeline outranks the level meter,
        // so a refusal means capture must not be started at all.
        if (!(await MediaSession.claimMicForMeter())) return;
        SoundLevel.start();
        soundActiveRef.current = true;
        SoundLevel.onNewFrame = (data: { value: number }) => {
          setVoiceLevel(mapSoundLevel(data.value));
        };
      };
      start();
    } else {
      if (soundActiveRef.current) {
        SoundLevel.onNewFrame = () => {};
        SoundLevel.stop();
      }
      soundActiveRef.current = false;
      MediaSession.releaseMicForMeter();
      setVoiceLevel(0);
    }
    return () => {
      if (soundActiveRef.current) {
        SoundLevel.onNewFrame = () => {};
        SoundLevel.stop();
      }
      soundActiveRef.current = false;
      MediaSession.releaseMicForMeter();
    };
  }, [isGranted, isClosing]);

  useEffect(() => {
    if (isGranted && voiceLevel > 0) {
      const scale = 1 + (voiceLevel / 5) * 0.012;
      Animated.spring(pulseAnim, {
        toValue: scale,
        friction: 12,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.spring(pulseAnim, {
        toValue: 1,
        friction: 8,
        useNativeDriver: true,
      }).start();
    }
  }, [voiceLevel, isGranted, pulseAnim]);

  const handleEndCall = () => {
    if (isClosing) return;
    setIsClosing(true);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (soundActiveRef.current) {
      SoundLevel.onNewFrame = () => {};
      SoundLevel.stop();
    }
    soundActiveRef.current = false;
    MediaSession.releaseMicForMeter();

    Animated.sequence([
      Animated.delay(500),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      endCall();
      // Back to wherever the call was answered from, not a fixed tab.
      leaveCallScreen();
    });
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const buttonSize = Math.min(width * 0.50, 200);
  const ringSize = buttonSize + 24;

  const s = useMemo(
    () => makeActiveCallFullScreenStyles(c, { insets, isDark, ringColor, isGranted, floorState, buttonSize, ringSize }),
    [c, insets, isDark, ringColor, isGranted, floorState, buttonSize, ringSize],
  );

  if (!activeCall || activeCall.state !== 'active') return null;

  return (
    <Animated.View style={[s.root, { opacity: blinkAnim }]}>
      <View style={s.header}>
        {!isHalfDuplex && (
          <View style={s.avatarContainer}>
            <View style={s.avatarRing}>
              <Text style={s.avatarIcon}>👤</Text>
            </View>
          </View>
        )}
        <Text style={s.contactName} numberOfLines={1}>
          {activeCall.contactName}
        </Text>
        <Text style={s.timer}>{isClosing ? 'Closed' : formatTime(elapsed)}</Text>
      </View>

      {isHalfDuplex ? (
        <View style={s.centerBody}>
          <View style={s.pushButtonWrapper}>
            <Animated.View
              style={[s.pushButtonRing, { transform: [{ scale: pulseAnim }] }]}
            />
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Pressable
                // Press asks, release lets go — in every floor state. Asking
                // while someone else talks is legitimate (the server denies or
                // queues it), and releasing before the grant withdraws the
                // request. The floor state itself follows the server.
                onPressIn={() => { if (!isClosing) requestFloor(); }}
                onPressOut={releaseFloor}
                disabled={isClosing}
                testID="ptt-button"
                style={[
                  s.pushButton,
                  { backgroundColor: pushButtonColor },
                  isClosing && s.pushButtonDisabled,
                ]}>
                <View style={s.voiceMeterContainer}>
                  <VoiceMeterBars
                    barAnims={barAnims}
                    barStyle={s.voiceBar}
                    heightScale={24}
                    inactiveColor={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                    inactiveOpacity={0.3}
                  />
                </View>
                <Text style={s.pushButtonStatus}>{pushStatusLabel}</Text>
              </Pressable>
            </Animated.View>
          </View>
          {/* Always rendered at a fixed height, empty or not: this column is
              centred, so a line coming or going would move the PTT button. */}
          <Text style={s.pushStat} numberOfLines={1} testID="floor-detail">{floorDetail ?? ''}</Text>
          <Text style={s.floorNotice} numberOfLines={2} testID="floor-notice">{floorNotice ?? ''}</Text>
        </View>
      ) : (
        <View style={s.centerBody} /> 
      )}

      {/* Mute · End call · Speaker. Mute is UI state only until call audio
          flows (see CallContext.micMuted); the speaker switches the real route. */}
      <View style={s.actionsContainer}>
        <View style={s.actionItem}>
          <TouchableOpacity
            style={[s.sideButton, micMuted && s.sideButtonActive]}
            onPress={toggleMute}
            activeOpacity={0.8}
            disabled={isClosing}
            accessibilityRole="switch"
            accessibilityState={{ checked: micMuted }}
            testID="mute-button">
            <Text style={s.sideIcon}>{micMuted ? '🔇' : '🎙️'}</Text>
          </TouchableOpacity>
          <Text style={s.endCallLabel}>{tr.callMute}</Text>
        </View>

        <View style={s.actionItem}>
          <TouchableOpacity
            style={[s.endCallButton, isClosing && { opacity: 0.5 }]}
            onPress={handleEndCall}
            activeOpacity={0.8}
            disabled={isClosing}
            testID="end-call-button">
            <Text style={s.endCallIcon}>📞</Text>
          </TouchableOpacity>
          <Text style={s.endCallLabel}>{tr.btnEndCall}</Text>
        </View>

        <View style={s.actionItem}>
          <TouchableOpacity
            style={[s.sideButton, speakerOn && s.sideButtonActive]}
            onPress={toggleSpeaker}
            activeOpacity={0.8}
            disabled={isClosing}
            accessibilityRole="switch"
            accessibilityState={{ checked: speakerOn }}
            testID="speaker-button">
            <Text style={s.sideIcon}>{speakerOn ? '🔊' : '🔈'}</Text>
          </TouchableOpacity>
          <Text style={s.endCallLabel}>{tr.callSpeaker}</Text>
        </View>
      </View>
    </Animated.View>
  );
}
