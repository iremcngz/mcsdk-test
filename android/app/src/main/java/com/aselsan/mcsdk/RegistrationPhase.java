package com.aselsan.mcsdk;

/** Mirrors {@code RegistrationPhase} in {@code core/Modules/Registration/RegistrationPhase.h}. */
public enum RegistrationPhase {
    IDLE,
    DOWNLOADING_BMS,
    AUTHENTICATING,
    DOWNLOADING_CONFIGURATION,
    SIP_REGISTERING,
    SIP_AFFILIATING,
    DONE;

    public static RegistrationPhase fromOrdinal(int ordinal) {
        RegistrationPhase[] values = values();
        if (ordinal >= 0 && ordinal < values.length) return values[ordinal];
        return IDLE;
    }
}
