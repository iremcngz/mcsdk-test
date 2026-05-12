/**
 * navigation/TabNavigator.tsx — App shell: StatusBar, header, tab bar,
 * and screen routing. Owns the `screen` state.
 */

import React, { useMemo, useState } from 'react';
import { StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../contexts/AppContext';
import { useSdkContext } from '../contexts/SdkContext';
import { makeCommonStyles } from '../shared/commonStyles';
import type { Screen } from '../shared/types';

import { HomeScreen }     from '../features/home/HomeScreen';
import { MetricsScreen }  from '../features/metrics/MetricsScreen';
import { SdkLogsScreen }  from '../features/sdklogs/SdkLogsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ContactsScreen } from '../features/contacts/ContactsScreen';

const SCREENS: Screen[] = ['home', 'metrics', 'sdklogs', 'settings', 'contacts'];

export function TabNavigator() {
  const { c, tr, theme } = useAppContext();
  const { ipInfo, created, initialized, paramsSet } = useSdkContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeCommonStyles(c), [c]);

  const [screen, setScreen] = useState<Screen>('home');

  const tabLabels: Record<Screen, string> = {
    home:     tr.tabHome,
    metrics:  tr.tabMetrics,
    sdklogs:  tr.tabSdkLogs,
    settings: tr.tabSettings,
    contacts: tr.tabContacts,
  };

  // Status badge (shown in header when on Home tab)
  const statusColor = initialized
    ? c.success
    : paramsSet
      ? c.warn
      : created
        ? c.primary
        : c.error;
  const statusText = initialized
    ? tr.statusInitialized
    : paramsSet
      ? tr.statusParamsSet
      : created
        ? tr.statusCreated
        : tr.statusNotCreated;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <Text style={s.title}>MCSDK Test</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {ipInfo.ip != null && (
            <View style={[s.badge, { backgroundColor: c.border }]}>
              <Text style={[s.badgeText, { color: c.textSecondary }]}>{ipInfo.ip}</Text>
            </View>
          )}
          {screen === 'home' && (
            <View style={[s.badge, { backgroundColor: statusColor }]}>
              <Text style={s.badgeText}>{statusText}</Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <View style={s.tabBar}>
        {SCREENS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, screen === tab && s.tabActive]}
            onPress={() => setScreen(tab)}>
            <Text
              style={[s.tabText, screen === tab && s.tabTextActive]}
              numberOfLines={1}>
              {tabLabels[tab]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Screen Content ──────────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {screen === 'home'     && <HomeScreen />}
        {screen === 'metrics'  && <MetricsScreen />}
        {screen === 'sdklogs'  && <SdkLogsScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'contacts' && <ContactsScreen />}
      </View>
    </View>
  );
}
