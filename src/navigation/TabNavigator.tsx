/**
 * navigation/TabNavigator.tsx — App shell: StatusBar, header, screen content,
 * and bottom tab bar. Screen state is owned by NavigationContext.
 */

import React, { useMemo, useState } from 'react';
import { Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../contexts/AppContext';
import { useSdkContext } from '../contexts/SdkContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useTalkContext } from '../contexts/TalkContext';
import { useCallContext } from '../contexts/CallContext';
import { makeCommonStyles } from '../shared/commonStyles';
import { AuthSettings } from '../core/settings';
import type { Screen } from '../shared/types';

import { HomeScreen }     from '../features/home/HomeScreen';
import { MetricsScreen }  from '../features/metrics/MetricsScreen';
import { SdkLogsScreen }  from '../features/sdklogs/SdkLogsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ContactsScreen } from '../features/contacts/ContactsScreen';
import { CallsTab }       from '../features/calls/CallsTab';
import { TalkScreen }     from '../features/talk/TalkScreen';
import { OutgoingCallScreen } from '../features/calls/OutgoingCallScreen';
import { ActiveCallFullScreen } from '../features/calls/ActiveCallFullScreen';
import { IncomingCallOverlay } from '../features/calls/IncomingCallOverlay';

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
  const { activeGroups, setPendingGroup, isBroadcasting } = useTalkContext();
  const { activeCall } = useCallContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeCommonStyles(c), [c]);
  const [showActiveList, setShowActiveList] = useState(false);
  const hasActiveCall = activeCall !== null && activeCall.state === 'active';
  const totalActive = activeGroups.length + (hasActiveCall ? 1 : 0);

  const tabLabels: Record<Screen, string> = {
    home:     tr.tabHome,
    metrics:  tr.tabMetrics,
    sdklogs:  tr.tabSdkLogs,
    settings: tr.tabSettings,
    contacts: tr.tabContacts,
    calls:    tr.tabCalls,
    talk:     tr.tabTalk,
    incall:   'In Call',
    callactive: 'Active Call',
  };

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

  // Kullanıcı adını güvenli bir şekilde alıp baş harflerini çıkarma mantığı
  const username = AuthSettings.getLastUsername() ?? '—';
  const userInitials = useMemo(() => {
    if (!username || username === '—') return 'U';
    return username.trim().substring(0, 2).toUpperCase();
  }, [username]);

  // Yeni Estetik Navigasyon ve Premium Header Stilleri
  const navStyles = useMemo(() => StyleSheet.create({
    customHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    profileSection: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    avatarWrapper: {
      width: 36,
      height: 36,
      borderRadius: 10, // Modern squircle görünüm
      backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderWidth: 1,
      borderColor: c.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.accent,
    },
    identityBlock: {
      justifyContent: 'center',
    },
    metaTitle: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textMuted,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 1,
    },
    usernameText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.textPrimary,
    },
    rightSection: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    ipBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
      borderWidth: 1,
      borderColor: c.border,
    },
    ipText: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textSecondary,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#ffffff',
    },
    bottomBar: {
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
    activeListOverlay: {
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 100,
    },
    activeListCard: {
      position: 'absolute',
      top: 56,
      right: 12,
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 4,
      minWidth: 200,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 12,
      zIndex: 101,
    },
    activeListItem: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    activeListItemDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.success,
    },
    activeListItemText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.textPrimary,
    },
    activeListEmpty: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    activeListEmptyText: {
      fontSize: 13,
      color: c.textMuted,
    },
  }), [c, theme, insets.bottom]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* ── Yeni Estetik Üst Başlık (Header) — transmit ekranında gizlenir ── */}
      {!isBroadcasting && (
        <View style={navStyles.customHeader}>
          <View style={navStyles.profileSection}>
            <View style={navStyles.avatarWrapper}>
              <Text style={navStyles.avatarText}>{userInitials}</Text>
            </View>
            <View style={navStyles.identityBlock}>
              <Text style={navStyles.metaTitle}>MCSDK Test</Text>
              <Text style={navStyles.usernameText} numberOfLines={1}>
                {username}
              </Text>
            </View>
          </View>

          <View style={navStyles.rightSection}>
            {ipInfo.ip != null && (
              <View style={navStyles.ipBadge}>
                <Text style={navStyles.ipText}>{ipInfo.ip}</Text>
              </View>
            )}
            {screen === 'home' && (
              <View style={[navStyles.statusBadge, { backgroundColor: statusColor }]}>
                <Text style={navStyles.statusBadgeText}>{statusText}</Text>
              </View>
            )}
            {totalActive > 0 && (
              <TouchableOpacity
                style={[navStyles.statusBadge, { backgroundColor: c.success }]}
                onPress={() => setShowActiveList(p => !p)}
                activeOpacity={0.8}>
                <Text style={navStyles.statusBadgeText}>📞 {totalActive}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* ── Active call list dropdown ───────────────────────────────── */}
      {showActiveList && (
        <View style={navStyles.activeListOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowActiveList(false)} />
          <View style={navStyles.activeListCard}>
            {totalActive === 0 ? (
              <View style={navStyles.activeListEmpty}>
                <Text style={navStyles.activeListEmptyText}>No active calls</Text>
              </View>
            ) : (
              <>
                {activeGroups.map(g => (
                  <TouchableOpacity
                    key={g.name}
                    style={navStyles.activeListItem}
                    onPress={() => {
                      setShowActiveList(false);
                      setPendingGroup(g.name);
                      setScreen('talk');
                    }}
                    activeOpacity={0.7}>
                    <View style={navStyles.activeListItemDot} />
                    <Text style={navStyles.activeListItemText}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
                {hasActiveCall && (
                  <TouchableOpacity
                    style={navStyles.activeListItem}
                    onPress={() => {
                      setShowActiveList(false);
                      setScreen('callactive');
                    }}
                    activeOpacity={0.7}>
                    <View style={navStyles.activeListItemDot} />
                    <Text style={navStyles.activeListItemText}>{activeCall.contactName}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      )}

      {/* ── Screen Content ──────────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {screen === 'home'     && <HomeScreen />}
        {screen === 'metrics'  && <MetricsScreen />}
        {screen === 'sdklogs'  && <SdkLogsScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'contacts' && <ContactsScreen />}
        {screen === 'calls'    && <CallsTab />}
        {screen === 'talk'     && <TalkScreen />}
        {screen === 'incall'   && <OutgoingCallScreen />}
        {screen === 'callactive' && <ActiveCallFullScreen />}
      </View>

      {screen !== 'incall' && screen !== 'callactive' && !isBroadcasting && (
        <View style={navStyles.bottomBar}>
          {TABS.map(({ id, icon }) => {
            const active = screen === id;
            return (
              <TouchableOpacity
                key={id}
                style={[navStyles.tab, active && navStyles.tabActive]}
                onPress={() => setScreen(id)}
                activeOpacity={0.7}>
                <Text style={navStyles.icon}>{icon}</Text>
                <Text
                  style={[navStyles.label, active && navStyles.labelActive]}
                  numberOfLines={1}>
                  {tabLabels[id]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Incoming call overlay (on top of everything) ─────────────── */}
      <IncomingCallOverlay />
    </View>
  );
}