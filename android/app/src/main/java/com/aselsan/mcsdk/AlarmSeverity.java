package com.aselsan.mcsdk;

/** Mirrors {@code AlarmSeverity} in {@code core/Modules/Alarm/AlarmSeverity.h}. */
public enum AlarmSeverity {
    UNKNOWN(0),
    RESOLVED(1),
    MANUALLY_RESOLVED(2),
    MINOR(3),
    MAJOR(4),
    CRITICAL(5);

    public final int value;

    AlarmSeverity(int value) {
        this.value = value;
    }

    public static AlarmSeverity fromValue(int value) {
        for (AlarmSeverity s : values()) {
            if (s.value == value) return s;
        }
        return UNKNOWN;
    }
}
