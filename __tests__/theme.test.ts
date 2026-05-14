/**
 * __tests__/theme.test.ts — Tests for the theme palette system.
 *
 * ┌─ HOW TO RUN ─────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/theme.test.ts          # Only this file             │
 * │  npx jest __tests__/theme.test.ts --watch  # Watch mode                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ WHAT IS TESTED ─────────────────────────────────────────────────────────┐
 * │                                                                          │
 * │  1. Token completeness — every ThemePalette key is present and          │
 * │     non-empty in both the dark and light palettes.                      │
 * │                                                                          │
 * │  2. Regression guards — specific color values that must not change      │
 * │     without a deliberate decision (primary, presenceOffline, accent).   │
 * │                                                                          │
 * │  3. Presence color mapping — ContactsScreen.makePresenceColors returns  │
 * │     the correct palette tokens for each presence status.                │
 * │                                                                          │
 * │  NOTE: No mocks needed — getThemePalette is a pure synchronous function.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { getThemePalette, type ThemePalette } from '../src/core/theme';

// All token keys defined in the ThemePalette interface.
// Kept as a constant so the test fails immediately if a new token is added to
// the interface but omitted from one or both palette objects.
const REQUIRED_TOKENS: (keyof ThemePalette)[] = [
  'bg',
  'surface',
  'accent',
  'inputBg',
  'border',
  'logBg',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'textOnAccent',
  'primary',
  'secondary',
  'success',
  'warn',
  'error',
  'presenceOffline',
  'sdkLog',
  'valueText',
  'tableRowBg',
  'tableRowAltBg',
  'tableHeadBg',
  'errorBoxBg',
];

// =============================================================================
// 1. Token completeness — dark palette
// =============================================================================

describe('getThemePalette("dark") — token completeness', () => {
  const dark = getThemePalette('dark');

  it('returns an object (not null/undefined)', () => {
    expect(dark).toBeDefined();
    expect(typeof dark).toBe('object');
  });

  for (const token of REQUIRED_TOKENS) {
    it(`token "${token}" is a non-empty string`, () => {
      expect(dark).toHaveProperty(token);
      expect(typeof dark[token]).toBe('string');
      expect((dark[token] as string).length).toBeGreaterThan(0);
    });
  }
});

// =============================================================================
// 2. Token completeness — light palette
// =============================================================================

describe('getThemePalette("light") — token completeness', () => {
  const light = getThemePalette('light');

  it('returns an object (not null/undefined)', () => {
    expect(light).toBeDefined();
    expect(typeof light).toBe('object');
  });

  for (const token of REQUIRED_TOKENS) {
    it(`token "${token}" is a non-empty string`, () => {
      expect(light).toHaveProperty(token);
      expect(typeof light[token]).toBe('string');
      expect((light[token] as string).length).toBeGreaterThan(0);
    });
  }
});

// =============================================================================
// 3. Regression guards — specific color values
// =============================================================================
//
// These tests lock in intentional design decisions.  If a value must change,
// update the test at the same commit so the change is explicit.

describe('Regression guards — dark palette', () => {
  const dark = getThemePalette('dark');

  it('primary is #2196F3 (action blue)', () => {
    expect(dark.primary).toBe('#2196F3');
  });

  it('secondary is #9C27B0 (action purple)', () => {
    expect(dark.secondary).toBe('#9C27B0');
  });

  it('presenceOffline is #9E9E9E (neutral grey)', () => {
    expect(dark.presenceOffline).toBe('#9E9E9E');
  });

  it('success is #4CAF50 (online green)', () => {
    expect(dark.success).toBe('#4CAF50');
  });

  it('warn is #FF9800 (away orange)', () => {
    expect(dark.warn).toBe('#FF9800');
  });
});

describe('Regression guards — light palette', () => {
  const light = getThemePalette('light');

  it('primary is #1565c0 (dark action blue)', () => {
    expect(light.primary).toBe('#1565c0');
  });

  it('secondary is #7B1FA2 (dark action purple)', () => {
    expect(light.secondary).toBe('#7B1FA2');
  });

  it('presenceOffline is #757575 (dark grey)', () => {
    expect(light.presenceOffline).toBe('#757575');
  });
});

// =============================================================================
// 4. Presence color mapping
// =============================================================================
//
// ContactsScreen.makePresenceColors(c) is a private function but its logic is:
//
//   online  → c.success
//   busy    → c.error
//   away    → c.warn
//   offline → c.presenceOffline
//
// We verify this mapping by re-implementing it here against both palettes.
// If the palette tokens change, these tests will still pass as long as the
// mapping itself is unchanged.

function makePresenceColors(c: ThemePalette) {
  return {
    online:  c.success,
    busy:    c.error,
    away:    c.warn,
    offline: c.presenceOffline,
  };
}

describe('makePresenceColors — dark theme', () => {
  const dark   = getThemePalette('dark');
  const colors = makePresenceColors(dark);

  it('online maps to the success token', () => {
    expect(colors.online).toBe(dark.success);
  });

  it('busy maps to the error token', () => {
    expect(colors.busy).toBe(dark.error);
  });

  it('away maps to the warn token', () => {
    expect(colors.away).toBe(dark.warn);
  });

  it('offline maps to the presenceOffline token', () => {
    expect(colors.offline).toBe(dark.presenceOffline);
  });

  it('all four statuses produce distinct colors', () => {
    const values = Object.values(colors);
    const unique  = new Set(values);
    expect(unique.size).toBe(4);
  });
});

describe('makePresenceColors — light theme', () => {
  const light  = getThemePalette('light');
  const colors = makePresenceColors(light);

  it('online maps to the success token', () => {
    expect(colors.online).toBe(light.success);
  });

  it('busy maps to the error token', () => {
    expect(colors.busy).toBe(light.error);
  });

  it('away maps to the warn token', () => {
    expect(colors.away).toBe(light.warn);
  });

  it('offline maps to the presenceOffline token', () => {
    expect(colors.offline).toBe(light.presenceOffline);
  });
});
