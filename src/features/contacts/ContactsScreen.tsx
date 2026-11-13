import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useTalkContext } from '../../contexts/TalkContext';
import { initDb, getAllContacts, insertContact, seedContacts, type Contact } from '../../core/db';
import { AuthSettings } from '../../core/settings';
import { displayMcId, toMcpttUri } from '../calls/mcId';
import { makeContactsStyles } from './styles';
import type {
  ContactFilter,
  GroupItem,
  PresenceStatus,
  CallStatus,
  ContactCallType,
  CallInfo,
  UserInfo,
} from './types';
import {
  mockPresence,
  makePresenceColors,
  mockCallStatus,
  mockCallType,
  mockLastCallDate,
  mockLastOnline,
  mockUserStatus,
} from './mockData';

/** Case- and accent-insensitive enough for the names the server hands out. */
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

// ── Screen ────────────────────────────────────────────────────────────────────

export function ContactsScreen() {
  const { c, tr } = useAppContext();
  const { startCall, startVideoCall } = useCallContext();
  const { setScreen } = useNavigation();
  // The groups the server provisioned for this user (SdkListener::onGroupsUpdated),
  // in place of the seven `group1`..`group7` placeholders this list used to show.
  // Empty until registration completes, which the Groups empty state covers.
  const { groups: sdkGroups } = useTalkContext();
  const cs            = useMemo(() => makeContactsStyles(c), [c]);
  const PRESENCE_COLOR = useMemo(() => makePresenceColors(c), [c]);
  const insets        = useSafeAreaInsets();

  const [contacts,   setContacts]   = useState<Contact[]>([]);
  const [query,      setQuery]      = useState('');
  // People by default: the groups are on the Talk screen, and a call is placed
  // from here against a person.
  const [filter,     setFilter]     = useState<ContactFilter>('people');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [presence,   setPresence]   = useState<Record<number, PresenceStatus>>({});
  const [callInfo,   setCallInfo]   = useState<Record<number, CallInfo>>({});
  const [userInfo,   setUserInfo]   = useState<Record<number, UserInfo>>({});

  const [adding,   setAdding]   = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newUri,   setNewUri]   = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    const rows = await getAllContacts();
    setContacts(rows);
    const p: Record<number, PresenceStatus> = {};
    const ci: Record<number, CallInfo> = {};
    const ui: Record<number, UserInfo> = {};
    rows.forEach(r => {
      p[r.id] = mockPresence(r.id);
      ci[r.id] = {
        callStatus: mockCallStatus(r.id),
        callType: mockCallType(r.id),
        lastCall: mockLastCallDate(r.id),
      };
      ui[r.id] = {
        userStatus: mockUserStatus(r.id),
        lastOnline: mockLastOnline(r.id),
      };
    });
    setPresence(p);
    setCallInfo(ci);
    setUserInfo(ui);
  }, []);

  useEffect(() => {
    initDb().then(async () => {
      await seedContacts();
      await loadContacts();
    });
  }, [loadContacts]);

  const closeAddForm = useCallback(() => {
    setAdding(false);
    setNewName('');
    setNewUri('');
    setAddError(null);
  }, []);

  // A bare MC ID is completed to the server's URI form; shown before saving so
  // the address that will actually be dialled is never a surprise.
  const newSipUri = useMemo(() => toMcpttUri(newUri), [newUri]);

  const saveContact = useCallback(async () => {
    const name = newName.trim();
    if (!name || !newSipUri) {
      setAddError(tr.contactErrRequired);
      return;
    }
    const existing = contacts.find(ct => ct.sip_uri.toLowerCase() === newSipUri.toLowerCase());
    if (existing) {
      setAddError(tr.contactErrDuplicate(existing.name));
      return;
    }
    const id = await insertContact(name, newSipUri, '');
    await loadContacts();
    closeAddForm();
    // Opened on arrival, so the call buttons are one tap away.
    setQuery('');
    setFilter(f => (f === 'groups' ? 'all' : f));
    setSelectedId(id);
  }, [newName, newSipUri, contacts, tr, loadContacts, closeAddForm]);

  /**
   * The SDK's groups as list rows. Negative ids keep them from colliding with
   * the SQLite contact ids the list keys and the selection are built on; the
   * index is used rather than a hash of the group id so the id stays stable
   * and small, and the list is sorted before the ids are handed out so a row
   * does not change id when the server sends the list in another order.
   *
   * `name` may be empty (McSdkGroupInfo) — the group id is the fallback, which
   * is also what the detail panel dials.
   */
  const groupContacts: GroupItem[] = useMemo(() =>
    [...sdkGroups]
      .map(g => ({ groupId: g.groupId, name: g.name || g.groupId }))
      .sort(byName)
      .map((g, i) => ({
        id: -(i + 1),
        name: g.name,
        sip_uri: g.groupId,
        notes: '',
        created_at: 0,
        __isGroup: true as const,
      })),
  [sdkGroups]);

  /**
   * The user themselves is dropped from the list: a contact row's only purpose
   * is to call that person, and the server refuses a call to oneself. Matched
   * on the MC ID rather than the whole URI, since the stored row carries the
   * MCPTT form (`sip:mcptt.mcuser-111@…`) while what we know is the bare login
   * name the user typed — and the name column is matched too, because that is
   * what the seed rows are called.
   */
  const peopleContacts = useMemo(() => {
    const me = AuthSettings.getLastUsername()?.trim().toLowerCase();
    const rows = me
      ? contacts.filter(ct =>
          displayMcId(ct.sip_uri).toLowerCase() !== me
          && ct.name.trim().toLowerCase() !== me)
      : contacts;
    return [...rows].sort(byName);
  }, [contacts]);

  const allItems = useMemo(() => {
    const people: (Contact | GroupItem)[] = filter === 'groups' ? [] : peopleContacts;
    const groups: (Contact | GroupItem)[] = filter === 'people' ? [] : groupContacts;
    return [...people, ...groups];
  }, [peopleContacts, groupContacts, filter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(item =>
      item.name.toLowerCase().includes(q),
    );
  }, [allItems, query]);

  const isGroup = (item: Contact | GroupItem): item is GroupItem =>
    '__isGroup' in item;

  const handleSelect = useCallback((id: number) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  const renderItem = useCallback(({ item }: { item: Contact | GroupItem }) => {
    const g = isGroup(item);
    const isSelected = selectedId === item.id;

    if (g) {
      return (
        <View>
          <TouchableOpacity
            style={[cs.row, isSelected && cs.rowSelected]}
            onPress={() => handleSelect(item.id)}
            activeOpacity={0.75}>
            <Text style={cs.groupIcon}>👥</Text>
            <Text style={cs.rowName} numberOfLines={1}>{item.name}</Text>
            <Text style={cs.chevron}>{isSelected ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {isSelected && (
            <View style={cs.detail}>
              <Text style={cs.detailName}>{item.name}</Text>
              <Text style={cs.detailUri}>{item.sip_uri}</Text>

              <View style={cs.mcRow}>
                <TouchableOpacity
                  style={[cs.mcBtn, cs.mcHalf]}
                  onPress={() => {
                    startCall(item.name, item.sip_uri, 'half_duplex', 'manual');
                    setScreen('incall');
                  }}>
                  <Text style={cs.mcBtnText}>Half Duplex MC</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cs.mcBtn, cs.mcFull]}
                  onPress={() => {
                    startCall(item.name, item.sip_uri, 'full_duplex', 'manual');
                    setScreen('incall');
                  }}>
                  <Text style={cs.mcBtnText}>Full Duplex MC</Text>
                </TouchableOpacity>
              </View>

              <View style={cs.duplexRow}>
                <TouchableOpacity
                  style={[cs.duplexBtn, cs.duplexHalf]}
                  onPress={() => {
                    startCall(item.name, item.sip_uri, 'half_duplex', 'auto');
                    setScreen('incall');
                  }}>
                  <Text style={cs.duplexBtnText}>Half Duplex AC</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cs.duplexBtn, cs.duplexFull]}
                  onPress={() => {
                    startCall(item.name, item.sip_uri, 'full_duplex', 'auto');
                    setScreen('incall');
                  }}>
                  <Text style={cs.duplexBtnText}>Full Duplex AC</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      );
    }

    const pStatus    = presence[item.id] ?? 'offline';
    const ci         = callInfo[item.id] ?? { callStatus: 'idle' as CallStatus, callType: 'none' as ContactCallType, lastCall: null };
    const ui         = userInfo[item.id] ?? { userStatus: 'offline' as PresenceStatus, lastOnline: null };

    return (
      <View>
        <TouchableOpacity
          style={[cs.row, isSelected && cs.rowSelected]}
          onPress={() => handleSelect(item.id)}
          activeOpacity={0.75}>
          <View style={[cs.presenceDot, { backgroundColor: PRESENCE_COLOR[pStatus] }]} />
          <Text style={cs.rowName} numberOfLines={1}>{item.name}</Text>
          <Text style={cs.presenceLabel}>{pStatus}</Text>
          <Text style={cs.chevron}>{isSelected ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {isSelected && (
          <View style={cs.detail}>
            <Text style={cs.detailName}>{item.name}</Text>
            <Text style={cs.detailUri}>{item.sip_uri}</Text>

            <View style={cs.mcRow}>
              <TouchableOpacity
                style={[cs.mcBtn, cs.mcHalf]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'half_duplex', 'manual');
                  setScreen('incall');
                }}>
                <Text style={cs.mcBtnText}>Half Duplex MC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.mcBtn, cs.mcFull]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'full_duplex', 'manual');
                  setScreen('incall');
                }}>
                <Text style={cs.mcBtnText}>Full Duplex MC</Text>
              </TouchableOpacity>
            </View>

            <View style={cs.duplexRow}>
              <TouchableOpacity
                style={[cs.duplexBtn, cs.duplexHalf]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'half_duplex', 'auto');
                  setScreen('incall');
                }}>
                <Text style={cs.duplexBtnText}>Half Duplex AC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.duplexBtn, cs.duplexFull]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'full_duplex', 'auto');
                  setScreen('incall');
                }}>
                <Text style={cs.duplexBtnText}>Full Duplex AC</Text>
              </TouchableOpacity>
            </View>

            {/* MCVideo private calls: video both ways, no audio. MC rings the
                other phone, AC is answered by it. */}
            <View style={cs.videoRow}>
              <TouchableOpacity
                testID="contact-video-mc"
                style={[cs.videoBtn, cs.videoMc]}
                onPress={() => {
                  startVideoCall(item.name, item.sip_uri, 'manual');
                  setScreen('incall');
                }}>
                <Text style={cs.videoMcText}>🎥 {tr.contactVideoMc}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="contact-video-ac"
                style={[cs.videoBtn, cs.videoAc]}
                onPress={() => {
                  startVideoCall(item.name, item.sip_uri, 'auto');
                  setScreen('incall');
                }}>
                <Text style={cs.videoAcText}>🎥 {tr.contactVideoAc}</Text>
              </TouchableOpacity>
            </View>

            <View style={cs.infoSection}>
              <Text style={cs.infoSectionTitle}>Call Info</Text>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>Call Status</Text>
                <Text style={[cs.infoValue, ci.callStatus === 'active' ? cs.infoActive : ci.callStatus === 'missed' ? cs.infoMissed : undefined]}>{ci.callStatus}</Text>
              </View>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>Last Call</Text>
                <Text style={cs.infoValue}>{ci.lastCall ? ci.lastCall.toLocaleString() : '—'}</Text>
              </View>
            </View>

            <View style={cs.infoSection}>
              <Text style={cs.infoSectionTitle}>User Info</Text>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>User Status</Text>
                <Text style={[cs.infoValue, ui.userStatus === 'online' ? cs.infoActive : undefined]}>{ui.userStatus}</Text>
              </View>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>Last Online</Text>
                <Text style={cs.infoValue}>{ui.lastOnline ? ui.lastOnline.toLocaleString() : '—'}</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  }, [cs, PRESENCE_COLOR, presence, selectedId, callInfo, userInfo, handleSelect, startCall, startVideoCall, setScreen, tr]);

  const filterTabs: { key: ContactFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'people', label: 'People' },
    { key: 'groups', label: 'Groups' },
  ];

  return (
    <View style={[cs.root, { paddingBottom: insets.bottom }]}>
      {/* Search bar */}
      <View style={cs.searchBar}>
        <Text style={cs.searchIcon}>🔍</Text>
        <TextInput
          style={cs.searchInput}
          placeholder="Search contacts…"
          placeholderTextColor={c.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        <TouchableOpacity
          style={cs.addBtn}
          onPress={() => (adding ? closeAddForm() : setAdding(true))}
          accessibilityLabel={tr.btnSaveContact}
          activeOpacity={0.7}>
          <Text style={cs.addBtnText}>{adding ? '×' : '＋'}</Text>
        </TouchableOpacity>
      </View>

      {adding && (
        <View style={cs.addForm}>
          <Text style={cs.addTitle}>{tr.contactAddTitle}</Text>
          <Text style={cs.addLabel}>{tr.inputName}</Text>
          <TextInput
            style={cs.addInput}
            value={newName}
            onChangeText={t => { setNewName(t); setAddError(null); }}
            placeholder="mcuser-222"
            placeholderTextColor={c.textMuted}
            autoCapitalize="words"
          />
          <Text style={cs.addLabel}>MC ID / {tr.inputSipUri}</Text>
          <TextInput
            style={cs.addInput}
            value={newUri}
            onChangeText={t => { setNewUri(t); setAddError(null); }}
            placeholder={tr.contactUriPlaceholder}
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          {!!newSipUri && <Text style={cs.addPreview}>{tr.contactWillCall(newSipUri)}</Text>}
          {!!addError && <Text style={cs.addError}>{addError}</Text>}
          <View style={cs.addActions}>
            <TouchableOpacity style={[cs.addAction, cs.addCancel]} onPress={closeAddForm}>
              <Text style={cs.addCancelText}>{tr.contactCancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[cs.addAction, cs.addSave]} onPress={saveContact}>
              <Text style={cs.addSaveText}>{tr.btnSaveContact}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Filter tabs */}
      <View style={cs.filterRow}>
        {filterTabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => { setFilter(tab.key); setSelectedId(null); }}
            activeOpacity={0.7}
            style={[cs.filterTab, filter === tab.key && cs.filterTabActive]}>
            <Text style={[cs.filterTabText, filter === tab.key && cs.filterTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={cs.countText}>
        {filtered.length} {filter === 'groups' ? 'group' : 'contact'}{filtered.length !== 1 ? 's' : ''}
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={cs.emptyWrap}>
            <Text style={cs.emptyIcon}>{filter === 'groups' ? '👥' : '👤'}</Text>
            <Text style={cs.emptyText}>
              {filter === 'groups' && !query.trim()
                ? tr.contactGroupsPending
                : filter === 'groups' ? 'No groups found.' : 'No contacts found.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}
