package com.aselsan.mcsdk;

/**
 * Mirrors {@code SdkListener} in {@code core/SdkListener.h}.
 *
 * <p>Implement this interface and register it via {@link McSdk#setListener} to
 * receive SDK event callbacks. Callbacks may be delivered on a background thread
 * — do not update the UI directly from these methods.
 */
public interface SdkListener {
    void onReady();
    void onTerminated();
    void onSdkError(SdkError error);
    void onRegistrationProgress(RegistrationState state, RegistrationPhase phase, int progress);
    void onRegistered();
    void onFetchDocument(String url, String content);
    void onSdsSent(String target, String body);
    void onSdsReceived(String sender, String body);
    void onSdsError(String target, SdkError error);

    /**
     * Called by the SDK when BMS documents have been fetched and should be
     * persisted locally. Call {@link McSdk#setDocuments} with these documents
     * on the next SDK session to pre-provision them before registration.
     */
    void onStoreDocuments(java.util.List<Document> docs);
}
