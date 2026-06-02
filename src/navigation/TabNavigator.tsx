/**
 * navigation/TabNavigator.tsx — App shell: StatusBar, header, screen content,
 * and bottom tab bar. Screen state is owned by NavigationContext.
 */

import React, { useMemo } from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../contexts/AppContext';
import { useSdkContext } from '../contexts/SdkContext';
import { useNavigation } from '../contexts/NavigationContext';
import { makeCommonStyles } from '../shared/commonStyles';
import type { Screen } from '../shared/types';

import { HomeScreen }     from '../features/home/HomeScreen';
import { MetricsScreen }  from '../features/metrics/MetricsScreen';
import { SdkLogsScreen }  from '../features/sdklogs/SdkLogsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ContactsScreen } from '../features/contacts/ContactsScreen';
import { CallsTab }       from '../features/calls/CallsTab';
import { TalkScreen }     from '../features/talk/TalkScreen';

// Tab order: most-used first on the left.
const TABS: { id: Screen; icon: string }[] = [
  { id: 'home',     icon: '🏠' },
  { id: 'contacts', icon: '👥' },
  { id: 'calls',    icon: '📞' },
  { id: 'talk',     icon: '🎙️' },
  { id: 'metrics',  icon: '📊' },
  { id: 'sdklogs',  icon: '📋' },
  { id: 'settings', icon: '⚙️' },
];

export function TabNavigator() {
  const { c, tr, theme } = useAppContext();
  const { ipInfo, created, initialized, paramsSet } = useSdkContext();
  const { screen, setScreen } = useNavigation();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeCommonStyles(c), [c]);

  const tabLabels: Record<Screen, string> = {
    home:     tr.tabHome,
    metrics:  tr.tabMetrics,
    sdklogs:  tr.tabSdkLogs,
    settings: tr.tabSettings,
    contacts: tr.tabContacts,
    calls:    tr.tabCalls,
    talk:     tr.tabTalk,
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

  // Bottom tab bar styles (override the top-border-based commonStyles)
  const bottomTabBar = useMemo(() => StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingBottom: insets.bottom,
    },
    tab: {
      flex: 1,
      paddingTop: 8,
      paddingBottom: 4,
      alignItems: 'center',
      gap: 2,
      borderTopWidth: 2,
      borderTopColor: 'transparent',
    },
    tabActive: {
      borderTopColor: c.accent,
    },
    icon: {
      fontSize: 20,
    },
    label: {
      fontSize: 10,
      fontWeight: '600',
      color: c.textMuted,
    },
    labelActive: {
      color: c.accent,
    },
  }), [c, insets.bottom]);

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

      {/* ── Screen Content ──────────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {screen === 'home'     && <HomeScreen />}
        {screen === 'metrics'  && <MetricsScreen />}
        {screen === 'sdklogs'  && <SdkLogsScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'contacts' && <ContactsScreen />}
        {screen === 'calls'    && <CallsTab />}
        {screen === 'talk'     && <TalkScreen />}
      </View>

      {/* ── Bottom Tab Bar ───────────────────────────────────────────────── */}
      <View style={bottomTabBar.bar}>
        {TABS.map(({ id, icon }) => {
          const active = screen === id;
          return (
            <TouchableOpacity
              key={id}
              style={[bottomTabBar.tab, active && bottomTabBar.tabActive]}
              onPress={() => setScreen(id)}
              activeOpacity={0.7}>
              <Text style={bottomTabBar.icon}>{icon}</Text>
              <Text
                style={[bottomTabBar.label, active && bottomTabBar.labelActive]}
                numberOfLines={1}>
                {tabLabels[id]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
