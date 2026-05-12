/**
 * __tests__/auth.test.ts — Tests for the authentication layer.
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/auth.test.ts          # Only auth tests             │
 * │  npx jest __tests__/auth.test.ts --watch  # Watch mode                 │
 * │  npx jest -t "saveCredentials"            # Only matching describe/it   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ WHAT IS TESTED ─────────────────────────────────────────────────────────┐
 * │                                                                          │
 * │  1. db layer (initDb, upsertUser, getUserByUsername)                    │
 * │     — Verifies the SQLite in-memory mock works for user CRUD.           │
 * │                                                                          │
 * │  2. auth layer (saveCredentials, getCredentials)                        │
 * │     — Stores and retrieves plaintext credentials for SDK use.           │
 * │                                                                          │
 * │  3. LoginScreen component                                               │
 * │     — Renders correctly, shows error on failed login, clears it when    │
 * │       the user starts typing, triggers login on Enter key.              │
 * │                                                                          │
 * │  NOTE: @op-engineering/op-sqlite is replaced by an in-memory mock       │
 * │  (see __mocks__/@op-engineering/op-sqlite.js) so no device is needed.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// db and auth modules are loaded inside jest.isolateModulesAsync() per test.

// =============================================================================
// 1.  db layer — upsertUser / getUserByUsername
// =============================================================================

describe('db layer', () => {
  it('getUserByUsername returns null for an unknown username', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, getUserByUsername } = require('../src/core/db');
      await initDb();
      const row = await getUserByUsername('nobody');
      expect(row).toBeNull();
    });
  });

  it('upsertUser inserts a new row and getUserByUsername finds it', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, upsertUser, getUserByUsername } = require('../src/core/db');
      await initDb();
      await upsertUser('alice', 'pass123');
      const row = await getUserByUsername('alice');
      expect(row).not.toBeNull();
      expect(row!.username).toBe('alice');
      expect(row!.password).toBe('pass123');
    });
  });

  it('upsertUser updates an existing row when username conflicts', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, upsertUser, getUserByUsername } = require('../src/core/db');
      await initDb();
      await upsertUser('bob', 'pass-v1');
      await upsertUser('bob', 'pass-v2');
      const row = await getUserByUsername('bob');
      expect(row!.password).toBe('pass-v2');
    });
  });

  it('stores independent rows for different usernames', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb, upsertUser, getUserByUsername } = require('../src/core/db');
      await initDb();
      await upsertUser('carol', 'passC');
      await upsertUser('dave',  'passD');
      const carol = await getUserByUsername('carol');
      const dave  = await getUserByUsername('dave');
      expect(carol!.password).toBe('passC');
      expect(dave!.password).toBe('passD');
    });
  });
});

// =============================================================================
// 2.  auth layer — saveCredentials / getCredentials
// =============================================================================

describe('saveCredentials + getCredentials', () => {
  it('getCredentials returns null before saveCredentials', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb } = require('../src/core/db');
      const { getCredentials } = require('../src/core/auth');
      await initDb();
      expect(await getCredentials('eve')).toBeNull();
    });
  });

  it('getCredentials returns { username, password } after saveCredentials', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb } = require('../src/core/db');
      const { saveCredentials, getCredentials } = require('../src/core/auth');
      await initDb();
      await saveCredentials('frank', 'correct-horse');
      const creds = await getCredentials('frank');
      expect(creds).not.toBeNull();
      expect(creds!.username).toBe('frank');
      expect(creds!.password).toBe('correct-horse');
    });
  });

  it('saveCredentials updates password on second call', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb } = require('../src/core/db');
      const { saveCredentials, getCredentials } = require('../src/core/auth');
      await initDb();
      await saveCredentials('grace', 'first-pass');
      await saveCredentials('grace', 'second-pass');
      const creds = await getCredentials('grace');
      expect(creds!.password).toBe('second-pass');
    });
  });

  it('two users store independent credentials', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb } = require('../src/core/db');
      const { saveCredentials, getCredentials } = require('../src/core/auth');
      await initDb();
      await saveCredentials('heidi',   'heidi-pass');
      await saveCredentials('mallory', 'mallory-pass');
      const heidi   = await getCredentials('heidi');
      const mallory = await getCredentials('mallory');
      expect(heidi!.password).toBe('heidi-pass');
      expect(mallory!.password).toBe('mallory-pass');
    });
  });

  it('password is stored exactly as provided (case-sensitive)', async () => {
    await jest.isolateModulesAsync(async () => {
      const { initDb } = require('../src/core/db');
      const { saveCredentials, getCredentials } = require('../src/core/auth');
      await initDb();
      await saveCredentials('ivan', 'Secret123');
      const creds = await getCredentials('ivan');
      expect(creds!.password).toBe('Secret123');
    });
  });
});

// =============================================================================
// 3.  LoginScreen component
// =============================================================================

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';

// Mock safe-area-context (native module)
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView:     ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Mock the entire AppContext module so LoginScreen renders without full context providers.
const mockLogin = jest.fn();

jest.mock('../src/contexts/AppContext', () => ({
  useAppContext: () => ({
    c: {
      bg: '#000', surface: '#111', accent: '#4a9eff', border: '#333',
      inputBg: '#222', textPrimary: '#fff', textMuted: '#888',
      textSecondary: '#aaa', textOnAccent: '#fff', error: '#f44',
      success: '#4c4', warn: '#fa0', logBg: '#000', sdkLog: '#0af',
      errorBoxBg: '#300', tableRowBg: '#111', tableRowAltBg: '#181818',
      tableHeadBg: '#222',
    },
    tr: {
      loginTitle:    'Sign In',
      inputUsername: 'Username',
      inputPassword: 'Password',
      btnLogin:      'Login',
      loginError:    'Invalid username or password',
    },
    login: mockLogin,
  }),
}));

import LoginScreen from '../src/features/auth/LoginScreen';

describe('LoginScreen component', () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it('renders the title, username input, password input, and login button', () => {
    render(<LoginScreen />);
    expect(screen.getByText('Sign In')).toBeTruthy();
    expect(screen.getByPlaceholderText('Username')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    expect(screen.getByText('Login')).toBeTruthy();
  });

  it('does NOT show an error message on initial render', () => {
    render(<LoginScreen />);
    expect(screen.queryByText('Invalid username or password')).toBeNull();
  });

  it('calls login() with the entered username and password when button is pressed', async () => {
    mockLogin.mockResolvedValue(true);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Username'), 'alice');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'pass123');
    await act(async () => {
      fireEvent.press(screen.getByText('Login'));
    });
    expect(mockLogin).toHaveBeenCalledWith('alice', 'pass123');
  });

  it('shows the error message when login() returns false', async () => {
    mockLogin.mockResolvedValue(false);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Username'), 'bob');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'badpass');
    await act(async () => {
      fireEvent.press(screen.getByText('Login'));
    });
    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeTruthy();
    });
  });

  it('clears the error message when the user starts editing after a failure', async () => {
    mockLogin.mockResolvedValue(false);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Username'), 'carol');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'badpass');
    await act(async () => { fireEvent.press(screen.getByText('Login')); });
    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeTruthy();
    });
    // Start correcting the password — error should disappear.
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'b');
    expect(screen.queryByText('Invalid username or password')).toBeNull();
  });

  it('does NOT call login() when both fields are empty — login() still called with empty strings → returns false', async () => {
    // login() is called with empty strings; AppContext returns false for empty inputs.
    mockLogin.mockResolvedValue(false);
    render(<LoginScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Login')); });
    expect(mockLogin).toHaveBeenCalledWith('', '');
  });

  it('submitting via keyboard (onSubmitEditing on password field) triggers login', async () => {
    mockLogin.mockResolvedValue(true);
    render(<LoginScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Username'), 'dave');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'pass');
    await act(async () => {
      fireEvent(screen.getByPlaceholderText('Password'), 'submitEditing');
    });
    expect(mockLogin).toHaveBeenCalledWith('dave', 'pass');
  });
});
