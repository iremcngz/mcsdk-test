import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
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

// ── Screen ────────────────────────────────────────────────────────────────────

export function ContactsScreen() {
  const { c } = useAppContext();
  const cs            = useMemo(() => makeContactsStyles(c), [c]);
  const PRESENCE_COLOR = useMemo(() => makePresenceColors(c), [c]);
  const insets        = useSafeAreaInsets();

  const [contacts,   setContacts]   = useState<Contact[]>([]);
  const [query,      setQuery]      = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [presence,   setPresence]   = useState<Record<number, PresenceStatus>>({});
  const [callbacks,  setCallbacks]  = useState<Record<number, CallbackInfo>>({});

  useEffect(() => {
    initDb().then(async () => {
      await seedContacts();
      const rows = await getAllContacts();
      setContacts(rows);
      const p: Record<number, PresenceStatus> = {};
      rows.forEach(r => { p[r.id] = mockPresence(r.id); });
      setPresence(p);
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
              <TouchableOpacity style={[cs.mcBtn, cs.mcHalf]}>
                <Text style={cs.mcBtnText}>Half Duplex MC</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[cs.mcBtn, cs.mcFull]}>
                <Text style={cs.mcBtnText}>Full Duplex MC</Text>
              </TouchableOpacity>
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
  }, [cs, presence, selectedId, callbacks, handleSelect, handlePlaceRequest]);

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
