package com.aselsan.mcsdk.rn

import com.aselsan.mcsdk.Alarm
import com.aselsan.mcsdk.AlarmListener
import com.aselsan.mcsdk.AlarmSeverity
import com.aselsan.mcsdk.LogLevel
import com.aselsan.mcsdk.LogListener
import com.aselsan.mcsdk.McSdk
import com.aselsan.mcsdk.SdkError
import com.aselsan.mcsdk.SdkListener
import com.aselsan.mcsdk.SdkParams
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// Event name constants (must match src/index.ts McSdkEvents)
private const val EVENT_FETCH_DOCUMENT = "McSdkFetchDocument"
private const val EVENT_SDS_SENT       = "McSdkSdsSent"
private const val EVENT_SDS_RECEIVED   = "McSdkSdsReceived"
private const val EVENT_SDS_ERROR      = "McSdkSdsError"
private const val EVENT_ALARM          = "McSdkAlarm"
private const val EVENT_LOG            = "McSdkLog"

class McSdkModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context),
    SdkListener,
    AlarmListener,
    LogListener {

    // The C++ Sdk owns process-level singletons (SipAgent, HttpAgent) that
    // cannot be re-initialised after destruction. Keep one McSdk for the
    // lifetime of the process; create() / destroy() only toggle JS-visible
    // state and re-bind listeners to the current module instance.
    companion object {
        private var sdk: McSdk? = null
        private var sdkInitialized = false
    }

    override fun getName(): String = "McSdk"

    // On bridge teardown (hot-reload, etc.) do NOT destroy the C++ SDK —
    // just make sure we don't hold stale references.
    override fun invalidate() {
        super.invalidate()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun emit(event: String, body: com.facebook.react.bridge.WritableMap) {
        context
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, body)
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @ReactMethod
    fun create() {
        if (sdk == null) {
            sdk = McSdk()
        }
        // On hot-reload the module instance is replaced; re-bind listeners so
        // events still reach the active JS bridge.
        sdk!!.setListener(this)
        sdk!!.setAlarmListener(this)
        sdk!!.setLogListener(this)
    }

    // Explicit listener binding step — called from JS after create().
    // Binds SdkListener, AlarmListener and LogListener to this module and
    // emits a synthetic log event so the JS console can confirm receipt.
    @ReactMethod
    fun setListener() {
        val s = sdk ?: return
        s.setListener(this)
        s.setAlarmListener(this)
        s.setLogListener(this)
        emit(EVENT_LOG, Arguments.createMap().apply {
            putInt("level", 2) // Info
            putString("log", "Listeners bound: SdkListener + AlarmListener + LogListener")
        })
    }

    @ReactMethod
    fun destroy() {
        // Do NOT call sdk.destroy() — the C++ singleton agents can't reinit.
        // Just reset JS-visible state so the next create→setParams→init cycle
        // looks fresh to the JS side.
        sdkInitialized = false
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    @ReactMethod
    fun setParams(
        logEnabled: Boolean,  logLevel: Int,
        pjLogEnabled: Boolean, pjLogLevel: Int,
        rxTxEnabled: Boolean,
        httpPort: Int,
        sipUdpPort: Int, sipTcpEnabled: Boolean, sipTcpPort: Int,
        sipTlsEnabled: Boolean, sipTlsPort: Int, sipIpv6Enabled: Boolean,
        mTlsEnabled: Boolean, certPath: String, privKeyPath: String, caListPath: String,
        sipRxThreads: Int, sipWorkerThreads: Int,
    ) {
        val p = SdkParams().apply {
            Logging.enabled     = logEnabled
            Logging.level       = LogLevel.fromValue(logLevel)
            Logging.pjEnabled   = pjLogEnabled
            Logging.pjLevel     = LogLevel.fromValue(pjLogLevel)
            Logging.rxTxEnabled = rxTxEnabled
            Http.port           = httpPort
            Sip.udpPort         = sipUdpPort
            Sip.tcpEnabled      = sipTcpEnabled
            Sip.tcpPort         = sipTcpPort
            Sip.tlsEnabled      = sipTlsEnabled
            Sip.tlsPort         = sipTlsPort
            Sip.ipv6Enabled     = sipIpv6Enabled
            Tls.mTlsEnabled     = mTlsEnabled
            Tls.certPath        = certPath
            Tls.privKeyPath     = privKeyPath
            Tls.caListPath      = caListPath
            Threading.sipRxThreadCount     = sipRxThreads
            Threading.sipWorkerThreadCount = sipWorkerThreads
        }
        sdk?.setParams(p)
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun init(): Boolean {
        if (sdkInitialized) return true
        val result = sdk?.init() ?: false
        sdkInitialized = result
        return result
    }

    // ── Alarm ─────────────────────────────────────────────────────────────────

    @ReactMethod
    fun raiseAlarm(name: String, info: String, severity: Int) {
        val alarm = Alarm(name, info, AlarmSeverity.fromValue(severity))
        sdk?.raiseAlarm(alarm)
    }

    @ReactMethod
    fun resolveAlarm(name: String) {
        sdk?.resolveAlarm(name)
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun listAlarms(): String = sdk?.listAlarms() ?: ""

    // ── Metrics ───────────────────────────────────────────────────────────────

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun listMetrics(): String = sdk?.listMetrics() ?: ""

    // ── DAO ───────────────────────────────────────────────────────────────────

    @ReactMethod fun createData(key: String, value: String) { sdk?.createData(key, value) }
    @ReactMethod fun updateData(key: String, value: String) { sdk?.updateData(key, value) }
    @ReactMethod fun deleteData(key: String)               { sdk?.deleteData(key) }
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getData(key: String): String = sdk?.getData(key) ?: ""
    @ReactMethod fun importData(data: String)              { sdk?.importData(data) }
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun exportData(): String = sdk?.exportData() ?: ""

    // ── Messaging ─────────────────────────────────────────────────────────────

    @ReactMethod
    fun fetchDocument(url: String) { sdk?.fetchDocument(url) }

    @ReactMethod
    fun sendSds(target: String, body: String) { sdk?.sendSds(target, body) }

    // ── Required by RCTEventEmitter protocol (JS side calls addListener) ──────

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ── SdkListener ───────────────────────────────────────────────────────────

    override fun onFetchDocument(url: String, content: String) {
        emit(EVENT_FETCH_DOCUMENT, Arguments.createMap().apply {
            putString("url", url)
            putString("content", content)
        })
    }

    override fun onSdsSent(target: String, body: String) {
        emit(EVENT_SDS_SENT, Arguments.createMap().apply {
            putString("target", target)
            putString("body", body)
        })
    }

    override fun onSdsReceived(sender: String, body: String) {
        emit(EVENT_SDS_RECEIVED, Arguments.createMap().apply {
            putString("sender", sender)
            putString("body", body)
        })
    }

    override fun onSdsError(target: String, error: SdkError) {
        emit(EVENT_SDS_ERROR, Arguments.createMap().apply {
            putString("target", target)
            putString("error", error.name)
        })
    }

    // ── AlarmListener ─────────────────────────────────────────────────────────

    override fun onAlarm(alarm: String) {
        emit(EVENT_ALARM, Arguments.createMap().apply {
            putString("alarm", alarm)
        })
    }

    // ── LogListener ───────────────────────────────────────────────────────────

    override fun onLog(level: Int, log: String) {
        emit(EVENT_LOG, Arguments.createMap().apply {
            putInt("level", level)
            putString("log", log)
        })
    }
}
