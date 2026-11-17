/**
 * contexts/LogContext.tsx — the app's own log console: what the app and the SDK
 * listener said. Read by Home's console box, the Log Console screen and the
 * Tools menu's badge; written by SdkContext and anything else with a line to
 * report.
 *
 * Its own context, apart from SdkContext, on purpose. Every append ends in a
 * state update here, and a context's consumers all re-render when its value
 * changes — so while these buffers lived in SdkContext, each flush re-rendered
 * TabNavigator and, under it, whichever screen was showing, log or no log on
 * it. Here only the three places that actually draw the lines pay for them.
 *
 * The SDK's own log stream is NOT here. It is ~450 lines a second with the
 * default params and never reaches JS line by line: the Android bridge keeps
 * it in a native ring and the SDK Logs screen pulls it (McSdk.getSdkLogs).
 *
 * Consumed via: useLogContext()
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppLogger } from '../core/logger';
import type { LogEntry } from '../shared/types';

/** How long an entry waits in the queue before it reaches the console, at most. */
export const LOG_FLUSH_MS = 250;
/** Lines kept per buffer. The file log stays uncapped. */
export const LOG_MAX_ENTRIES = 5000;

// Module-level, so ids stay unique across a provider re-mount.
let nextId = 0;

function stamp(): string {
  const d = new Date();
  return (
    d.getHours().toString().padStart(2, '0') + ':' +
    d.getMinutes().toString().padStart(2, '0') + ':' +
    d.getSeconds().toString().padStart(2, '0')
  );
}

export interface LogContextValue {
  /** Everything: the app's lines and the listener events, oldest first. */
  logs: LogEntry[];
  /** The listener events only; each is also in `logs`. */
  listenerLogs: LogEntry[];
  /** A line from the app. Goes to `logs` and to the file log. */
  addLog: (msg: string, level?: LogEntry['level']) => void;
  /**
   * A line from the SDK listener. Goes to both buffers and to the file;
   * `fileDetail`, when given, goes to the file only (document contents, which
   * are too long for a console).
   */
  addListenerLog: (msg: string, level: LogEntry['level'], fileDetail?: string) => void;
  /** Empties both buffers, queued entries included. The file is left alone. */
  clearLogs: () => void;
}

const LogContext = createContext<LogContextValue | null>(null);

export function useLogContext(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) {
    throw new Error('useLogContext must be used inside <LogContextProvider>');
  }
  return ctx;
}

export function LogContextProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [listenerLogs, setListenerLogs] = useState<LogEntry[]>([]);

  // Batched rather than written per entry: a setState per entry copied the
  // whole array each time — cost growing with length, so O(n²) over a session —
  // and re-rendered every consumer each time. Entries accumulate in a ref
  // (writing a ref does not render) and move into state once per LOG_FLUSH_MS.
  // Nothing is dropped; the console trails real time by at most that.
  //
  // File logging is per entry on purpose: cache/logs is where the full,
  // untruncated SIP bodies are read from, and anything still queued would be
  // lost if the process died.
  const pendingLogs = useRef<LogEntry[]>([]);
  const pendingListenerLogs = useRef<LogEntry[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushLogs = useCallback(() => {
    flushTimer.current = null;
    // Capped: unbounded arrays made every copy more expensive than the last.
    if (pendingLogs.current.length) {
      const batch = pendingLogs.current;
      pendingLogs.current = [];
      setLogs(prev => [...prev, ...batch].slice(-LOG_MAX_ENTRIES));
    }
    if (pendingListenerLogs.current.length) {
      const batch = pendingListenerLogs.current;
      pendingListenerLogs.current = [];
      setListenerLogs(prev => [...prev, ...batch].slice(-LOG_MAX_ENTRIES));
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current === null) {
      flushTimer.current = setTimeout(flushLogs, LOG_FLUSH_MS);
    }
  }, [flushLogs]);

  // Flush on the way out instead of just clearing the timer: a batch queued in
  // the last interval would otherwise never reach the console. React drops the
  // setState if the provider is really going away, but when this teardown is a
  // re-mount rather than a shutdown it is the difference between keeping those
  // lines and silently losing them.
  useEffect(() => () => {
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
      flushLogs();
    }
  }, [flushLogs]);

  const writeFile = (msg: string, level: LogEntry['level']) => {
    if (level === 'error')     { AppLogger.error(msg); }
    else if (level === 'warn') { AppLogger.warn(msg); }
    else                       { AppLogger.info(msg); }
  };

  const addLog = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    pendingLogs.current.push({ id: nextId++, time: stamp(), msg, level });
    scheduleFlush();
    writeFile(msg, level);
  }, [scheduleFlush]);

  const addListenerLog = useCallback((msg: string, level: LogEntry['level'], fileDetail?: string) => {
    const time = stamp();
    pendingLogs.current.push({ id: nextId++, time, msg, level });
    pendingListenerLogs.current.push({ id: nextId++, time, msg, level });
    scheduleFlush();
    writeFile(msg, level);
    if (fileDetail) { AppLogger.info(fileDetail); }
  }, [scheduleFlush]);

  // Clearing drops what is queued too, or the next flush would refill the
  // console with entries from before the clear.
  const clearLogs = useCallback(() => {
    pendingLogs.current = [];
    pendingListenerLogs.current = [];
    setLogs([]);
    setListenerLogs([]);
  }, []);

  const value = useMemo<LogContextValue>(
    () => ({ logs, listenerLogs, addLog, addListenerLog, clearLogs }),
    [logs, listenerLogs, addLog, addListenerLog, clearLogs],
  );

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}
