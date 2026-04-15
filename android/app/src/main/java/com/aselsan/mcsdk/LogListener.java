package com.aselsan.mcsdk;

/**
 * Mirrors {@code LogListener} in {@code core/LogListener.h}.
 *
 * <p>Implement this interface and register it via {@link McSdk#setLogListener}
 * to receive SDK log lines. Callbacks may arrive on a background thread.
 * {@code level} corresponds to {@link LogLevel#value}.
 */
public interface LogListener {
    void onLog(int level, String log);
}
