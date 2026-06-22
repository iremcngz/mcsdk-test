import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { makeIncomingCallOverlayStyles } from './styles';

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

  const s = useMemo(() => makeIncomingCallOverlayStyles(c, insets, isDark), [c, insets, isDark]);

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