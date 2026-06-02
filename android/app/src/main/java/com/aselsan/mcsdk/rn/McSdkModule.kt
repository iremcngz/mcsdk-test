package com.aselsan.mcsdk.rn

import com.aselsan.mcsdk.Alarm
import com.aselsan.mcsdk.AlarmListener
import com.aselsan.mcsdk.AlarmSeverity
import com.aselsan.mcsdk.Document
import com.aselsan.mcsdk.DocumentType
import com.aselsan.mcsdk.Documents
import com.aselsan.mcsdk.Identity
import com.aselsan.mcsdk.LogLevel
import com.aselsan.mcsdk.LogListener
import com.aselsan.mcsdk.McSdk
import com.aselsan.mcsdk.RegistrationPhase
import com.aselsan.mcsdk.RegistrationState
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
private const val EVENT_FETCH_DOCUMENT  = "McSdkFetchDocument"
private const val EVENT_SDS_SENT        = "McSdkSdsSent"
private const val EVENT_SDS_RECEIVED    = "McSdkSdsReceived"
private const val EVENT_SDS_ERROR       = "McSdkSdsError"
private const val EVENT_ALARM           = "McSdkAlarm"
private const val EVENT_LOG             = "McSdkLog"
private const val EVENT_REGISTRATION    = "McSdkRegistration"
private const val EVENT_STORE_DOCUMENTS = "McSdkStoreDocuments"

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
        try {
            if (sdk == null) {
                sdk = McSdk()
            }
            // On hot-reload the module instance is replaced; re-bind listeners so
            // events still reach the active JS bridge.
            sdk!!.setListener(this)
            sdk!!.setAlarmListener(this)
            sdk!!.setLogListener(this)
        } catch (t: Throwable) {
            Log.e("McSdkBridge", "create() failed: ${t.message}", t)
            throw RuntimeException("McSdk.create() failed: ${t.message}", t)
        }
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
            Threading.sdkWorkerThreadCount = maxOf(1, d.optInt("sipWorkerThreads", 1))
            Mcx.idmsUrl = d.optString("idmsUrl", "")
            Mcx.bmsUrl  = d.optString("bmsUrl",  "")
            Mcx.cmsUrl  = d.optString("cmsUrl",  "")
            Mcx.gmsUrl  = d.optString("gmsUrl",  "")
            Mcx.mock    = d.optInt("mock", 0) != 0
        }
        sdk?.setParams(p)
    }

    // Promise stored so onReady() callback can resolve it
    private var initPromise: com.facebook.react.bridge.Promise? = null

    @ReactMethod
    fun init(promise: com.facebook.react.bridge.Promise) {
        if (sdkInitialized) {
            promise.resolve(true)
            return
        }
        initPromise = promise
        try {
            sdk?.init()
            // Result comes via onReady() callback
        } catch (t: Throwable) {
            initPromise = null
            promise.reject("INIT_ERROR", t.message, t)
        }
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

    // ── Identity & Registration ───────────────────────────────────────────────

    @ReactMethod
    fun setIdentity(mcId: String, password: String, clientId: String) {
        val identity = Identity().apply {
            this.mcId = mcId
            this.password = password
            this.clientId = clientId
        }
        sdk?.setIdentity(identity)
    }

    /**
     * Receives a JSON array of Document objects from JS and forwards them
     * to the native SDK.  Must be called after init() resolves and before
     * register() so the engine can pre-provision BMS documents.
     *
     * JSON shape: [{uri,etag,content,type,fetchedAt}, ...]
     */
    @ReactMethod
    fun setDocuments(docsJson: String) {
        val sdk = sdk ?: return
        try {
            val arr = org.json.JSONArray(docsJson)
            val docList = mutableListOf<Document>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                docList.add(Document().apply {
                    uri       = obj.optString("uri")
                    etag      = obj.optString("etag")
                    content   = obj.optString("content")
                    type      = DocumentType.fromOrdinal(obj.optInt("type", 0))
                    fetchedAt = obj.optLong("fetchedAt", 0L)
                })
            }
            val documents = Documents().apply { documents = docList }
            sdk.setDocuments(documents)
        } catch (e: Exception) {
            Log.e("McSdkBridge", "setDocuments parse error: ${e.message}", e)
        }
    }

    @ReactMethod
    fun register() { sdk?.register() }

    @ReactMethod
    fun unregister() { sdk?.unregister() }

    // ── Required by RCTEventEmitter protocol (JS side calls addListener) ──────

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ── SdkListener ───────────────────────────────────────────────────────────

    override fun onReady() {
        sdkInitialized = true
        initPromise?.resolve(true)
        initPromise = null
    }

    override fun onTerminated() {}

    override fun onSdkError(error: SdkError) {}

    override fun onRegistrationProgress(state: RegistrationState, phase: RegistrationPhase, progress: Int) {
        emit(EVENT_REGISTRATION, Arguments.createMap().apply {
            putString("state", state.name)
            putString("phase", phase.name)
            putInt("progress", progress)
        })
    }

    override fun onRegistered() {
        emit(EVENT_REGISTRATION, Arguments.createMap().apply {
            putString("state", "REGISTERED")
            putString("phase", "DONE")
            putInt("progress", 100)
        })
    }

    override fun onRegistrationFailed() {}

    fun onFetchDocument(url: String, content: String) {
        emit(EVENT_FETCH_DOCUMENT, Arguments.createMap().apply {
            putString("url", url)
            putString("content", content)
        })
    }

    fun onSdsSent(target: String, body: String) {
        emit(EVENT_SDS_SENT, Arguments.createMap().apply {
            putString("target", target)
            putString("body", body)
        })
    }

    fun onSdsReceived(sender: String, body: String) {
        emit(EVENT_SDS_RECEIVED, Arguments.createMap().apply {
            putString("sender", sender)
            putString("body", body)
        })
    }

    fun onSdsError(target: String, error: SdkError) {
        emit(EVENT_SDS_ERROR, Arguments.createMap().apply {
            putString("target", target)
            putString("error", error.name)
        })
    }

    override fun onDocumentsUpdated(docs: List<Document>) {
        try {
            val arr = org.json.JSONArray()
            for (doc in docs) {
                arr.put(org.json.JSONObject().apply {
                    put("uri",       doc.uri)
                    put("etag",      doc.etag)
                    put("content",   doc.content)
                    put("type",      doc.type.ordinal)
                    put("fetchedAt", doc.fetchedAt)
                })
            }
            emit(EVENT_STORE_DOCUMENTS, Arguments.createMap().apply {
                putString("docsJson", arr.toString())
            })
        } catch (e: Exception) {
            Log.e("McSdkBridge", "onDocumentsUpdated serialise error: ${e.message}", e)
        }
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
