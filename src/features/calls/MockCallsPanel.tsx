/**
 * features/calls/MockCallsPanel.tsx
 *
 * Collapsible dev/test panel rendered at the bottom of CallHistoryScreen.
 * Lets you simulate every call flow state without touching the real SDK.
 *
 * ┌─ 🧪 Mock Kontrol ──────────────────────── ▼ ─┐
 * │ Caller name: [Alice Johnson         ]          │
 * │ SIP URI:     [sip:alice@mc.example.com]        │
 * │                                                │
 * │  ── Gelen Arama ────────────────────────────  │
 * │  [ 📞 Gelen HD ]        [ 📞 Gelen FD ]        │
 * │                                                │
 * │  ── Giden Arama ────────────────────────────  │
 * │  [ 📤 Giden HD ]        [ 📤 Giden FD ]        │
 * └────────────────────────────────────────────────┘
 */

import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { CallType } from './types';

const DEFAULT_NAME = 'Alice Johnson';
const DEFAULT_URI  = 'sip:alice@mc.example.com';

export function MockCallsPanel() {
  const { c, tr } = useAppContext();
  const { simulateIncomingCall, startCall, commencementMode, setCommencementMode } = useCallContext();
  const { setScreen } = useNavigation();

  const [expanded, setExpanded] = useState(true);
  const [callerName, setCallerName] = useState(DEFAULT_NAME);
  const [callerUri,  setCallerUri]  = useState(DEFAULT_URI);

  const ls = useMemo(() => StyleSheet.create({
    card: {
      margin: 12,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.warn + '88',
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: c.warn + '18',
      gap: 8,
    },
    headerTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: c.warn,
    },
    chevron: {
      fontSize: 14,
      color: c.textSecondary,
    },
    body: {
      padding: 14,
      gap: 14,
    },
    inputRow: {
      gap: 6,
    },
    inputLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 13,
      color: c.text,
      backgroundColor: c.background,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    btn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#fff',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    commencementRow: {
      flexDirection: 'row',
      gap: 8,
    },
    commBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1.5,
      alignItems: 'center',
    },
    commBtnText: {
      fontSize: 12,
      fontWeight: '700',
    },
  }), [c]);

  function fireIncoming(callType: CallType) {
    simulateIncomingCall(
      callerName.trim() || DEFAULT_NAME,
      callerUri.trim()  || DEFAULT_URI,
      callType,
    );
    setScreen('calls');
  }

  function fireOutgoing(callType: CallType) {
    startCall(
      callerName.trim() || DEFAULT_NAME,
      callerUri.trim()  || DEFAULT_URI,
      callType,
    );
    setScreen('calls');
  }

  return (
    <View style={ls.card}>
      {/* Header / toggle */}
      <TouchableOpacity
        style={ls.header}
        onPress={() => setExpanded(p => !p)}
        activeOpacity={0.8}>
        <Text style={ls.headerTitle}>{tr.mockPanelTitle}</Text>
        <Text style={ls.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={ls.body}>
          {/* ── Caller info inputs ─────────────────────────────────────── */}
          <View style={ls.inputRow}>
            <Text style={ls.inputLabel}>Ad Soyad / Name</Text>
            <TextInput
              style={ls.input}
              value={callerName}
              onChangeText={setCallerName}
              placeholder={DEFAULT_NAME}
              placeholderTextColor={c.textMuted}
              autoCapitalize="words"
            />
          </View>
          <View style={ls.inputRow}>
            <Text style={ls.inputLabel}>SIP URI</Text>
            <TextInput
              style={ls.input}
              value={callerUri}
              onChangeText={setCallerUri}
              placeholder={DEFAULT_URI}
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          <View style={ls.divider} />

          {/* ── Commencement mode ──────────────────────────────────────── */}
          <View>
            <Text style={ls.sectionLabel}>Başlangıç Modu / Commencement</Text>
            <View style={ls.commencementRow}>
              {(['auto', 'manual'] as const).map(mode => {
                const active = commencementMode === mode;
                return (
                  <TouchableOpacity
                    key={mode}
                    style={[ls.commBtn, {
                      backgroundColor: active ? c.primary : 'transparent',
                      borderColor: c.primary,
                    }]}
                    onPress={() => setCommencementMode(mode)}
                    activeOpacity={0.8}>
                    <Text style={[ls.commBtnText, { color: active ? '#fff' : c.primary }]}>
                      {mode === 'auto' ? tr.commencementAuto : tr.commencementManual}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={ls.divider} />

          {/* ── Incoming call ──────────────────────────────────────────── */}
          <View>
            <Text style={ls.sectionLabel}>Gelen Arama / Incoming</Text>
            <View style={ls.row}>
              <TouchableOpacity
                style={[ls.btn, { backgroundColor: c.success }]}
                onPress={() => fireIncoming('half_duplex')}
                activeOpacity={0.8}>
                <Text style={ls.btnText}>📞 {tr.mockIncomingHD}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ls.btn, { backgroundColor: c.success }]}
                onPress={() => fireIncoming('full_duplex')}
                activeOpacity={0.8}>
                <Text style={ls.btnText}>📞 {tr.mockIncomingFD}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={ls.divider} />

          {/* ── Outgoing call ──────────────────────────────────────────── */}
          <View>
            <Text style={ls.sectionLabel}>Giden Arama / Outgoing</Text>
            <View style={ls.row}>
              <TouchableOpacity
                style={[ls.btn, { backgroundColor: c.primary }]}
                onPress={() => fireOutgoing('half_duplex')}
                activeOpacity={0.8}>
                <Text style={ls.btnText}>📤 {tr.mockOutgoingHD}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ls.btn, { backgroundColor: c.primary }]}
                onPress={() => fireOutgoing('full_duplex')}
                activeOpacity={0.8}>
                <Text style={ls.btnText}>📤 {tr.mockOutgoingFD}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
