import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';

const SWIPE_THRESHOLD = 200;

export function IncomingCallOverlay() {
  const { c, theme } = useAppContext();
  const { activeCall, acceptCall, rejectCall } = useCallContext();
  const { setScreen } = useNavigation();
  const insets = useSafeAreaInsets();

  const slideX = useRef(new Animated.Value(0)).current;
  const containerWidth = useRef(300);
  const pulse = useRef(new Animated.Value(1)).current;
  const acceptRef = useRef(acceptCall);
  useEffect(() => { acceptRef.current = acceptCall; }, [acceptCall]);

  useEffect(() => {
    if (activeCall?.state === 'ringing') {
      // ÖNEMLİ DÜZELTME: Yeni çağrı geldiğinde slider'ı sıfırla
      slideX.setValue(0);
      
      Vibration.vibrate([0, 400, 200, 400], true);
      return () => Vibration.cancel();
    }
  }, [activeCall?.state, slideX]);

  useEffect(() => {
    if (activeCall?.state !== 'ringing') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [activeCall?.state, pulse]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        const THUMB_SIZE = 64;
        const maxSlide = containerWidth.current - THUMB_SIZE - 8; // Sağdan biraz boşluk bırak
        const next = Math.max(0, Math.min(gs.dx, maxSlide));
        slideX.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx >= SWIPE_THRESHOLD) {
          acceptRef.current();
          setScreen('callactive');
        }
        Animated.spring(slideX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 100,
          friction: 12,
        }).start();
      },
    }),
  ).current;

  // Slider kaydırıldıkça yazının opaklığını düşür
  const textOpacity = slideX.interpolate({
    inputRange: [0, SWIPE_THRESHOLD / 1.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const isDark = theme === 'dark';

  const s = useMemo(() => StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(248, 250, 252, 0.95)',
      zIndex: 9999,
      justifyContent: 'space-between',
    },
    header: {
      paddingTop: insets.top + 40,
      alignItems: 'center',
    },
    incomingLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: c.textSecondary,
      letterSpacing: 2,
      textTransform: 'uppercase',
      marginBottom: 40,
    },
    avatarContainer: {
      alignItems: 'center',
      marginBottom: 32,
    },
    avatarRing: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: c.surface,
      borderWidth: 4,
      borderColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 10,
    },
    avatarIcon: {
      fontSize: 54,
    },
    contactInfo: {
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    contactName: {
      fontSize: 34,
      fontWeight: '800',
      color: c.textPrimary,
      textAlign: 'center',
      marginBottom: 12,
      letterSpacing: -0.5,
    },
    actionsContainer: {
      paddingBottom: insets.bottom + 40,
      paddingHorizontal: 32,
      alignItems: 'center',
      gap: 32,
    },
    sliderWrap: {
      width: '100%',
      height: 72,
      borderRadius: 36,
      backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    sliderTrack: {
      flex: 1,
      borderRadius: 36,
      justifyContent: 'center',
      position: 'relative',
    },
    sliderThumb: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.success || '#10b981',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'absolute',
      left: 4,
      zIndex: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 6,
    },
    sliderThumbIcon: {
      fontSize: 28,
      color: '#fff',
    },
    sliderLabelContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1,
    },
    sliderLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
      letterSpacing: 0.5,
      paddingLeft: 40, // Thumb'ın arkasında kalmaması için
    },
    declineBtn: {
      paddingHorizontal: 40,
      paddingVertical: 14,
      borderRadius: 28,
      backgroundColor: 'transparent',
    },
    declineText: {
      fontSize: 16,
      fontWeight: '700',
      color: c.error || '#ef4444',
      letterSpacing: 0.5,
    },
  }), [c, insets, isDark]);

  if (!activeCall || activeCall.state !== 'ringing') return null;

  return (
    <View style={s.overlay}>
      <View style={s.header}>
        <Text style={s.incomingLabel}>Incoming Call</Text>

        <View style={s.avatarContainer}>
          <Animated.View style={[s.avatarRing, { transform: [{ scale: pulse }] }]}>
            <Text style={s.avatarIcon}>👤</Text>
          </Animated.View>
        </View>

        <View style={s.contactInfo}>
          <Text style={s.contactName} numberOfLines={1}>
            {activeCall.contactName}
          </Text>
        </View>
      </View>

      <View style={s.actionsContainer}>
        <View style={s.sliderWrap}
          onLayout={e => { containerWidth.current = e.nativeEvent.layout.width; }}>
          <View style={s.sliderTrack}>
            <Animated.View style={[s.sliderLabelContainer, { opacity: textOpacity }]}>
              <Text style={s.sliderLabel}>Slide to answer</Text>
            </Animated.View>
            
            <Animated.View
              style={[s.sliderThumb, { transform: [{ translateX: slideX }] }]}
              {...panResponder.panHandlers}>
              <Text style={s.sliderThumbIcon}>📞</Text>
            </Animated.View>
          </View>
        </View>

        <TouchableOpacity style={s.declineBtn} onPress={() => { rejectCall(); setScreen('contacts'); }} activeOpacity={0.6}>
          <Text style={s.declineText}>Decline Call</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}