import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { makeCommonStyles } from '../../shared/commonStyles';
import { getLogFilePaths, deleteLogFiles } from '../../core/logger';
import {
  VIDEO_BITRATE_OPTIONS,
  VIDEO_FRAME_RATE_OPTIONS,
  VIDEO_KEY_FRAME_OPTIONS,
  VideoTuningSettings,
  type AppTheme,
  type AppLanguage,
  type VideoTuning,
} from '../../core/settings';
import { VideoSession } from '../../core/videoSession';

export function SettingsScreen() {
  const {
    c, tr, theme, language,
    maxFileSize, maxFiles,
    setTheme, setLanguage, setMaxFileSize, setMaxFiles,
    stayLoggedIn, setStayLoggedIn, logout,
  } = useAppContext();

  const s = useMemo(() => makeCommonStyles(c), [c]);
  const [logPaths, setLogPaths] = useState<string[]>([]);
  const [video, setVideo] = useState<VideoTuning>(() => VideoTuningSettings.load());

  // Saved and handed to the native side at once: freezeOnLoss reaches a running
  // receiver now; the encoder's three take effect at the next camera start.
  const updateVideo = useCallback((patch: Partial<VideoTuning>) => {
    setVideo(prev => {
      const next = { ...prev, ...patch };
      VideoTuningSettings.save(next);
      VideoSession.applyTuning(next);
      return next;
    });
  }, []);

  // Auto-load paths on mount so the user sees them immediately.
  useEffect(() => {
    getLogFilePaths().then(setLogPaths);
  }, []);

  const loadPaths = useCallback(async () => {
    const paths = await getLogFilePaths();
    setLogPaths(paths);
  }, []);

  const handleDeleteLogs = useCallback(async () => {
    Alert.alert(tr.alertDeleteTitle, tr.alertDeleteMessage, [
      { text: tr.alertCancel, style: 'cancel' },
      {
        text: tr.alertDelete, style: 'destructive', onPress: async () => {
          await deleteLogFiles();
          setLogPaths([]);
        },
      },
    ]);
  }, [tr]);

  const SIZE_OPTS: { bytes: number; label: string }[] = [
    { bytes: 12 * 1024,       label: '12 KB' },
    { bytes: 1 * 1024 * 1024, label: tr.fileSizeLabel(1) },
    { bytes: 2 * 1024 * 1024, label: tr.fileSizeLabel(2) },
    { bytes: 5 * 1024 * 1024, label: tr.fileSizeLabel(5) },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16 }}>

      {/* Account */}
      <Text style={s.sectionTitle}>{tr.sectionAccount}</Text>
      <View style={s.card}>
        <View style={s.switchRow}>
          <Text style={s.switchLabel}>{tr.cardStayLoggedIn}</Text>
          <Switch
            value={stayLoggedIn}
            onValueChange={setStayLoggedIn}
            trackColor={{ true: c.accent }}
          />
        </View>
        <TouchableOpacity
          style={[s.seg, { borderColor: c.error, marginTop: 10 }]}
          onPress={logout}>
          <Text style={[s.segText, { color: c.error }]}>{tr.btnLogout}</Text>
        </TouchableOpacity>
      </View>

      {/* App appearance */}
      <Text style={s.sectionTitle}>{tr.sectionAppearance}</Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardTheme}</Text>
        <View style={s.segRow}>
          {(['dark', 'light'] as AppTheme[]).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.seg, theme === t && s.segActive]}
              onPress={() => setTheme(t)}>
              <Text style={[s.segText, theme === t && s.segTextActive]}>
                {t === 'dark' ? tr.themeDark : tr.themeLight}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.cardTitle, { marginTop: 12 }]}>{tr.cardLanguage}</Text>
        <View style={s.segRow}>
          {(['tr', 'en'] as AppLanguage[]).map(l => (
            <TouchableOpacity
              key={l}
              style={[s.seg, language === l && s.segActive]}
              onPress={() => setLanguage(l)}>
              <Text style={[s.segText, language === l && s.segTextActive]}>
                {l === 'tr' ? tr.langTr : tr.langEn}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Video */}
      <Text style={s.sectionTitle}>{tr.sectionVideo}</Text>
      <View style={s.card} testID="settings-video">
        <Text style={s.cardTitle}>{tr.cardVideoBitrate}</Text>
        <View style={s.segRow}>
          {VIDEO_BITRATE_OPTIONS.map(kbps => (
            <TouchableOpacity
              key={kbps}
              testID={`settings-video-bitrate-${kbps}`}
              style={[s.seg, video.bitrateKbps === kbps && s.segActive]}
              onPress={() => updateVideo({ bitrateKbps: kbps })}>
              <Text style={[s.segText, video.bitrateKbps === kbps && s.segTextActive]}>
                {`${kbps} kbps`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.cardTitle, { marginTop: 12 }]}>{tr.cardVideoFrameRate}</Text>
        <View style={s.segRow}>
          {VIDEO_FRAME_RATE_OPTIONS.map(fps => (
            <TouchableOpacity
              key={fps}
              testID={`settings-video-fps-${fps}`}
              style={[s.seg, video.frameRate === fps && s.segActive]}
              onPress={() => updateVideo({ frameRate: fps })}>
              <Text style={[s.segText, video.frameRate === fps && s.segTextActive]}>
                {`${fps} fps`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.cardTitle, { marginTop: 12 }]}>{tr.cardVideoKeyFrame}</Text>
        <View style={s.segRow}>
          {VIDEO_KEY_FRAME_OPTIONS.map(sec => (
            <TouchableOpacity
              key={sec}
              testID={`settings-video-keyframe-${sec}`}
              style={[s.seg, video.keyFrameIntervalSeconds === sec && s.segActive]}
              onPress={() => updateVideo({ keyFrameIntervalSeconds: sec })}>
              <Text style={[s.segText, video.keyFrameIntervalSeconds === sec && s.segTextActive]}>
                {tr.videoSecondsLabel(sec)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.settingsNote}>{tr.videoTuningNote}</Text>

        <View style={[s.switchRow, { marginTop: 12 }]}>
          <Text style={s.switchLabel}>{tr.videoFreezeOnLoss}</Text>
          <Switch
            testID="settings-video-freeze"
            value={video.freezeOnLoss}
            onValueChange={v => updateVideo({ freezeOnLoss: v })}
            trackColor={{ true: c.accent }}
          />
        </View>
        <Text style={s.settingsNote}>{tr.videoFreezeOnLossNote}</Text>
      </View>

      {/* Log rotation */}
      <Text style={s.sectionTitle}>{tr.sectionLogRotation}</Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>{tr.cardMaxFileSize}</Text>
        <View style={s.segRow}>
          {SIZE_OPTS.map(opt => (
            <TouchableOpacity
              key={opt.bytes}
              style={[s.seg, maxFileSize === opt.bytes && s.segActive]}
              onPress={() => setMaxFileSize(opt.bytes)}>
              <Text style={[s.segText, maxFileSize === opt.bytes && s.segTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[s.cardTitle, { marginTop: 12 }]}>{tr.cardMaxKeptFiles}</Text>
        <View style={s.segRow}>
          {[0, 2, 3, 5].map(n => (
            <TouchableOpacity
              key={n}
              style={[s.seg, maxFiles === n && s.segActive]}
              onPress={() => setMaxFiles(n)}>
              <Text style={[s.segText, maxFiles === n && s.segTextActive]}>
                {tr.filesCountLabel(n)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.settingsNote}>{tr.settingsFileNote}</Text>
      </View>

      {/* Log files */}
      <Text style={s.sectionTitle}>{tr.sectionLogFiles}</Text>
      <View style={s.card}>
        <View style={s.segRow}>
          <TouchableOpacity style={[s.seg, s.segActive]} onPress={loadPaths}>
            <Text style={[s.segText, s.segTextActive]}>{tr.btnShowPaths}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.seg, { borderColor: c.error }]} onPress={handleDeleteLogs}>
            <Text style={[s.segText, { color: c.error }]}>{tr.btnDeleteAll}</Text>
          </TouchableOpacity>
        </View>
        {logPaths.map((p, i) => (
          <Text key={i} style={s.pathText}>{p}</Text>
        ))}
        {logPaths.length === 0 && (
          <Text style={s.settingsNote}>{tr.logPathsNote}</Text>
        )}
      </View>

    </ScrollView>
  );
}
