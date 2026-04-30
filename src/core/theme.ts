/**
 * Theme — dark/light color palette definitions.
 */

import type { AppTheme } from './settings';

export interface ThemePalette {
  /** Root/screen background */
  bg: string;
  /** Card / header surface */
  surface: string;
  /** Primary accent (active tab, accent buttons, titles) */
  accent: string;
  /** Text input background */
  inputBg: string;
  /** Card border / tab separators */
  border: string;
  /** Log box / raw code background */
  logBg: string;
  /** Primary text */
  textPrimary: string;
  /** Secondary text (labels) */
  textSecondary: string;
  /** Muted / placeholder / hint text */
  textMuted: string;
  /** Text rendered on accent-coloured backgrounds */
  textOnAccent: string;
  /** Success green */
  success: string;
  /** Warning orange */
  warn: string;
  /** Error red */
  error: string;
  /** SDK log blue */
  sdkLog: string;
  /** Metric value tint */
  valueText: string;
  /** Table row background */
  tableRowBg: string;
  /** Table alternate row background */
  tableRowAltBg: string;
  /** Table header background */
  tableHeadBg: string;
  /** Error box background */
  errorBoxBg: string;
}

const dark: ThemePalette = {
  bg:            '#1a1a2e',
  surface:       '#16213e',
  accent:        '#e94560',
  inputBg:       '#0f3460',
  border:        '#0f3460',
  logBg:         '#0d1117',
  textPrimary:   '#e0e0e0',
  textSecondary: '#ccc',
  textMuted:     '#555',
  textOnAccent:  '#fff',
  success:       '#4CAF50',
  warn:          '#d29922',
  error:         '#f85149',
  sdkLog:        '#58a6ff',
  valueText:     '#ffd54f',
  tableRowBg:    '#0d1b30',
  tableRowAltBg: '#0f2040',
  tableHeadBg:   '#0f3460',
  errorBoxBg:    '#2d1a1a',
};

const light: ThemePalette = {
  bg:            '#f0f2f5',
  surface:       '#ffffff',
  accent:        '#c62828',
  inputBg:       '#e8eaed',
  border:        '#d0d4dc',
  logBg:         '#f8f9fa',
  textPrimary:   '#1a1a2e',
  textSecondary: '#444',
  textMuted:     '#999',
  textOnAccent:  '#fff',
  success:       '#2e7d32',
  warn:          '#e65100',
  error:         '#c62828',
  sdkLog:        '#1565c0',
  valueText:     '#bf360c',
  tableRowBg:    '#ffffff',
  tableRowAltBg: '#f5f5f5',
  tableHeadBg:   '#e0e0e0',
  errorBoxBg:    '#ffebee',
};

export function getThemePalette(theme: AppTheme): ThemePalette {
  return theme === 'light' ? light : dark;
}
