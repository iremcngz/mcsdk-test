package com.aselsan.mcsdk;

/** Mirrors {@code LogLevel} in {@code core/Modules/Params/ParamTypes.h}. */
public enum LogLevel {
    VERBOSE(0),
    DEBUG(1),
    INFO(2),
    WARN(3),
    ERROR(4),
    FATAL(5);

    public final int value;

    LogLevel(int value) {
        this.value = value;
    }

    public static LogLevel fromValue(int value) {
        for (LogLevel l : values()) {
            if (l.value == value) return l;
        }
        return VERBOSE;
    }
}
