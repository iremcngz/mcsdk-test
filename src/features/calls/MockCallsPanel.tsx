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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { CallType } from './types';
import { makeMockCallsPanelStyles } from './styles';

const DEFAULT_NAME = 'Alice Johnson';
const DEFAULT_URI  = 'sip:alice@mc.example.com';

export function MockCallsPanel() {
  const { c, tr } = useAppContext();
  const { simulateIncomingCall, startCall, commencementMode, setCommencementMode } = useCallContext();
  const { setScreen } = useNavigation();

  const [expanded, setExpanded] = useState(true);
  const [callerName, setCallerName] = useState(DEFAULT_NAME);
  const [callerUri,  setCallerUri]  = useState(DEFAULT_URI);

  const ls = useMemo(() => makeMockCallsPanelStyles(c), [c]);

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
