import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PermissionsAndroid, Platform, Pressable, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SoundLevel from 'react-native-sound-level';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { mapSoundLevel, useVoiceBars, VoiceMeterBars } from '../../shared/VoiceMeter';
import { makeActiveCallFullScreenStyles } from './styles';

/**
 * features/calls/ActiveCallFullScreen.tsx
 *
 * Full-screen view of an in-progress call (state === 'active'), reached via
 * the 'callactive' route. Shows avatar, timer, and (for half-duplex) the
 * push-to-talk button with a live voice meter. Distinct from ActiveCallCard,
 * which renders the same call compactly inside the Calls tab.
 */
export function ActiveCallFullScreen() {
  const { c, theme } = useAppContext();
  const { activeCall, endCall, setFloorState } = useCallContext();
  const { setScreen } = useNavigation();
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
  const pushDisabled = floorState === 'busy';
  const isGranted = floorState === 'granted';

  const pushButtonColor = floorState === 'busy' ? (isDark ? '#1e293b' : '#e2e8f0') : (isDark ? '#0f172a' : '#f1f5f9');

  const ringColor = floorState === 'busy'
    ? (c.error || '#ef4444')
    : floorState === 'granted'
      ? (c.success || '#10b981')
      : c.primary;

  const pushStatusLabel = floorState === 'busy'
    ? 'Occupied'
    : floorState === 'granted'
      ? 'Talking...'
      : 'Press & Hold';

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'active' || isClosing) {
      setElapsed(0);
      return;
    }
    const tick = () =>
      setElapsed(Math.round((Date.now() - activeCall.startedAt) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeCall?.state, activeCall?.startedAt, isClosing]);

  useEffect(() => {
    if (isGranted && !isClosing) {
      setVoiceLevel(0);
      const start = async () => {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
        }
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
      setVoiceLevel(0);
    }
    return () => {
      if (soundActiveRef.current) {
        SoundLevel.onNewFrame = () => {};
        SoundLevel.stop();
      }
      soundActiveRef.current = false;
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

    Animated.sequence([
      Animated.delay(500),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(blinkAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      endCall();
      setScreen('contacts');
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
                onPressIn={() => { if (!pushDisabled && !isClosing) setFloorState('granted'); }}
                onPressOut={() => { if (floorState === 'granted' && !isClosing) setFloorState('idle'); }}
                disabled={pushDisabled || isClosing}
                style={[
                  s.pushButton,
                  { backgroundColor: pushButtonColor },
                  (pushDisabled || isClosing) && s.pushButtonDisabled,
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
          <Text style={s.pushStat}>
            {floorState === 'busy' ? 'Channel is currently in use' : 'Channel is open'}
          </Text>
        </View>
      ) : (
        <View style={s.centerBody} /> 
      )}

      <View style={s.actionsContainer}>
        <TouchableOpacity 
          style={[s.endCallButton, isClosing && { opacity: 0.5 }]} 
          onPress={handleEndCall} 
          activeOpacity={0.8}
          disabled={isClosing}>
          <Text style={s.endCallIcon}>📞</Text>
        </TouchableOpacity>
        <Text style={s.endCallLabel}>End Call</Text>
      </View>
    </Animated.View>
  );
}
