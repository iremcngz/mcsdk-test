package com.aselsan.mcsdk;

/** Mirrors {@code RegistrationState} in {@code core/Modules/Registration/RegistrationState.h}. */
public enum RegistrationState {
    UNREGISTERED,
    REGISTERING,
    REGISTERED,
    UNREGISTERING;

    public static RegistrationState fromOrdinal(int ordinal) {
        RegistrationState[] values = values();
        if (ordinal >= 0 && ordinal < values.length) return values[ordinal];
        return UNREGISTERED;
    }
}
