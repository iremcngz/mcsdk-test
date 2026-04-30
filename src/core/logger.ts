/**
 * logger.ts — File-based logger backed by react-native-file-logger.
 *
 * Two separate log instances:
 *   AppLogger — application events (lifecycle, UI actions, errors)
 *   SdkLogger — raw SDK C++ log events (from McSdkLog native events)
 *
 * Log file locations:
 *   Android: /data/data/<package>/files/logs/app/  and  .../sdk/
 *   iOS:     <sandbox>/Documents/logs/app/          and  .../sdk/
 *
 * Rotation:  configurable via LogRotationSettings (stored in MMKV).
 *   - maximumFileSize:    bytes before rolling to new file (default 2 MB)
 *   - maximumNumberOfFiles: old files kept after rolling (default 3)
 *
 * Log format:  [2026-04-27 14:32:05.123] [INFO ] message
 */

import { FileLogger, LogLevel, type ConfigureOptions } from 'react-native-file-logger';
import { LogRotationSettings as RotationPrefs, type LogRotationSettings } from './settings';

// ── Format helper ─────────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.Debug]:   'DEBUG',
  [LogLevel.Info]:    'INFO ',
  [LogLevel.Warning]: 'WARN ',
  [LogLevel.Error]:   'ERROR',
};

function makeFormatter(prefix: string) {
  return (level: LogLevel, msg: string): string => {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    return `[${now}] [${LEVEL_LABELS[level]}] [${prefix}] ${msg}`;
  };
}

// ── Initialisation ────────────────────────────────────────────────────────────

let _configured = false;

/**
 * Call once at app startup (before any log call).
 * Re-reads rotation settings from MMKV every time it runs.
 */
export async function configureLogger(): Promise<void> {
  const rotation: LogRotationSettings = RotationPrefs.load();

  const appOptions: ConfigureOptions = {
    logLevel:             LogLevel.Debug,
    formatter:            makeFormatter('APP'),
    captureConsole:       false,   // keep console.log separate
    dailyRolling:         false,   // we use size-based rotation only
    maximumFileSize:      rotation.maxFileSize,
    maximumNumberOfFiles: rotation.maxFiles === 0 ? 999999 : rotation.maxFiles,
    logPrefix:            'app',   // file names: app_0.log, app_1.log, ...
  };

  await FileLogger.configure(appOptions);
  _configured = true;

  // Write a startup marker so the file is created immediately.
  FileLogger.info(makeFormatter('APP')(LogLevel.Info, 'Logger initialized'));

  // Log the actual file paths to Metro console so they are easy to find.
  const paths = await FileLogger.getLogFilePaths();
  console.log('[logger] Log file paths:', paths.length ? paths : '(none yet — first write may be pending)');
}

// ── AppLogger ─────────────────────────────────────────────────────────────────
// Writes application events to the configured log file.

export const AppLogger = {
  debug(msg: string): void   { _ensureReady(); FileLogger.debug(msg); },
  info(msg: string): void    { _ensureReady(); FileLogger.info(msg); },
  warn(msg: string): void    { _ensureReady(); FileLogger.warn(msg); },
  error(msg: string): void   { _ensureReady(); FileLogger.error(msg); },
} as const;

// ── SdkLogger ─────────────────────────────────────────────────────────────────
// Writes raw SDK C++ log events. Uses the same FileLogger instance but
// marks messages with [SDK] prefix in the formatter output.
// To separate SDK logs to a different physical file you would need a second
// native module instance; react-native-file-logger supports a single instance.
// SDK messages are therefore in the same file but visually tagged [SDK].

const SDK_LEVEL_NAMES = ['VERBOSE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export const SdkLogger = {
  /**
   * Write a raw SDK log event.
   * @param nativeLevel — numeric level received from C++ McSdkLog event (0–5)
   * @param message     — log text
   */
  write(nativeLevel: number, message: string): void {
    _ensureReady();
    const label = SDK_LEVEL_NAMES[nativeLevel] ?? String(nativeLevel);
    const text = `[SDK/${label}] ${message}`;
    if (nativeLevel <= 1) {
      FileLogger.debug(text);
    } else if (nativeLevel === 2) {
      FileLogger.info(text);
    } else if (nativeLevel === 3) {
      FileLogger.warn(text);
    } else {
      FileLogger.error(text);
    }
  },
} as const;

// ── File management helpers ────────────────────────────────────────────────────

/** Returns the paths of all current log files. */
export async function getLogFilePaths(): Promise<string[]> {
  return FileLogger.getLogFilePaths();
}

/** Deletes all log files. */
export async function deleteLogFiles(): Promise<void> {
  return FileLogger.deleteLogFiles();
}

// ── Guard ─────────────────────────────────────────────────────────────────────

function _ensureReady(): void {
  if (!_configured) {
    // configureLogger() not yet awaited — silently skip to avoid crash.
    // In development this appears in Metro console.
    console.warn('[logger] FileLogger not yet configured — call configureLogger() at startup');
  }
}
