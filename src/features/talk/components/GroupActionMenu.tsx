/**
 * features/talk/components/GroupActionMenu.tsx
 *
 * Dropdown menu (alert / imminent peril / emergency / details / mute) shown
 * from TalkScreen's header. Extracted from TalkScreen to keep that screen
 * focused on call/PTT state.
 */

import React from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import type { makeTalkStyles } from '../styles';
import type { Translations } from '../../../core/i18n';

type TalkStyles = ReturnType<typeof makeTalkStyles>;

interface GroupActionMenuProps {
  styles: TalkStyles;
  tr: Translations;
  onClose: () => void;
  onToggleMute: () => void;
}

export function GroupActionMenu({ styles, tr, onClose, onToggleMute }: GroupActionMenuProps) {
  const items = [
    { key: 'alert',          label: tr.talkMenuStartAlert },
    { key: 'imminent_peril', label: tr.talkMenuStartImminentPeril },
    { key: 'emergency',      label: tr.talkMenuStartEmergency },
    { key: 'details',        label: tr.talkMenuGroupDetails },
    { key: 'mute',           label: tr.talkMenuMuteOff },
  ];

  return (
    <View style={styles.menuOverlayContainer}>
      <Pressable style={styles.menuBackdrop} onPress={onClose} />
      <View style={styles.menuCard}>
        {items.map(item => (
          <TouchableOpacity
            key={item.key}
            onPress={() => {
              if (item.key === 'mute') {
                onToggleMute();
              }
              onClose();
            }}
            activeOpacity={0.7}
            style={styles.menuItem}
            testID={`talk-group-menu-${item.key}`}>
            <Text style={styles.menuItemText}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
