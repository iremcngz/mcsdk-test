/**
 * features/calls/MockCallsScreen.tsx — the call simulator, as its own screen.
 *
 * `MockCallsPanel` used to sit at the bottom of the Calls tab, under the call
 * history, where it was the first thing on a screen whose subject is real
 * calls — and it is not one: every button here makes a purely local call with
 * no `sdkCallId`, for driving the UI with no server. It lives under Tools now,
 * beside the other diagnostics screens, and the Calls tab shows history alone.
 *
 * The panel itself is unchanged and still collapsible; this screen only gives
 * it a page to sit on and says what it is for.
 */

import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { makeCommonStyles } from '../../shared/commonStyles';
import { makeToolsStyles } from '../tools/styles';
import { MockCallsPanel } from './MockCallsPanel';

export function MockCallsScreen() {
  const { c, tr } = useAppContext();
  const insets    = useSafeAreaInsets();
  const s  = useMemo(() => makeCommonStyles(c), [c]);
  const ts = useMemo(() => makeToolsStyles(c), [c]);

  return (
    <ScrollView
      style={s.body}
      contentContainerStyle={[s.bodyContent, { paddingBottom: insets.bottom + 20 }]}
      keyboardShouldPersistTaps="handled">
      <Text style={s.sectionTitle}>{tr.tabMockCalls}</Text>
      <Text style={ts.subtitle}>{tr.mockCallsSubtitle}</Text>
      <View testID="mock-calls-panel">
        <MockCallsPanel />
      </View>
    </ScrollView>
  );
}
