import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SoundLevel from 'react-native-sound-level';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';

const BAR_COUNT = 7;
const BAR_HEIGHTS = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0, 1.0];
const BAR_COLORS = ['#4ade80', '#4ade80', '#facc15', '#facc15', '#fb923c', '#ef4444', '#ef4444'];

export function CallActiveScreen() {
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
  const barAnims = useRef(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(0))
  ).current;

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
          const mapped = Math.max(0, Math.min(5, Math.round((data.value + 100) / 20)));
          setVoiceLevel(mapped);
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

  const s = useMemo(() => StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
      paddingTop: insets.top ,
      paddingBottom: insets.bottom + 30,
    },
    header: {
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    avatarContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    avatarRing: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.surface,
      borderWidth: 3,
      borderColor: isGranted ? (c.success || '#10b981') : c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: isGranted ? (c.success || '#10b981') : c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 5,
    },
    avatarIcon: {
      fontSize: 36,
    },
    contactName: {
      fontSize: 30,
      fontWeight: '800',
      color: c.textPrimary,
      textAlign: 'center',
      letterSpacing: -0.5,
    },
    timer: {
      fontSize: 42,
      fontWeight: '200',
      color: c.textPrimary,
      fontVariant: ['tabular-nums'],
      letterSpacing: 2,
      marginTop: 12,
    },
    centerBody: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      marginVertical: 32, // ÜST VE ALT TARAFTA GÜVENLİ BOŞLUK GARANTİSİ EKLENDİ
      minHeight: ringSize, 
    },
    pushButtonWrapper: {
      width: ringSize,
      height: ringSize,
      justifyContent: 'center',
      alignItems: 'center',
    },
    pushButtonRing: {
      position: 'absolute',
      width: ringSize,
      height: ringSize,
      borderRadius: ringSize / 2,
      borderWidth: 2,
      borderColor: ringColor,
      opacity: 0.5,
    },
    pushButton: {
      width: buttonSize,
      height: buttonSize,
      borderRadius: buttonSize / 2,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
      shadowColor: floorState === 'busy' ? '#000' : ringColor,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 8,
    },
    pushButtonDisabled: {
      opacity: 0.6,
    },
    voiceMeterContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 36,
      marginBottom: 8,
      paddingHorizontal: 20,
    },
    voiceBar: {
      flex: 1,
      borderRadius: 3,
      minHeight: 4,
    },
    pushButtonStatus: {
      color: isDark ? '#ffffff' : c.textPrimary,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
      textAlign: 'center',
    },
    pushStat: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '500',
      textAlign: 'center',
      marginTop: 28, 
      letterSpacing: 0.5,
    },
    actionsContainer: {
      alignItems: 'center',
      paddingHorizontal: 24,
      gap: 12,
    },
    endCallButton: {
      width: 80, 
      height: 80,
      borderRadius: 40,
      backgroundColor: c.error || '#ef4444',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.error || '#ef4444',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 10,
    },
    endCallIcon: {
      fontSize: 32,
      color: '#fff',
      transform: [{ rotate: '135deg' }], 
    },
    endCallLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: c.textSecondary,
    },
  }), [c, insets, isDark, ringColor, isGranted, floorState, buttonSize, ringSize]);

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
                  {BAR_HEIGHTS.map((height, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        s.voiceBar,
                        {
                          height: height * 24, 
                          backgroundColor: barAnims[i].interpolate({
                            inputRange: [0, 1],
                            outputRange: [isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', BAR_COLORS[i]],
                          }),
                          opacity: barAnims[i].interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.3, 1],
                          }),
                        },
                      ]}
                    />
                  ))}
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
