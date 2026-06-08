import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useCallContext } from '../../contexts/CallContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { ThemePalette } from '../../core/theme';
import { initDb, getAllContacts, seedContacts, type Contact } from '../../core/db';
import { makeContactsStyles } from './styles';

// ── Presence ──────────────────────────────────────────────────────────────────

type PresenceStatus = 'online' | 'busy' | 'away' | 'offline';

function mockPresence(id: number): PresenceStatus {
  const statuses: PresenceStatus[] = ['online', 'busy', 'away', 'offline'];
  return statuses[id % statuses.length];
}

function makePresenceColors(c: ThemePalette): Record<PresenceStatus, string> {
  return {
    online:  c.success,
    busy:    c.error,
    away:    c.warn,
    offline: c.presenceOffline,
  };
}

// ── Callback ──────────────────────────────────────────────────────────────────

type CallbackStatus = 'pending' | 'accepted' | 'rejected' | 'none';

interface CallbackInfo {
  status: CallbackStatus;
  lastCallback: Date | null;
}

// ── Call Info / User Info ─────────────────────────────────────────────────────

type CallStatus = 'idle' | 'active' | 'missed' | 'ended';
type CallType = 'half_duplex' | 'full_duplex' | 'none';

interface CallInfo {
  callStatus: CallStatus;
  callType: CallType;
  lastCall: Date | null;
}

interface UserInfo {
  userStatus: PresenceStatus;
  lastOnline: Date | null;
}

function mockCallStatus(id: number): CallStatus {
  const statuses: CallStatus[] = ['idle', 'active', 'missed', 'ended'];
  return statuses[(id * 2) % statuses.length];
}

function mockCallType(id: number): CallType {
  const types: CallType[] = ['half_duplex', 'full_duplex', 'none'];
  return types[id % types.length];
}

function mockLastCallDate(id: number): Date {
  const now = Date.now();
  const offsets = [0, 3600000, 86400000, 172800000, 604800000];
  return new Date(now - offsets[id % offsets.length]);
}

function mockLastOnline(id: number): Date {
  const now = Date.now();
  const offsets = [300000, 3600000, 43200000, 86400000, 172800000];
  return new Date(now - offsets[id % offsets.length]);
}

function mockUserStatus(id: number): PresenceStatus {
  const statuses: PresenceStatus[] = ['online', 'away', 'busy', 'offline'];
  return statuses[(id * 3) % statuses.length];
}

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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [presence,   setPresence]   = useState<Record<number, PresenceStatus>>({});
  const [callbacks,  setCallbacks]  = useState<Record<number, CallbackInfo>>({});
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(ct =>
      ct.name.toLowerCase().includes(q) ||
      ct.sip_uri.toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const handleSelect = useCallback((id: number) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  const handlePlaceRequest = useCallback((id: number) => {
    setCallbacks(prev => ({
      ...prev,
      [id]: { status: 'pending', lastCallback: new Date() },
    }));
  }, []);

  const renderItem = useCallback(({ item }: { item: Contact }) => {
    const pStatus    = presence[item.id] ?? 'offline';
    const isSelected = selectedId === item.id;
    const cb         = callbacks[item.id] ?? { status: 'none' as CallbackStatus, lastCallback: null };
    const ci         = callInfo[item.id] ?? { callStatus: 'idle' as CallStatus, callType: 'none' as CallType, lastCall: null };
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

            {/* MC Buttons */}
            <View style={cs.mcRow}>
              <TouchableOpacity
                style={[cs.mcBtn, cs.mcHalf]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'half_duplex');
                  setScreen('calls');
                }}>
                <Text style={cs.mcBtnText}>Half Duplex MC</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.mcBtn, cs.mcFull]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'full_duplex');
                  setScreen('calls');
                }}>
                <Text style={cs.mcBtnText}>Full Duplex MC</Text>
              </TouchableOpacity>
            </View>

            {/* Duplex Call Buttons */}
            <View style={cs.duplexRow}>
              <TouchableOpacity
                style={[cs.duplexBtn, cs.duplexHalf]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'half_duplex');
                  setScreen('calls');
                }}>
                <Text style={cs.duplexBtnText}>Half Duplex</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.duplexBtn, cs.duplexFull]}
                onPress={() => {
                  startCall(item.name, item.sip_uri, 'full_duplex');
                  setScreen('calls');
                }}>
                <Text style={cs.duplexBtnText}>Full Duplex</Text>
              </TouchableOpacity>
            </View>

            {/* Call Info */}
            <View style={cs.infoSection}>
              <Text style={cs.infoSectionTitle}>Call Info</Text>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>Call Status</Text>
                <Text style={[cs.infoValue, ci.callStatus === 'active' ? cs.infoActive : ci.callStatus === 'missed' ? cs.infoMissed : undefined]}>{ci.callStatus}</Text>
              </View>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>Call Type</Text>
                <Text style={cs.infoValue}>{ci.callType === 'none' ? '—' : ci.callType}</Text>
              </View>
              <View style={cs.infoRow}>
                <Text style={cs.infoLabel}>Last Call</Text>
                <Text style={cs.infoValue}>{ci.lastCall ? ci.lastCall.toLocaleString() : '—'}</Text>
              </View>
            </View>

            {/* User Info */}
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

            {/* Callback section */}
            <View style={cs.callbackSection}>
              <Text style={cs.callbackTitle}>Callback</Text>
              <View style={cs.callbackInfoRow}>
                <Text style={cs.callbackLabel}>Status</Text>
                <Text style={[
                  cs.callbackValue,
                  cb.status === 'pending'  ? cs.cbPending  : undefined,
                  cb.status === 'accepted' ? cs.cbAccepted : undefined,
                  cb.status === 'rejected' ? cs.cbRejected : undefined,
                ]}>
                  {cb.status === 'none' ? '—' : cb.status}
                </Text>
              </View>
              <View style={cs.callbackInfoRow}>
                <Text style={cs.callbackLabel}>Last Callback</Text>
                <Text style={cs.callbackValue}>
                  {cb.lastCallback ? cb.lastCallback.toLocaleString() : '—'}
                </Text>
              </View>
              <TouchableOpacity
                style={cs.requestBtn}
                onPress={() => handlePlaceRequest(item.id)}>
                <Text style={cs.requestBtnText}>Place a Request</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }, [cs, presence, selectedId, callbacks, callInfo, userInfo, handleSelect, handlePlaceRequest]);

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

      <Text style={cs.countText}>
        {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={cs.emptyWrap}>
            <Text style={cs.emptyIcon}>👤</Text>
            <Text style={cs.emptyText}>No contacts found.</Text>
          </View>
        }
      />
    </View>
  );
}
