/**
 * features/talk/components/GroupSelector.tsx
 *
 * Horizontal scroller of group avatars at the top of TalkScreen. Highlights
 * the selected group, colors active calls (talking = green, occupied = red,
 * active = primary), and shows a pulsing badge for incoming calls.
 */

import React from 'react';
import { Animated, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ThemePalette } from '../../../core/theme';
import type { GroupCallState } from '../../../contexts/TalkContext';
import type { makeTalkStyles } from '../styles';

type TalkStyles = ReturnType<typeof makeTalkStyles>;

interface GroupSelectorProps {
  styles: TalkStyles;
  c: ThemePalette;
  orderedGroups: string[];
  groupCalls: Record<string, GroupCallState>;
  selectedGroup: string;
  incomingCalls: Set<string>;
  incomingPulse: Animated.Value;
  onSelectGroup: (group: string) => void;
}

export function GroupSelector({
  styles,
  c,
  orderedGroups,
  groupCalls,
  selectedGroup,
  incomingCalls,
  incomingPulse,
  onSelectGroup,
}: GroupSelectorProps) {
  return (
    <ScrollView
      style={styles.groupsScroll}
      contentContainerStyle={styles.groupsContainer}
      horizontal
      showsHorizontalScrollIndicator={false}>
      {orderedGroups.map(group => {
        const gs = groupCalls[group];
        const groupColor = gs?.callActive
          ? (gs.isHolding && gs.pushState === 'accepted' ? c.success
            : gs.pushState === 'occupied' ? c.error
            : c.primary)
          : undefined;
        const isActiveGroup = group === selectedGroup;
        const avatarSize = isActiveGroup ? 72 : 52;
        const iconPersonSize = isActiveGroup ? 1.2 : 1;
        return (
          <View key={group} style={[styles.groupCol, isActiveGroup && { marginRight: 22 }]}>
            <View style={[styles.groupAvatarWrap, !isActiveGroup && { opacity: 0.55 }]}>
              <TouchableOpacity
                onPress={() => onSelectGroup(group)}
                activeOpacity={0.8}
                style={[
                  styles.groupAvatar,
                  {
                    width: avatarSize,
                    height: avatarSize,
                    borderRadius: avatarSize / 2,
                  },
                  groupColor
                    ? { backgroundColor: groupColor, borderColor: groupColor }
                    : isActiveGroup && {
                        backgroundColor: c.surface,
                        borderColor: c.textPrimary,
                        borderWidth: 3,
                        shadowColor: c.textPrimary,
                        shadowOpacity: 0.35,
                        shadowRadius: 10,
                        elevation: 6,
                      },
                ]}
                testID={`talk-group-${group}`}>
                <View style={[styles.groupIconWrap, { transform: [{ scale: iconPersonSize }] }]}>
                  <View style={styles.groupIconPerson}>
                    <View style={[styles.groupIconHead, { backgroundColor: groupColor || isActiveGroup ? c.textPrimary : c.textSecondary }]} />
                    <View style={[styles.groupIconBody, { backgroundColor: groupColor || isActiveGroup ? c.textPrimary : c.textSecondary }]} />
                  </View>
                  <View style={[styles.groupIconPerson, { marginLeft: -5 }]}>
                    <View style={[styles.groupIconHead, { backgroundColor: groupColor || isActiveGroup ? c.textPrimary + '80' : c.textMuted }]} />
                    <View style={[styles.groupIconBody, { backgroundColor: groupColor || isActiveGroup ? c.textPrimary + '80' : c.textMuted }]} />
                  </View>
                </View>
              </TouchableOpacity>
              {incomingCalls.has(group) && !groupCalls[group]?.callActive && (
                <Animated.View testID={`talk-incoming-badge-${group}`} pointerEvents="none" style={[styles.incomingBadge, { opacity: incomingPulse }]} />
              )}
            </View>
            <Text style={[
              styles.groupLabel,
              isActiveGroup && styles.groupLabelActive,
              isActiveGroup && { fontSize: 13, fontWeight: '900', marginTop: 6 },
            ]}>{group}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
