/**
 * navigation/TabNavigator.tsx — App shell: StatusBar, header, screen content,
 * and bottom tab bar. Screen state is owned by NavigationContext.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { LogConsoleScreen } from '../features/logs/LogConsoleScreen';
import { MockCallsScreen } from '../features/calls/MockCallsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ContactsScreen } from '../features/contacts/ContactsScreen';
import { CallsTab }       from '../features/calls/CallsTab';
import { TalkScreen }     from '../features/talk/TalkScreen';
import { AudioScreen }    from '../features/audio/AudioScreen';
import { VideoScreen }    from '../features/video/VideoScreen';
import { ToolsScreen }    from '../features/tools/ToolsScreen';
import { OutgoingCallScreen } from '../features/calls/OutgoingCallScreen';
import { ActiveCallFullScreen } from '../features/calls/ActiveCallFullScreen';
import { VideoCallScreen } from '../features/calls/VideoCallScreen';
import { IncomingCallOverlay } from '../features/calls/IncomingCallOverlay';
import { CallEndBanner } from '../features/calls/CallEndBanner';

/**
 * The bottom bar. Nine tabs left each one about 11% of the width, so the
 * diagnostics screens (Audio, Video, SDK Logs) moved behind the Tools tab —
 * they are not part of the user's flow. Metrics stays a tab of its own.
 */
const TABS: { id: Screen; icon: string }[] = [
  { id: 'home',     icon: '🏠' },
  { id: 'contacts', icon: '👥' },
  { id: 'calls',    icon: '📞' },
  { id: 'talk',     icon: '🎙️' },
  { id: 'metrics',  icon: '📊' },
  { id: 'tools',    icon: '🧰' },
  { id: 'settings', icon: '⚙️' },
];

/**
 * The screens reached through Tools rather than a tab. They get a back row to
 * the menu, and Tools is the tab that shows as active while one is open — so
 * the bar never highlights nothing.
 */
const TOOL_SCREENS: Screen[] = ['audio', 'video', 'sdklogs', 'logs', 'mockcalls'];

/**
 * Tabs whose point is talking to the MCX server, marked while the registration
 * is not up. Contacts is in: its list is local SQLite and reads fine, but every
 * call placed from it needs the server.
 *
 * Tools is deliberately out. Audio and Video touch no SDK at all — they are raw
 * UDP/MediaSession tests, and testing the media path *without* a registration
 * is exactly what they exist for. Metrics and Settings are local too.
 */
const SERVER_TABS: Screen[] = ['contacts', 'calls', 'talk'];

export function TabNavigator() {
  const { c, tr, theme } = useAppContext();
  const { ipInfo, created, initialized, paramsSet, registered } = useSdkContext();
  const { screen, setScreen, leaveCallScreen } = useNavigation();
  const { activeGroups, setPendingGroup, isBroadcasting, isWatchingVideo, identityServices } = useTalkContext();
  const { activeCall } = useCallContext();
  const isVideoCallScreen = screen === 'callactive' && activeCall?.isVideo === true;
  // The transmit and receive views take the whole screen, and so does a video call.
  const videoFullScreen = isBroadcasting || isWatchingVideo || isVideoCallScreen;
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeCommonStyles(c), [c]);
  const [showActiveList, setShowActiveList] = useState(false);
  const hasActiveCall = activeCall !== null && activeCall.state === 'active';

  /** Short labels for the MC services the user is authorised for. */
  const identityServiceLabels = useMemo(() => {
    const out: string[] = [];
    if (identityServices.ptt)   out.push(tr.talkSvcPtt);
    if (identityServices.video) out.push(tr.talkSvcVideo);
    if (identityServices.data)  out.push(tr.talkSvcData);
    return out;
  }, [identityServices, tr]);

  // The call screens render nothing without an active call, and they hide the
  // tab bar — so when a call goes away (typically the remote party hanging up,
  // where nothing local navigates) return to the screen the user came from.
  useEffect(() => {
    if (!activeCall) leaveCallScreen();
  }, [activeCall, leaveCallScreen]);

  // A video call is for watching: once one is up, its screen opens — also for a
  // call the phone answered by itself (automatic commencement), where nothing
  // else would. Once per call, so the user is never pulled back to it.
  const shownVideoCallRef = useRef<string | null>(null);
  const videoCallUpId = activeCall?.isVideo && activeCall.state === 'active' ? activeCall.id : null;
  useEffect(() => {
    if (!videoCallUpId || shownVideoCallRef.current === videoCallUpId) return;
    shownVideoCallRef.current = videoCallUpId;
    setScreen('callactive');
  }, [videoCallUpId, setScreen]);
  const totalActive = activeGroups.length + (hasActiveCall ? 1 : 0);

  const tabLabels: Record<Screen, string> = {
    home:     tr.tabHome,
    metrics:  tr.tabMetrics,
    sdklogs:  tr.tabSdkLogs,
    logs:     tr.tabLogs,
    mockcalls: tr.tabMockCalls,
    settings: tr.tabSettings,
    contacts: tr.tabContacts,
    calls:    tr.tabCalls,
    talk:     tr.tabTalk,
    tools:    tr.tabTools,
    audio:    tr.tabAudio,
    video:    tr.tabVideo,
    incall:   'In Call',
    callactive: 'Active Call',
  };

  // Registered sits above initialized: init() only returned, while registration
  // runs for ~35 s after it and can still fail. Both are green — the SDK is
  // usable either way — so the word is what distinguishes them.
  const statusColor = registered
    ? c.success
    : initialized
      ? c.success
      : paramsSet
        ? c.warn
        : created
          ? c.primary
          : c.error;

  const statusText = registered
    ? tr.statusRegistered
    : initialized
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
    // Registered MC services, under the username. Deliberately small and low
    // contrast — this is standing status, not something to act on.
    svcRow: {
      flexDirection: 'row',
      gap: 4,
      marginTop: 3,
    },
    svcBadge: {
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: c.primary + '55',
      backgroundColor: c.primary + '14',
    },
    svcBadgeText: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.3,
      color: c.primary,
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
    // A marked tab's label, dimmed while the server is out of reach. Only the
    // label: the icon keeps its colour so the ⚠️ stays legible, and the tab is
    // still pressable — Talk and Calls work offline through the simulate
    // helpers and the mock panel.
    labelUnavailable: {
      opacity: 0.45,
    },
    // The not-registered banner. Amber rather than red: nothing is broken, the
    // bring-up simply has not finished — and it is the same warn colour the
    // status badge uses at the PARAMS SET step, so the two agree.
    notRegBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: c.warn + '22',
      borderBottomWidth: 1,
      borderBottomColor: c.warn + '66',
    },
    notRegBannerText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '700',
      color: c.warn,
    },
    notRegBannerAction: {
      fontSize: 15,
      fontWeight: '800',
      color: c.warn,
    },
    // The ⚠ on a tab that needs the server, over the top-right of its icon.
    tabIconWrap: {
      position: 'relative',
    },
    tabWarnDot: {
      position: 'absolute',
      top: -2,
      right: -8,
      fontSize: 9,
    },

    // The row above a screen opened from Tools. Without it the only way back to
    // the menu would be the Tools tab, which reads as leaving the screen rather
    // than going up one level.
    toolBackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.surface,
    },
    toolBackText: {
      fontSize: 13,
      fontWeight: '600',
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
      {!videoFullScreen && (
        <View style={navStyles.customHeader}>
          <View style={navStyles.profileSection}>
            <View style={navStyles.avatarWrapper}>
              <Text style={navStyles.avatarText}>{userInitials}</Text>
            </View>
            <View style={navStyles.identityBlock}>
              <Text style={navStyles.metaTitle}>MCX Test</Text>
              <Text style={navStyles.usernameText} numberOfLines={1}>
                {username}
              </Text>
              {/* MC services this user is registered for, from
                  SdkListener::onIdentityUpdated. Empty until registration
                  completes, so the row simply disappears when nothing is known. */}
              {identityServiceLabels.length > 0 && (
                <View style={navStyles.svcRow} testID="header-identity-services">
                  {identityServiceLabels.map(label => (
                    <View key={label} style={navStyles.svcBadge}>
                      <Text style={navStyles.svcBadgeText}>{label}</Text>
                    </View>
                  ))}
                </View>
              )}
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

      {/* ── Not registered yet ──────────────────────────────────────────
          Shown on every ordinary screen until the SDK reports REGISTERED.
          The status badge in the header says the same thing, but it is small
          and only carries a word — this says what it means for the screen you
          are on. Hidden on the full-screen call/video views, which must not be
          pushed down, and on Home, where the badge and the Registration card
          are already right there. */}
      {!registered && !videoFullScreen && screen !== 'home'
        && screen !== 'incall' && screen !== 'callactive' && (
        <View style={navStyles.notRegBanner} testID="not-registered-banner">
          <Text testID="not-registered-banner-text" style={navStyles.notRegBannerText}>
            {initialized ? tr.notRegBannerProgress : tr.notRegBannerInit}
          </Text>
          <TouchableOpacity
            testID="not-registered-go-home"
            onPress={() => setScreen('home')}
            activeOpacity={0.7}>
            <Text style={navStyles.notRegBannerAction}>{tr.notRegBannerGoHome}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Back to the Tools menu, for the screens opened from it ────── */}
      {TOOL_SCREENS.includes(screen) && (
        <TouchableOpacity
          testID="tool-back"
          style={navStyles.toolBackRow}
          onPress={() => setScreen('tools')}
          activeOpacity={0.7}>
          <Text style={navStyles.toolBackText}>{tr.toolsBack}</Text>
        </TouchableOpacity>
      )}

      {/* ── Screen Content ──────────────────────────────────────────────── */}
      <View style={{ flex: 1 }}>
        {screen === 'home'     && <HomeScreen />}
        {screen === 'metrics'  && <MetricsScreen />}
        {screen === 'sdklogs'  && <SdkLogsScreen />}
        {screen === 'logs'     && <LogConsoleScreen />}
        {screen === 'mockcalls' && <MockCallsScreen />}
        {screen === 'settings' && <SettingsScreen />}
        {screen === 'contacts' && <ContactsScreen />}
        {screen === 'calls'    && <CallsTab />}
        {screen === 'talk'     && <TalkScreen />}
        {screen === 'audio'    && <AudioScreen />}
        {screen === 'video'    && <VideoScreen />}
        {screen === 'tools'    && <ToolsScreen />}
        {screen === 'incall'   && <OutgoingCallScreen />}
        {screen === 'callactive' && (isVideoCallScreen ? <VideoCallScreen /> : <ActiveCallFullScreen />)}
      </View>

      {screen !== 'incall' && screen !== 'callactive' && !videoFullScreen && (
        <View style={navStyles.bottomBar}>
          {TABS.map(({ id, icon }) => {
            const active = screen === id
              || (id === 'tools' && TOOL_SCREENS.includes(screen));
            return (
              <TouchableOpacity
                key={id}
                style={[navStyles.tab, active && navStyles.tabActive]}
                onPress={() => setScreen(id)}
                activeOpacity={0.7}>
                <View style={navStyles.tabIconWrap}>
                  <Text style={navStyles.icon}>{icon}</Text>
                  {/* This tab needs the server and it is not there yet. */}
                  {!registered && SERVER_TABS.includes(id) && (
                    <Text style={navStyles.tabWarnDot}>⚠️</Text>
                  )}
                </View>
                <Text
                  style={[
                    navStyles.label,
                    active && navStyles.labelActive,
                    !registered && SERVER_TABS.includes(id) && navStyles.labelUnavailable,
                  ]}
                  numberOfLines={1}>
                  {tabLabels[id]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── How the last call ended, if it ended without the user ─────── */}
      <CallEndBanner />

      {/* ── Incoming call overlay (on top of everything) ─────────────── */}
      <IncomingCallOverlay />
    </View>
  );
}