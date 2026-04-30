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
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

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
        Log.d("McSdkBridge", "emit: event=$event hasActiveInstance=${context.hasActiveReactInstance()}")
        context.emitDeviceEvent(event, body)
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

    @ReactMethod
    fun destroy() {
        sdk?.destroy()
        sdk = null
        sdkInitialized = false
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    @ReactMethod
    fun setParams(paramsJson: String) {
        val d = JSONObject(paramsJson)
        val p = SdkParams().apply {
            Logging.enabled     = d.optInt("logEnabled", 1) != 0
            Logging.level       = LogLevel.fromValue(d.optInt("logLevel", 1))
            Logging.pjEnabled   = d.optInt("pjLogEnabled", 0) != 0
            Logging.pjLevel     = LogLevel.fromValue(d.optInt("pjLogLevel", 1))
            Logging.rxTxEnabled = d.optInt("rxTxEnabled", 0) != 0
            Http.port           = d.optInt("httpPort", 8008)
            Sip.udpPort         = d.optInt("sipUdpPort", 5060)
            Sip.tcpEnabled      = d.optInt("sipTcpEnabled", 0) != 0
            Sip.tcpPort         = d.optInt("sipTcpPort", 5060)
            Sip.tlsEnabled      = d.optInt("sipTlsEnabled", 0) != 0
            Sip.tlsPort         = d.optInt("sipTlsPort", 5061)
            Sip.ipv6Enabled     = d.optInt("sipIpv6Enabled", 0) != 0
            Tls.mTlsEnabled     = d.optInt("mTlsEnabled", 0) != 0
            Tls.certPath        = d.optString("certPath", "cert/client.crt")
            Tls.privKeyPath     = d.optString("privKeyPath", "cert/client.key")
            Tls.caListPath      = d.optString("caListPath", "cert/ca.pem")
            Threading.sipRxThreadCount     = maxOf(1, d.optInt("sipRxThreads", 1))
            Threading.sipWorkerThreadCount = maxOf(1, d.optInt("sipWorkerThreads", 1))
        }
        sdk?.setParams(p)
    }

    @ReactMethod
    fun init(promise: com.facebook.react.bridge.Promise) {
        if (sdkInitialized) {
            promise.resolve(true)
            return
        }
        val result = sdk?.init() ?: false
        sdkInitialized = result
        promise.resolve(result)
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

    override fun onReady() {
        // SDK init complete — mark as initialized
        sdkInitialized = true
    }

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
        Log.d("McSdkBridge", "onLog: level=$level log=${log.take(80)}")
        emit(EVENT_LOG, Arguments.createMap().apply {
            putInt("level", level)
            putString("log", log)
        })
    }
}
