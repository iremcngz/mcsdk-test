/**
 * features/talk/components/AffiliationEditor.tsx
 *
 * Bottom sheet for choosing which groups the user is affiliated with. Opened
 * from the edit button in the TalkScreen group strip.
 *
 * The choice is per GROUP, not per service. A group's service set (PTT / video /
 * data) is fixed by its provisioning: AffiliationModule::Affiliate validates every
 * requested flag against the provisioned profile and drops the ones the group does
 * not offer, so there is nothing to decide. The chips are therefore read-only —
 * they show what the group supports — and Apply requests all of them.
 *
 * The same GroupInfo flags carry two meanings, which is why both lists are needed:
 *   - `groups`             (onGroupsUpdated)       → services the group SUPPORTS
 *   - `affiliationByGroup` (onAffiliationsUpdated) → services the affiliation COVERS,
 *                                                     used only to seed the selection
 *
 * Nothing is sent until Apply. Because Sdk::Affiliate is state-replacing, Apply
 * emits the complete desired set rather than a delta; the diff chips only tell
 * the user what will change.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { McSdkAffiliateRequest, McSdkGroupInfo } from '../../../mcsdk';
import type { ServiceFlags, McService } from '../../../contexts/TalkContext';
import { serviceFlagsOf, hasAnyService } from '../../../contexts/TalkContext';
import type { Translations } from '../../../core/i18n';
import type { makeTalkStyles } from '../styles';

type TalkStyles = ReturnType<typeof makeTalkStyles>;

const NO_SERVICES: ServiceFlags = { ptt: false, video: false, data: false };

interface AffiliationEditorProps {
  styles: TalkStyles;
  tr: Translations;
  /** Groups the user may affiliate to; flags = supported services. */
  groups: McSdkGroupInfo[];
  /** Affiliated services per group id; flags = covered services. */
  affiliationByGroup: Record<string, ServiceFlags>;
  /** False until the SDK has delivered the list (i.e. before registration). */
  groupsLoaded: boolean;
  onClose: () => void;
  onApply: (requests: McSdkAffiliateRequest[]) => void;
}

const SERVICES: McService[] = ['ptt', 'video', 'data'];

export function AffiliationEditor({
  styles,
  tr,
  groups,
  affiliationByGroup,
  groupsLoaded,
  onClose,
  onApply,
}: AffiliationEditorProps) {
  const sorted = useMemo(
    () => [...groups].sort((a, b) => (a.name || a.groupId).localeCompare(b.name || b.groupId)),
    [groups],
  );

  /** Groups affiliated right now — the starting selection. */
  const initial = useMemo(
    () => new Set(sorted.filter(g => hasAnyService(affiliationByGroup[g.groupId] ?? NO_SERVICES))
      .map(g => g.groupId)),
    [sorted, affiliationByGroup],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));

  const serviceLabel = (s: McService) =>
    s === 'ptt' ? tr.talkSvcPtt : s === 'video' ? tr.talkSvcVideo : tr.talkSvcData;

  const toggleGroup = (g: McSdkGroupInfo) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(g.groupId)) next.delete(g.groupId);
      else next.add(g.groupId);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(sorted.map(g => g.groupId)));
  const clearAll = () => setSelected(new Set());

  const { added, removed, desired } = useMemo(() => {
    const addedIds: string[] = [];
    const removedIds: string[] = [];
    const set: McSdkAffiliateRequest[] = [];

    sorted.forEach(g => {
      const want = selected.has(g.groupId);
      const have = initial.has(g.groupId);

      if (want) {
        // Always request every service the group supports. The service set is a
        // property of the group, not a user choice: the SDK validates each flag
        // against the provisioned profile and drops any service the group does
        // not offer, so asking for a subset has no meaningful use.
        const svc = serviceFlagsOf(g);
        set.push({ groupId: g.groupId, ptt: svc.ptt, video: svc.video, data: svc.data });
      }
      if (want && !have) addedIds.push(g.groupId);
      else if (!want && have) removedIds.push(g.groupId);
    });

    return { added: addedIds, removed: removedIds, desired: set };
  }, [sorted, selected, initial]);

  const dirty = added.length > 0 || removed.length > 0;
  const selectedCount = selected.size;

  return (
    <View style={styles.affOverlay}>
      <Pressable
        style={styles.affBackdrop}
        onPress={onClose}
        testID="talk-aff-backdrop"
      />
      <View style={styles.affSheet}>
        <View style={styles.affGrabber} />

        <View style={styles.affHeader}>
          <View style={styles.affHeaderText}>
            <Text style={styles.affTitle}>{tr.talkAffTitle}</Text>
            <Text style={styles.affSubtitle}>{tr.talkAffSubtitle}</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.8}
            style={styles.mockCloseButton}
            testID="talk-aff-close">
            <Text style={styles.mockCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.affCountText}>
          {tr.talkAffCount(selectedCount, sorted.length)}
        </Text>

        {sorted.length > 0 && (
          <View style={styles.affBulkRow}>
            <TouchableOpacity
              onPress={selectAll}
              activeOpacity={0.8}
              style={styles.affBulkButton}
              testID="talk-aff-select-all">
              <Text style={styles.affBulkButtonText}>{tr.talkAffSelectAll}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clearAll}
              activeOpacity={0.8}
              style={styles.affBulkButton}
              testID="talk-aff-clear-all">
              <Text style={styles.affBulkButtonText}>{tr.talkAffClearAll}</Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView style={styles.affList} showsVerticalScrollIndicator={false}>
          {sorted.length === 0 && (
            <Text style={styles.affEmptyText}>
              {groupsLoaded ? tr.talkAffEmpty : tr.talkAffNotRegistered}
            </Text>
          )}
          {sorted.map(g => {
            const supported = serviceFlagsOf(g);
            const checked = selected.has(g.groupId);
            return (
              <TouchableOpacity
                key={g.groupId}
                onPress={() => toggleGroup(g)}
                activeOpacity={0.8}
                style={[styles.affRow, checked && styles.affRowSelected]}
                testID={`talk-aff-row-${g.groupId}`}>
                <View style={styles.affRowMain}>
                  <View style={[styles.affCheck, checked && styles.affCheckSelected]}>
                    {checked && <Text style={styles.affCheckMark}>✓</Text>}
                  </View>
                  <View style={styles.affRowTextWrap}>
                    <Text style={styles.affRowName}>{g.name || g.groupId}</Text>
                    <Text style={styles.affRowId}>{g.groupId}</Text>
                  </View>
                </View>

                {/* Read-only: which MC services this group offers. A group's
                    service set is fixed by its provisioning, not chosen here —
                    affiliating always covers everything the group supports. */}
                <View style={styles.affSvcRow}>
                  {SERVICES.filter(s => supported[s]).map(s => (
                    <View
                      key={s}
                      style={[styles.affSvcChip, styles.affSvcChipOn]}
                      testID={`talk-aff-svc-${g.groupId}-${s}`}>
                      <Text style={[styles.affSvcChipText, styles.affSvcChipTextOn]}>
                        {serviceLabel(s)}
                      </Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.affDiffRow}>
          {!dirty && <Text style={styles.affDiffNone}>{tr.talkAffNoChanges}</Text>}
          {added.length > 0 && (
            <View style={[styles.affDiffChip, styles.affDiffChipAdd]} testID="talk-aff-diff-add">
              <Text style={styles.affDiffChipTextAdd}>{tr.talkAffDiffAdd(added.length)}</Text>
            </View>
          )}
          {removed.length > 0 && (
            <View style={[styles.affDiffChip, styles.affDiffChipRemove]} testID="talk-aff-diff-remove">
              <Text style={styles.affDiffChipTextRemove}>{tr.talkAffDiffRemove(removed.length)}</Text>
            </View>
          )}
        </View>

        <View style={styles.affFooter}>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.8}
            style={[styles.affFooterButton, styles.affCancelButton]}
            testID="talk-aff-cancel">
            <Text style={styles.affCancelText}>{tr.talkAffCancel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              // State-replacing: send the whole desired set, not just the diff.
              onApply(desired);
              onClose();
            }}
            disabled={!dirty}
            activeOpacity={0.8}
            style={[
              styles.affFooterButton,
              styles.affApplyButton,
              !dirty && styles.affApplyButtonDisabled,
            ]}
            testID="talk-aff-apply">
            <Text style={styles.affApplyText}>{tr.talkAffApply}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
