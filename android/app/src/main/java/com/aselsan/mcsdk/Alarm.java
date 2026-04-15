package com.aselsan.mcsdk;

/** Mirrors the {@code Alarm} class in {@code core/Modules/Alarm/Alarm.h}. */
public class Alarm {
    public final String name;
    public final String info;
    public final AlarmSeverity severity;

    public Alarm(String name, String info) {
        this(name, info, AlarmSeverity.UNKNOWN);
    }

    public Alarm(String name, String info, AlarmSeverity severity) {
        this.name = name;
        this.info = info;
        this.severity = severity;
    }
}
