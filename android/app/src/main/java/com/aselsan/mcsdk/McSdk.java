package com.aselsan.mcsdk;

/**
 * Java entry-point for the mc-sdk native library.
 *
 * <p>Only one instance should exist per process (matches the singleton
 * constraint of the underlying C++ {@code Sdk} class). Call {@link #destroy()}
 * when the SDK is no longer needed to release all native resources.
 *
 * <p>Typical usage:
 * <pre>{@code
 * McSdk sdk = new McSdk();
 * sdk.setParams(new SdkParams());
 * sdk.setListener(myListener);
 * sdk.init();
 * // ... use the SDK ...
 * sdk.destroy();
 * }</pre>
 */
public class McSdk {

    static {
        System.loadLibrary("mcsdk");
    }

    // Hold Java-side references so the GC does not collect listener objects
    // while the native layer still holds raw C++ pointers to them.
    private SdkListener   sdkListener;
    private LogListener   logListener;
    private AlarmListener alarmListener;

    public McSdk() {
        nativeCreate();
    }

    /** Releases all native resources. Must be called when the SDK is no longer needed. */
    public void destroy() {
        nativeDestroy();
    }

    /** Configures the SDK. Must be called before {@link #init()}. */
    public void setParams(SdkParams p) {
        nativeSetParams(
            p.Logging.enabled,    p.Logging.level.value,
            p.Logging.pjEnabled,  p.Logging.pjLevel.value,
            p.Logging.rxTxEnabled,
            p.Http.port,
            p.Sip.udpPort, p.Sip.tcpEnabled, p.Sip.tcpPort,
            p.Sip.tlsEnabled, p.Sip.tlsPort, p.Sip.ipv6Enabled,
            p.Tls.mTlsEnabled, p.Tls.certPath, p.Tls.privKeyPath, p.Tls.caListPath,
            p.Threading.sipRxThreadCount, p.Threading.sipWorkerThreadCount
        );
    }

    /** Registers the primary event listener. Must be set before {@link #init()}. */
    public void setListener(SdkListener listener) {
        this.sdkListener = listener;
        nativeSetListener(listener);
    }

    /** Registers a log listener. Optional. */
    public void setLogListener(LogListener listener) {
        this.logListener = listener;
        nativeSetLogListener(listener);
    }

    /** Registers an alarm listener. Optional. */
    public void setAlarmListener(AlarmListener listener) {
        this.alarmListener = listener;
        nativeSetAlarmListener(listener);
    }

    /**
     * Initialises the SDK. Call once after {@link #setParams} and {@link #setListener}.
     * @return {@code true} on success.
     */
    public boolean init() {
        return nativeInit();
    }

    // ─── Alarm ───────────────────────────────────────────────────────────────

    public void raiseAlarm(Alarm alarm) {
        nativeRaiseAlarm(alarm.name, alarm.info, alarm.severity.value);
    }

    public void resolveAlarm(String alarmName) {
        nativeResolveAlarmByName(alarmName);
    }

    /** Returns a JSON string listing all currently active alarms. */
    public String listAlarms() {
        return nativeListAlarms();
    }

    // ─── Metrics ─────────────────────────────────────────────────────────────

    /** Returns a Prometheus text-format string of all current metrics. */
    public String listMetrics() {
        return nativeListMetrics();
    }

    // ─── DAO ─────────────────────────────────────────────────────────────────

    public void createData(String key, String value) { nativeCreateData(key, value); }
    public void updateData(String key, String value) { nativeUpdateData(key, value); }
    public void deleteData(String key)               { nativeDeleteData(key); }
    public String getData(String key)                { return nativeGetData(key); }
    public void importData(String data)              { nativeImportData(data); }
    public String exportData()                       { return nativeExportData(); }

    // ─── Messaging ───────────────────────────────────────────────────────────

    public void fetchDocument(String url)              { nativeFetchDocument(url); }
    public void sendSds(String target, String body)    { nativeSendSds(target, body); }

    // ─── Native declarations ─────────────────────────────────────────────────

    private native void nativeCreate();
    private native void nativeDestroy();

    private native void nativeSetParams(
        boolean logEnabled,   int logLevel,
        boolean pjLogEnabled, int pjLogLevel,
        boolean rxTxEnabled,
        int httpPort,
        int sipUdpPort, boolean sipTcpEnabled, int sipTcpPort,
        boolean sipTlsEnabled, int sipTlsPort, boolean sipIpv6Enabled,
        boolean mTlsEnabled, String certPath, String privKeyPath, String caListPath,
        int sipRxThreads, int sipWorkerThreads);

    private native void    nativeSetListener(SdkListener listener);
    private native void    nativeSetLogListener(LogListener listener);
    private native void    nativeSetAlarmListener(AlarmListener listener);
    private native boolean nativeInit();
    private native void    nativeRaiseAlarm(String name, String info, int severity);
    private native void    nativeResolveAlarmByName(String alarmName);
    private native String  nativeListAlarms();
    private native String  nativeListMetrics();
    private native void    nativeCreateData(String key, String value);
    private native void    nativeUpdateData(String key, String value);
    private native void    nativeDeleteData(String key);
    private native String  nativeGetData(String key);
    private native void    nativeImportData(String data);
    private native String  nativeExportData();
    private native void    nativeFetchDocument(String url);
    private native void    nativeSendSds(String target, String body);
}
