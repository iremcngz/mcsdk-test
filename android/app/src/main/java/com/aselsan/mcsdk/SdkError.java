package com.aselsan.mcsdk;

/** Mirrors {@code SdkError} in {@code core/SdkError.h}. */
public enum SdkError {
    NOT_INITIALIZED,
    BUILD_REQUEST_FAILED,
    ATTACH_BODY_FAILED,
    SEND_FAILED;

    /** Returns the enum constant whose ordinal matches {@code ordinal}, or {@code NOT_INITIALIZED}
     *  for out-of-range values. Called from the JNI bridge to reconstruct enum values on callbacks. */
    public static SdkError fromOrdinal(int ordinal) {
        SdkError[] values = values();
        if (ordinal >= 0 && ordinal < values.length) return values[ordinal];
        return NOT_INITIALIZED;
    }
}
