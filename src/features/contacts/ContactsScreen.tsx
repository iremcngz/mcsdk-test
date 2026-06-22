import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { initDb, getAllContacts, seedContacts, type Contact } from '../../core/db';
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

const GROUPS = ['group1', 'group2', 'group3', 'group4', 'group5', 'group6', 'group7'];

// ── Screen ────────────────────────────────────────────────────────────────────

export function ContactsScreen() {
  const { c } = useAppContext();
  const { startCall } = useCallContext();
  const { setScreen } = useNavigation();
  const cs            = useMemo(() => makeContactsStyles(c), [c]);
  const PRESENCE_COLOR = useMemo(() => makePresenceColors(c), [c]);
  const insets        = useSafeAreaInsets();

  const [contacts,   setContacts]   = useState<Contact[]>([]);
  const [query,      setQuery]      = useState('');
  const [filter,     setFilter]     = useState<ContactFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [presence,   setPresence]   = useState<Record<number, PresenceStatus>>({});
  const [callInfo,   setCallInfo]   = useState<Record<number, CallInfo>>({});
  const [userInfo,   setUserInfo]   = useState<Record<number, UserInfo>>({});

  useEffect(() => {
    initDb().then(async () => {
      await seedContacts();
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
    });
  }, []);

  const groupContacts: GroupItem[] = useMemo(() =>
    GROUPS.map((g, i) => ({
      id: -(i + 1),
      name: g,
      sip_uri: `${g}@test.com`,
      notes: '',
      created_at: 0,
      __isGroup: true as const,
    })),
  []);

  const allItems = useMemo(() => {
    const people: (Contact | GroupItem)[] = filter === 'groups' ? [] : contacts;
    const groups: (Contact | GroupItem)[] = filter === 'people' ? [] : groupContacts;
    return [...people, ...groups];
  }, [contacts, groupContacts, filter]);

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
                    setScreen('callactive');
                  }}>
                  <Text style={cs.duplexBtnText}>Half Duplex AC</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[cs.duplexBtn, cs.duplexFull]}
                  onPress={() => {
                    startCall(item.name, item.sip_uri, 'full_duplex', 'auto');
                    setScreen('callactive');
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
                  setScreen('callactive');
                }}>
                <Text style={cs.duplexBtnText}>Half Duplex AC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.duplexBtn, cs.duplexFull]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'full_duplex', 'auto');
                  setScreen('callactive');
                }}>
                <Text style={cs.duplexBtnText}>Full Duplex AC</Text>
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
  }, [cs, presence, selectedId, callInfo, userInfo, handleSelect, startCall, setScreen]);

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
      </View>

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
            <Text style={cs.emptyText}>{filter === 'groups' ? 'No groups found.' : 'No contacts found.'}</Text>
          </View>
        }
      />
    </View>
  );
}
