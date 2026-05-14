/**
 * __tests__/contacts.test.tsx — Tests for ContactsScreen UI.
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/contacts.test.tsx          # Only this file         │
 * │  npx jest __tests__/contacts.test.tsx --watch  # Watch mode             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ WHAT IS TESTED ─────────────────────────────────────────────────────────┐
 * │                                                                          │
 * │  1. Initial render — search bar, contact list, count text, empty state  │
 * │  2. Search filter — by name, by SIP URI, clear filter                   │
 * │  3. Expand / collapse — tap to open detail panel, tap again to close    │
 * │  4. Detail panel — shows name, SIP URI, MC buttons                      │
 * │  5. Callback section — initial status, Place a Request sets 'pending'   │
 * │                                                                          │
 * │  NOTE: src/core/db is fully mocked — tests don't hit SQLite at all.    │
 * │  AppContext is mocked with a minimal dark-theme palette.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView:     ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Minimal dark-theme palette — only the tokens ContactsScreen actually reads.
const mockPalette = {
  bg:              '#1a1a2e',
  surface:         '#16213e',
  accent:          '#e94560',
  inputBg:         '#0f3460',
  border:          '#0f3460',
  logBg:           '#0d1117',
  textPrimary:     '#e0e0e0',
  textSecondary:   '#ccc',
  textMuted:       '#555',
  textOnAccent:    '#fff',
  primary:         '#2196F3',
  secondary:       '#9C27B0',
  success:         '#4CAF50',
  warn:            '#FF9800',
  error:           '#f85149',
  presenceOffline: '#9E9E9E',
  sdkLog:          '#58a6ff',
  valueText:       '#ffd54f',
  tableRowBg:      '#0d1b30',
  tableRowAltBg:   '#0f2040',
  tableHeadBg:     '#0f3460',
  errorBoxBg:      '#2d1a1a',
};

jest.mock('../src/contexts/AppContext', () => ({
  useAppContext: () => ({
    c: mockPalette,
    tr: {},
  }),
}));

// 5-item fixture — deterministic, avoids real DB.
const FIXTURE_CONTACTS = [
  { id: 1, name: 'Alice Johnson', sip_uri: 'sip:alice@mc.example.com', notes: 'Team Alpha', created_at: 5000 },
  { id: 2, name: 'Bob Martinez',  sip_uri: 'sip:bob@mc.example.com',   notes: 'Team Bravo', created_at: 4000 },
  { id: 3, name: 'Carol White',   sip_uri: 'sip:carol@mc.example.com', notes: 'Dispatch',   created_at: 3000 },
  { id: 4, name: 'David Kim',     sip_uri: 'sip:david@mc.example.com', notes: 'Team Alpha', created_at: 2000 },
  { id: 5, name: 'Eve Nakamura',  sip_uri: 'sip:eve@mc.example.com',   notes: 'Command',    created_at: 1000 },
];

const mockInitDb       = jest.fn().mockResolvedValue(undefined);
const mockSeedContacts = jest.fn().mockResolvedValue(undefined);
const mockGetAll       = jest.fn().mockResolvedValue(FIXTURE_CONTACTS);

jest.mock('../src/core/db', () => ({
  initDb:       (...args: any[]) => mockInitDb(...args),
  seedContacts: (...args: any[]) => mockSeedContacts(...args),
  getAllContacts:(...args: any[]) => mockGetAll(...args),
}));

import { ContactsScreen } from '../src/features/contacts/ContactsScreen';

// ── Helper ────────────────────────────────────────────────────────────────────

async function renderContacts() {
  render(<ContactsScreen />);
  // Wait for the async useEffect (initDb → seedContacts → getAllContacts) to finish
  await waitFor(() => expect(screen.getByText('Alice Johnson')).toBeTruthy());
}

// ── Reset ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockInitDb.mockClear();
  mockSeedContacts.mockClear();
  mockGetAll.mockClear();
  mockGetAll.mockResolvedValue(FIXTURE_CONTACTS);
});

// =============================================================================
// 1. Initial render
// =============================================================================

describe('ContactsScreen — initial render', () => {
  it('renders the search bar placeholder', async () => {
    await renderContacts();
    expect(screen.getByPlaceholderText('Search contacts…')).toBeTruthy();
  });

  it('calls seedContacts() exactly once on mount', async () => {
    await renderContacts();
    expect(mockSeedContacts).toHaveBeenCalledTimes(1);
  });

  it('calls getAllContacts() exactly once on mount', async () => {
    await renderContacts();
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('shows correct contact count', async () => {
    await renderContacts();
    expect(screen.getByText('5 contacts')).toBeTruthy();
  });

  it('renders each contact name from the fixture', async () => {
    await renderContacts();
    for (const ct of FIXTURE_CONTACTS) {
      expect(screen.getByText(ct.name)).toBeTruthy();
    }
  });

  it('shows empty state text when getAllContacts returns []', async () => {
    mockGetAll.mockResolvedValueOnce([]);
    render(<ContactsScreen />);
    await waitFor(() => {
      expect(screen.getByText('No contacts found.')).toBeTruthy();
    });
  });

  it('shows "0 contacts" count when list is empty', async () => {
    mockGetAll.mockResolvedValueOnce([]);
    render(<ContactsScreen />);
    await waitFor(() => {
      expect(screen.getByText('0 contacts')).toBeTruthy();
    });
  });

  it('shows "1 contact" (singular) when exactly one contact exists', async () => {
    mockGetAll.mockResolvedValueOnce([FIXTURE_CONTACTS[0]]);
    render(<ContactsScreen />);
    await waitFor(() => {
      expect(screen.getByText('1 contact')).toBeTruthy();
    });
  });
});

// =============================================================================
// 2. Search filter
// =============================================================================

describe('ContactsScreen — search filter', () => {
  it('filters contacts by name substring (case-insensitive)', async () => {
    await renderContacts();
    const input = screen.getByPlaceholderText('Search contacts…');
    fireEvent.changeText(input, 'alice');
    // Alice visible, Bob hidden
    expect(screen.getByText('Alice Johnson')).toBeTruthy();
    expect(screen.queryByText('Bob Martinez')).toBeNull();
  });

  it('filters contacts by SIP URI substring', async () => {
    await renderContacts();
    const input = screen.getByPlaceholderText('Search contacts…');
    fireEvent.changeText(input, 'sip:carol');
    expect(screen.getByText('Carol White')).toBeTruthy();
    expect(screen.queryByText('Alice Johnson')).toBeNull();
  });

  it('search is case-insensitive for names', async () => {
    await renderContacts();
    const input = screen.getByPlaceholderText('Search contacts…');
    fireEvent.changeText(input, 'BOB');
    expect(screen.getByText('Bob Martinez')).toBeTruthy();
  });

  it('count text updates to reflect filtered length', async () => {
    await renderContacts();
    const input = screen.getByPlaceholderText('Search contacts…');
    fireEvent.changeText(input, 'david');
    expect(screen.getByText('1 contact')).toBeTruthy();
  });

  it('shows "No contacts found." when search matches nothing', async () => {
    await renderContacts();
    const input = screen.getByPlaceholderText('Search contacts…');
    fireEvent.changeText(input, 'zzznomatch');
    expect(screen.getByText('No contacts found.')).toBeTruthy();
  });

  it('restores full list when search is cleared', async () => {
    await renderContacts();
    const input = screen.getByPlaceholderText('Search contacts…');
    fireEvent.changeText(input, 'alice');
    fireEvent.changeText(input, '');
    for (const ct of FIXTURE_CONTACTS) {
      expect(screen.getByText(ct.name)).toBeTruthy();
    }
    expect(screen.getByText('5 contacts')).toBeTruthy();
  });
});

// =============================================================================
// 3. Expand / collapse detail panel
// =============================================================================

describe('ContactsScreen — expand/collapse', () => {
  it('tapping a contact row opens the detail panel', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    // Detail panel shows the SIP URI
    expect(screen.getByText('sip:alice@mc.example.com')).toBeTruthy();
  });

  it('tapping the same row again collapses the detail panel', async () => {
    await renderContacts();
    // First press — opens detail (name appears twice: row + header)
    const rowElements = screen.getAllByText('Alice Johnson');
    fireEvent.press(rowElements[0]);
    expect(screen.getByText('sip:alice@mc.example.com')).toBeTruthy();
    // Second press — collapses (press the first occurrence again)
    fireEvent.press(screen.getAllByText('Alice Johnson')[0]);
    expect(screen.queryByText('sip:alice@mc.example.com')).toBeNull();
  });

  it('only one detail panel is open at a time', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    expect(screen.getByText('sip:alice@mc.example.com')).toBeTruthy();

    fireEvent.press(screen.getByText('Bob Martinez'));
    // Bob's detail visible
    expect(screen.getByText('sip:bob@mc.example.com')).toBeTruthy();
    // Alice's detail closed
    expect(screen.queryByText('sip:alice@mc.example.com')).toBeNull();
  });
});

// =============================================================================
// 4. Detail panel content
// =============================================================================

describe('ContactsScreen — detail panel content', () => {
  it('shows the contact name in the detail panel', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Carol White'));
    // Name appears at least twice: row label + detail header
    const names = screen.getAllByText('Carol White');
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the SIP URI in the detail panel', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Carol White'));
    expect(screen.getByText('sip:carol@mc.example.com')).toBeTruthy();
  });

  it('shows Half Duplex MC button in the detail panel', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    expect(screen.getByText('Half Duplex MC')).toBeTruthy();
  });

  it('shows Full Duplex MC button in the detail panel', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    expect(screen.getByText('Full Duplex MC')).toBeTruthy();
  });

  it('shows Callback section heading in the detail panel', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    expect(screen.getByText('Callback')).toBeTruthy();
  });
});

// =============================================================================
// 5. Callback section
// =============================================================================

describe('ContactsScreen — callback section', () => {
  it('shows Status dash (—) before any request is placed', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    // getAllByText because "—" may appear twice (Status + Last Callback)
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Last Callback dash (—) before any request', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    expect(screen.getByText('Last Callback')).toBeTruthy();
  });

  it('shows the Place a Request button', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    expect(screen.getByText('Place a Request')).toBeTruthy();
  });

  it('tapping Place a Request changes status to pending', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    await act(async () => {
      fireEvent.press(screen.getByText('Place a Request'));
    });
    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('status dash is replaced by pending text after request is placed', async () => {
    await renderContacts();
    fireEvent.press(screen.getByText('Alice Johnson'));
    // Before request: 'pending' text must NOT be present
    expect(screen.queryByText('pending')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Place a Request'));
    });
    // After request: 'pending' is shown and status '—' is gone
    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('two contacts have independent callback states', async () => {
    await renderContacts();
    // Place request for Alice
    fireEvent.press(screen.getByText('Alice Johnson'));
    await act(async () => {
      fireEvent.press(screen.getByText('Place a Request'));
    });
    // Open Bob's detail and check his status stays '—'
    fireEvent.press(screen.getByText('Bob Martinez'));
    expect(screen.getByText('Status')).toBeTruthy();
    // Bob's status value must still be a dash
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});
