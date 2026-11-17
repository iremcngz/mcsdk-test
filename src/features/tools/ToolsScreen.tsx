/**
 * features/tools/ToolsScreen.tsx — the menu behind the Tools tab.
 *
 * The bottom bar had nine tabs, which left each one about 11% of the width:
 * icons crowded and labels truncated. The diagnostics screens are what moved
 * here, because they are not part of the user's flow (Home → Contacts → Calls
 * → Talk) — they are for judging whether the media path holds up. Each is
 * still its own `Screen`; this is only a list that navigates to them, so the
 * screens themselves are untouched and anything that already calls
 * `setScreen('audio')` keeps working.
 *
 * Metrics deliberately stays a tab of its own.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { useLogContext } from '../../contexts/LogContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { makeCommonStyles } from '../../shared/commonStyles';
import { makeToolsStyles } from './styles';
import type { Screen } from '../../shared/types';

export function ToolsScreen() {
  const { c, tr }         = useAppContext();
  const { sdkRef, created } = useSdkContext();
  const { logs } = useLogContext();
  const { setScreen } = useNavigation();
  const insets      = useSafeAreaInsets();
  const s  = useMemo(() => makeCommonStyles(c), [c]);
  const ts = useMemo(() => makeToolsStyles(c), [c]);

  // The SDK's log lines live in the native ring, not in a context, so the count
  // is asked for once when the menu opens — one crossing — rather than kept
  // live. The menu is a stop on the way to a screen, not a place to watch it.
  const [sdkLogCount, setSdkLogCount] = useState(0);
  useEffect(() => {
    const sdk = created ? sdkRef.current : null;
    if (!sdk) {
      setSdkLogCount(0);
      return;
    }
    let cancelled = false;
    sdk.getSdkLogCount()
      .then(n => { if (!cancelled) setSdkLogCount(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sdkRef, created]);

  /** The rows, with the count each log viewer would show. */
  const items: { id: Screen; icon: string; title: string; desc: string; badge?: string }[] = [
    { id: 'audio',   icon: '🔊', title: tr.tabAudio,   desc: tr.toolsAudioDesc },
    { id: 'video',   icon: '🎥', title: tr.tabVideo,   desc: tr.toolsVideoDesc },
    {
      id: 'logs',    icon: '📝', title: tr.tabLogs,    desc: tr.toolsLogsDesc,
      badge: logs.length > 0 ? String(logs.length) : undefined,
    },
    {
      id: 'sdklogs', icon: '📋', title: tr.tabSdkLogs, desc: tr.toolsSdkLogsDesc,
      badge: sdkLogCount > 0 ? String(sdkLogCount) : undefined,
    },
    { id: 'mockcalls', icon: '🧪', title: tr.tabMockCalls, desc: tr.toolsMockCallsDesc },
  ];

  return (
    <ScrollView
      style={s.body}
      contentContainerStyle={[s.bodyContent, { paddingBottom: insets.bottom + 20 }]}>
      <Text style={s.sectionTitle}>{tr.toolsTitle}</Text>
      <Text style={ts.subtitle}>{tr.toolsSubtitle}</Text>

      {items.map(item => (
        <TouchableOpacity
          key={item.id}
          testID={`tool-${item.id}`}
          style={ts.row}
          onPress={() => setScreen(item.id)}
          activeOpacity={0.7}>
          <View style={ts.rowIconWrap}>
            <Text style={ts.rowIcon}>{item.icon}</Text>
          </View>
          <View style={ts.rowTextBlock}>
            <Text style={ts.rowTitle}>{item.title}</Text>
            <Text style={ts.rowDesc} numberOfLines={2}>{item.desc}</Text>
          </View>
          {item.badge && (
            <View style={ts.rowBadge}>
              <Text style={ts.rowBadgeText}>{item.badge}</Text>
            </View>
          )}
          <Text style={ts.rowChevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
