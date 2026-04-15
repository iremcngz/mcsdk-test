package com.aselsan.mcsdk;

/**
 * Mirrors {@code AlarmListener} in {@code core/AlarmListener.h}.
 *
 * <p>Implement this interface and register it via {@link McSdk#setAlarmListener}
 * to receive alarm notifications. Callbacks may arrive on a background thread.
 */
public interface AlarmListener {
    void onAlarm(String alarm);
}
