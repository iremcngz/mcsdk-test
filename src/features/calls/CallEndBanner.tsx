/**
 * features/calls/CallEndBanner.tsx
 *
 * A short notice saying how a call ended, when it ended without the user doing
 * it here (remote hang-up, server release, lost connection, busy, no answer).
 * The call screens close on their own then, and without this the call simply
 * vanishes. Rendered once by TabNavigator, over whatever screen the user lands
 * on; a call the user ended themselves gets no notice.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { callEndDetail, endedRemotely } from './callEndText';
import { makeCallEndBannerStyles } from './styles';
import type { CallRecord } from './types';

/** How long the notice stays on screen. */
export const CALL_END_NOTICE_MS = 4000;

export function CallEndBanner() {
  const { c, tr } = useAppContext();
  const { callHistory } = useCallContext();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeCallEndBannerStyles(c, insets), [c, insets]);

  // The newest record is the call that just ended. Keyed on its id rather than
  // its text, so two calls ending the same way in a row both get a notice.
  const latest = callHistory[0];
  const seenId = useRef(latest?.id);
  const [shown, setShown] = useState<CallRecord | undefined>(undefined);

  useEffect(() => {
    if (!latest || latest.id === seenId.current) return;
    seenId.current = latest.id;
    if (latest.end && endedRemotely(latest.end)) setShown(latest);
  }, [latest]);

  // Its own effect, so nothing but a new notice restarts or cancels the timer.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(undefined), CALL_END_NOTICE_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown?.end) return null;
  return (
    <View style={s.banner} pointerEvents="none" testID="call-end-banner">
      <Text style={s.text}>{callEndDetail(tr, shown.end)}</Text>
    </View>
  );
}
