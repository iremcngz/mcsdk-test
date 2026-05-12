import React, { useMemo, useRef } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { useSdkContext } from '../../contexts/SdkContext';
import { makeSdkLogStyles } from './styles';

const SDK_LEVEL_NAMES = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export function SdkLogsScreen() {
  const { c, tr }              = useAppContext();
  const { sdkLogs, clearSdkLogs } = useSdkContext();
  const sl = useMemo(() => makeSdkLogStyles(c), [c]);

  const scrollRef = useRef<ScrollView>(null);

  const levelColor = (l: number) =>
    l >= 4 ? c.error : l === 3 ? c.warn : l === 2 ? c.sdkLog : c.textMuted;

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: c.bg }}>
      <View style={sl.toolbar}>
        <Text style={sl.hint}>{tr.sdkLogHint(sdkLogs.length)}</Text>
        <TouchableOpacity onPress={clearSdkLogs}>
          <Text style={sl.clearBtn}>{tr.btnClear}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        style={sl.logBox}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        {sdkLogs.length === 0 ? (
          <Text style={sl.placeholder}>{tr.logSdkPlaceholder}</Text>
        ) : (
          sdkLogs.map(e => (
            <Text key={e.id} style={[sl.line, { color: levelColor(e.level) }]}>
              <Text style={sl.time}>{e.time} </Text>
              <Text style={sl.lbl}>[{SDK_LEVEL_NAMES[e.level] ?? e.level}] </Text>
              {e.msg}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}
