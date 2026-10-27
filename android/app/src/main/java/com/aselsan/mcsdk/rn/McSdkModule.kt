package com.aselsan.mcsdk.rn

import com.aselsan.mcsdk.Alarm
import com.aselsan.mcsdk.AlarmListener
import com.aselsan.mcsdk.AlarmSeverity
import com.aselsan.mcsdk.CallInfo
import com.aselsan.mcsdk.Document
import com.aselsan.mcsdk.DocumentType
import com.aselsan.mcsdk.FloorInfo
import com.aselsan.mcsdk.Identity
import com.aselsan.mcsdk.LogLevel
import com.aselsan.mcsdk.LogListener
import com.aselsan.mcsdk.McSdk
import com.aselsan.mcsdk.RegistrationPhase
import com.aselsan.mcsdk.RegistrationState
import com.aselsan.mcsdk.AffiliateRequest
import com.aselsan.mcsdk.SdkError
import com.aselsan.mcsdk.GroupInfo
import com.aselsan.mcsdk.IdentityInfo
import com.aselsan.mcsdk.SdkListener
import com.aselsan.mcsdk.SdkParams
import com.aselsan.mcsdk.TerminationInfo
import com.facebook.react.bridge.Arguments
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

// Event name constants (must match src/index.ts McSdkEvents)
private const val EVENT_SDK_ERROR       = "McSdkSdkError"
private const val EVENT_SDS_SENT        = "McSdkSdsSent"
private const val EVENT_SDS_RECEIVED    = "McSdkSdsReceived"
private const val EVENT_SDS_ERROR       = "McSdkSdsError"
private const val EVENT_ALARM           = "McSdkAlarm"
private const val EVENT_LOG             = "McSdkLog"
private const val EVENT_REGISTRATION    = "McSdkRegistration"
private const val EVENT_STORE_DOCUMENTS = "McSdkStoreDocuments"
private const val EVENT_INCOMING_CALL   = "McSdkIncomingCall"
private const val EVENT_CALL_UPDATED    = "McSdkCallUpdated"
private const val EVENT_CALL_TERMINATED = "McSdkCallTerminated"
private const val EVENT_FLOOR_UPDATED   = "McSdkFloorUpdated"
private const val EVENT_IDENTITY_UPDATED     = "McSdkIdentityUpdated"
private const val EVENT_GROUPS_UPDATED       = "McSdkGroupsUpdated"
private const val EVENT_AFFILIATIONS_UPDATED = "McSdkAffiliationsUpdated"

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
        stopEventPump()
        super.invalidate()
    }

    // ── Event pump ────────────────────────────────────────────────────────────
    //
    // SDK listener callbacks are synchronous on the SDK worker thread (see
    // MCSDK/CLAUDE.md): the C++ side calls us and blocks on that line until we
    // return. Everything we do inside a callback is therefore time the SDK
    // cannot spend on its own work.
    //
    // emitDeviceEvent is the expensive part — it crosses into the JS runtime and,
    // through SdkContext, triggers React state updates. Measured end to end at
    // roughly 1.3 ms per event. With the default log parameters (logLevel 0,
    // pjLogLevel 0, rxTxEnabled true) the SDK emits ~450 events a second, which
    // is more time than a second contains.
    //
    // It is tolerable today because only logs and registration events travel this
    // path and arriving late costs nothing. It stops being tolerable once RTP
    // frames share the thread: starving the socket read loses packets, and that
    // loss is indistinguishable from network loss in the jitter buffer.
    //
    // So the callback now only hands the event to a queue and returns, and a
    // dedicated thread does the crossing. Measured: ~0.0006 ms per event on the
    // SDK thread, about 2000x less.
    //
    // The WritableMap is still built on the SDK thread. Moving that into the pump
    // as well was measured and made no difference (the allocation is noise next
    // to the bridge crossing), so the 18 call sites are left untouched.

    private data class PendingEvent(
        val name: String,
        val body: com.facebook.react.bridge.WritableMap,
    )

    /**
     * Bounded on purpose. If JS cannot keep up, dropping the oldest events is
     * better than growing without limit — and far better than blocking the SDK,
     * which is the whole point of this queue.
     */
    private val eventQueue = java.util.concurrent.ArrayBlockingQueue<PendingEvent>(4096)

    private val droppedEvents = java.util.concurrent.atomic.AtomicInteger(0)

    private val pumpRunning = java.util.concurrent.atomic.AtomicBoolean(false)

    private var pumpThread: Thread? = null

    private fun startEventPump() {
        if (!pumpRunning.compareAndSet(false, true)) return
        pumpThread = Thread({
            while (pumpRunning.get() || eventQueue.isNotEmpty()) {
                // Poll rather than take(): a timeout lets the loop notice
                // pumpRunning going false instead of parking forever.
                val e = try {
                    eventQueue.poll(100, java.util.concurrent.TimeUnit.MILLISECONDS)
                } catch (ie: InterruptedException) {
                    null
                } ?: continue
                // Logged here on the pump, never in emit(): this thread is not
                // the SDK's. Before the crossing, since the map is consumed by it.
                if (e.name != EVENT_LOG) logEvent(e)
                try {
                    context.emitDeviceEvent(e.name, e.body)
                } catch (ex: Exception) {
                    // A dead ReactContext during teardown must not kill the pump
                    // or, worse, propagate back toward the SDK.
                    Log.w("McSdkBridge", "emit failed for ${e.name}: ${ex.message}")
                }
            }
        }, "McSdkEventPump").apply {
            priority = Thread.NORM_PRIORITY
            start()
        }
        Log.d("McSdkBridge", "event pump started")
    }

    /**
     * One logcat line per event reaching JS — what the SDK actually told the
     * app, which its own log lines do not show (e.g. a termination's mode and
     * reason). McSdkLog is left out: ~450/s, and its text is already in logcat
     * under the SDK tag. Capped so a large document or group list stays one line.
     */
    private fun logEvent(e: PendingEvent) {
        val body = try {
            e.body.toHashMap().entries.joinToString(" ") { (k, v) -> "$k=$v" }
        } catch (ex: Exception) {
            "<unreadable: ${ex.message}>"
        }
        Log.d("McSdkBridge", "event=${e.name} ${body.take(300)}")
    }

    private fun stopEventPump() {
        if (!pumpRunning.compareAndSet(true, false)) return
        // Join so queued events reach a still-live ReactContext rather than
        // being emitted into a torn-down one.
        pumpThread?.join(1000)
        pumpThread = null
        val dropped = droppedEvents.getAndSet(0)
        Log.d("McSdkBridge", "event pump stopped (dropped=$dropped)")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Called from the SDK worker thread. Enqueues and returns — see the note
     * above for why nothing heavier belongs here.
     */
    private fun emit(event: String, body: com.facebook.react.bridge.WritableMap) {
        if (!eventQueue.offer(PendingEvent(event, body))) {
            // offer(), never put(): a full queue must not block the SDK. Counted
            // rather than swallowed, so a backlog is visible instead of looking
            // like the SDK stopped emitting.
            val n = droppedEvents.incrementAndGet()
            if (n % 100 == 1) {
                Log.w("McSdkBridge", "event queue full, dropped $n event(s) — JS not keeping up")
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @ReactMethod
    fun create() {
        try {
            if (sdk == null) {
                sdk = McSdk()
            }
            // Before binding listeners: once they are bound the SDK can call us
            // at any moment, and emit() needs somewhere to drain to.
            startEventPump()

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
            // Default to empty, matching SDK_DEFAULTS: these reach OpenSSL as
            // filesystem paths, and one naming a file that is not on the device
            // fails TLS setup before the request goes out (httplib reports
            // Error::SSLLoadingCerts, "SSL certificate loading failed"), which
            // is what blocked IDMS login. Empty makes httplib fall back to the
            // system certificate store.
            Tls.certPath        = d.optString("certPath", "")
            Tls.privKeyPath     = d.optString("privKeyPath", "")
            Tls.caListPath      = d.optString("caListPath", "")
            Threading.sipRxThreadCount     = maxOf(1, d.optInt("sipRxThreads", 1))
            Threading.sdkWorkerThreadCount = maxOf(1, d.optInt("sipWorkerThreads", 1))
            // Mcx was reshaped in SDK 072fad0: idmsUrl/cmsUrl/gmsUrl are gone
            // (document fetching moved inside the SDK); the service-enable and
            // SIP-registration knobs below replaced them.
            Mcx.mcdataSds       = d.optInt("mcdataSds", 1) != 0
            Mcx.mcdataFd        = d.optInt("mcdataFd", 1) != 0
            Mcx.mcdataIpconn    = d.optInt("mcdataIpconn", 0) != 0
            Mcx.authViaPublish  = d.optInt("authViaPublish", 1) != 0
            Mcx.registerExpires = d.optInt("registerExpires", 3600)
            Mcx.pocExpires      = d.optLong("pocExpires", 4294967295L)
            Mcx.userAgent       = d.optString("userAgent", "Mission 809")
            Mcx.bmsUrl          = d.optString("bmsUrl", "")
            // Mcx.mock is gone as of SDK 85d75fd ("remove mock register") — the
            // server-less registration path was deleted, so there is no flag to
            // set. A "mock" key in paramsJson is now simply ignored.
            Mcx.imei            = d.optString("imei", "0001-0001-000001")
            // Protocol tuning added alongside the affiliation work. SdkParams()
            // is pre-filled by nativeFillDefaults(), so each is only overwritten
            // when JS actually sends it — the fallbacks below mirror the C++
            // defaults in Modules/Params/ParamTypes.h so an explicit JS value and
            // a missing one cannot disagree.
            if (d.has("sessionExpires"))
                Mcx.sessionExpires = d.optInt("sessionExpires", 1800)
            if (d.has("affiliationExpires"))
                Mcx.affiliationExpires = d.optLong("affiliationExpires", 4294967295L)
            // Publishes the initial affiliation before the SUBSCRIBE instead of
            // after it is confirmed. Useful against a server that accepts the
            // SUBSCRIBE but never sends the initial NOTIFY.
            if (d.has("affiliateBeforeSubscribe"))
                Mcx.affiliateBeforeSubscribe = d.optInt("affiliateBeforeSubscribe", 0) != 0
            if (d.has("xcapExpires"))
                Mcx.xcapExpires = d.optLong("xcapExpires", 36000L)
            if (d.has("httpRequestTimeout"))
                Http.requestTimeout = d.optInt("httpRequestTimeout", 10)
            // IDMS session-token renewal (added in SDK d518f40). Left at the
            // SDK's own defaults unless JS overrides them — SdkParams() is
            // already filled by nativeFillDefaults().
            if (d.has("idmsRenewMargin"))   Idms.renewMargin   = d.optInt("idmsRenewMargin")
            if (d.has("idmsRetryInterval")) Idms.retryInterval = d.optInt("idmsRetryInterval")
            if (d.has("idmsRetryCount"))    Idms.retryCount    = d.optInt("idmsRetryCount")
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

    // NOTE: fetchDocument() was removed from the SDK in 072fad0 — the engine now
    // fetches BMS documents itself and reports them via onDocumentsUpdated().
    // The JS-side McSdk.fetchDocument() is a no-op on Android; it remains only
    // because the iOS xcframework still exposes the old API.

    // NOTE: sendSds() was removed from the SDK in f2d017c, which replaced the
    // single send-a-string call with the MCData SDS interfaces (SdsInfo carries
    // conversationId/messageId/sentAt and the app, not the SDK, stores messages).
    // Nothing in src/ sent an SDS, so the old binding is simply gone; wire the
    // new interface when a messaging screen actually needs it.

    // ── Calling ───────────────────────────────────────────────────────────────

    /**
     * autoCommence picks the Answer-Mode header on the INVITE (RFC 5373):
     * true auto-answers at the far end, false rings for manual pickup.
     *
     * fullDuplex selects TS 24.379 §11.1.2 "private call without floor control"
     * — neither side arbitrates transmission, so there is no floor to request
     * and audio flows both ways while the call is selected. The default (false)
     * is §11.1.1 "with floor control", i.e. half-duplex PTT.
     */
    @ReactMethod
    fun startPrivateCall(mcId: String, autoCommence: Boolean, fullDuplex: Boolean) {
        sdk?.startPrivateCall(mcId, autoCommence, fullDuplex)
    }

    @ReactMethod fun startGroupCall(groupId: String) { sdk?.startGroupCall(groupId) }
    @ReactMethod fun answerCall(callId: String)      { sdk?.answerCall(callId) }
    @ReactMethod fun rejectCall(callId: String)      { sdk?.rejectCall(callId) }
    @ReactMethod fun terminateCall(callId: String)   { sdk?.terminateCall(callId) }

    // ── Call priority ─────────────────────────────────────────────────────────

    /**
     * Upgrades or downgrades an active call to/from emergency (TS 24.379
     * §10.1.1.2.1.3 / §11.1.1.2.1.5). The SDK re-INVITEs with the provisioned
     * emergency floor priority and <emergency-ind>, and subsequent floor
     * requests inherit that priority — there is no separate priority argument
     * on requestFloor().
     *
     * No-op unless the call is Active and not already in the requested state.
     */
    @ReactMethod fun setEmergency(callId: String, emergency: Boolean) {
        sdk?.setEmergency(callId, emergency)
    }

    /** Same as setEmergency but raises <imminentperil-ind>. Imminent peril
     *  shares the provisioned emergency priority — the SDK has no separate
     *  field for it. */
    @ReactMethod fun setImminentPeril(callId: String, imminentPeril: Boolean) {
        sdk?.setImminentPeril(callId, imminentPeril)
    }

    // ── Affiliation ───────────────────────────────────────────────────────────

    /**
     * Explicit affiliation (TS 24.379 §9.2.1.2 state-replacing PUBLISH).
     *
     * The SDK's affiliate() is state-REPLACING: the array is the complete desired
     * set, not a delta, so JS must send every group it wants affiliated on every
     * call. An empty array de-affiliates everything, which is what deaffiliate()
     * expresses explicitly.
     *
     * JSON shape: [{groupId, ptt, video, data}, ...]
     */
    @ReactMethod
    fun affiliate(requestsJson: String) {
        val sdk = sdk ?: return
        try {
            val arr = org.json.JSONArray(requestsJson)
            val requests = Array(arr.length()) { i ->
                val obj = arr.getJSONObject(i)
                AffiliateRequest(
                    obj.optString("groupId"),
                    obj.optBoolean("ptt", false),
                    obj.optBoolean("video", false),
                    obj.optBoolean("data", false),
                )
            }
            sdk.affiliate(requests)
        } catch (e: Exception) {
            Log.e("McSdkBridge", "affiliate parse error: ${e.message}", e)
        }
    }

    @ReactMethod
    fun deaffiliate() { sdk?.deaffiliate() }

    // ── Floor ─────────────────────────────────────────────────────────────────

    @ReactMethod fun requestFloor(callId: String)    { sdk?.requestFloor(callId) }
    @ReactMethod fun releaseFloor(callId: String)    { sdk?.releaseFloor(callId) }

    // NOTE: the SDK's whole Media section — selectCall(), muteMicrophone() and
    // the onCallSelected() callback — was removed in 98fb4c6, from the core as
    // well as the Java layer. Routing and mute are now the app's own business,
    // which is where they already were: AudioSessionManager owns the route,
    // MicrophoneOwner the device, and MediaPipeline.setTransmitEnabled() the
    // mute. The SDK's replacement model is per-stream rather than global —
    // receiveMedia(callId, transmitterId) / endMediaReception(...) — so there is
    // nothing to re-bind here.

    // ── Identity & Registration ───────────────────────────────────────────────

    /**
     * Must be called AFTER init(). Sdk::SetIdentity goes through Sdk::PostWork,
     * which drops the work and raises SdkError::NotInitialized while the engine
     * is not running — the SDK still logs "Sdk::SetIdentity", so a too-early
     * call looks successful while Session::McId stays empty and only Register()
     * reports it, much later, as "Identity not set".
     *
     * The values are logged because that failure is invisible otherwise. The
     * password is reduced to its length: it must never reach logcat, and an
     * empty-vs-present distinction is all that is useful for diagnosis.
     */
    @ReactMethod
    fun setIdentity(mcId: String, password: String, clientId: String) {
        Log.d(
            "McSdkBridge",
            "setIdentity: mcId='$mcId' clientId='$clientId' passwordLen=${password.length}",
        )
        val identity = Identity().apply {
            this.mcId = mcId
            // SDK ad2ed22 split the single password into idmsPassword (identity
            // server login) and sipPassword (SIP digest auth), because the two
            // servers can be provisioned with different secrets. This deployment
            // uses one credential for both, so the app still collects a single
            // password and it is sent as both. Splitting them later means adding
            // a second field to the login screen and the users table — nothing
            // here has to change.
            this.idmsPassword = password
            this.sipPassword = password
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
            sdk.setDocuments(docList)
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

    /**
     * Every SDK-level failure arrives here, and until now the body was empty —
     * so IDENTITY_NOT_SET, NOT_REGISTERED and the whole SIP, HTTP and FLOOR
     * error sets were swallowed with no trace on the JS side. The only hint was
     * a LOGW line in logcat, which makes a misconfigured registration look like
     * a hang rather than a reported error.
     */
    override fun onSdkError(error: SdkError) {
        Log.w("McSdkBridge", "onSdkError: ${error.name}")
        emit(EVENT_SDK_ERROR, Arguments.createMap().apply {
            putString("error", error.name)
        })
    }

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

    /**
     * Registration gave up. `phase` names the stage it died in, which is the
     * only clue to why — the SDK does not carry a reason here. Forwarded to JS
     * so the Log Console can show where the flow stopped (e.g. a rejected
     * PUBLISH shows up as a failure late in the sequence, not at the start).
     */
    override fun onRegistrationFailed(phase: RegistrationPhase) {
        emit(EVENT_REGISTRATION, Arguments.createMap().apply {
            putString("state", "FAILED")
            putString("phase", phase.name)
            putInt("progress", 0)
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

    // ── SdkListener: Identity, Groups & Affiliation (added in SDK dbb25f5) ────

    /**
     * The user's MC identity — which services are registered (authorized).
     * The access token is deliberately NOT forwarded to JS: it is a credential
     * the UI has no use for, and the SDK already holds it for its own requests.
     */
    override fun onIdentityUpdated(identity: IdentityInfo) {
        emit(EVENT_IDENTITY_UPDATED, Arguments.createMap().apply {
            putBoolean("isPtt",   identity.isPtt)
            putBoolean("isVideo", identity.isVideo)
            putBoolean("isData",  identity.isData)
        })
    }

    /**
     * Groups the user MAY affiliate to (from the provisioned user profiles).
     * Here the flags mean "this service supports the group".
     */
    override fun onGroupsUpdated(groups: List<GroupInfo>) {
        emit(EVENT_GROUPS_UPDATED, Arguments.createMap().apply {
            putArray("groups", groupListToArray(groups))
        })
    }

    /**
     * The currently affiliated set. Same shape as onGroupsUpdated, but the flags
     * mean "the affiliation covers this service".
     */
    override fun onAffiliationsUpdated(groups: List<GroupInfo>) {
        emit(EVENT_AFFILIATIONS_UPDATED, Arguments.createMap().apply {
            putArray("groups", groupListToArray(groups))
        })
    }

    private fun groupListToArray(groups: List<GroupInfo>) = Arguments.createArray().apply {
        for (g in groups) {
            pushMap(Arguments.createMap().apply {
                putString("groupId", g.groupId)
                putString("name",    g.name)
                putBoolean("isPtt",   g.isPtt)
                putBoolean("isVideo", g.isVideo)
                putBoolean("isData",  g.isData)
            })
        }
    }

    // ── SdkListener: Call & Floor (added in SDK 072fad0) ──────────────────────

    private fun callInfoToMap(c: CallInfo) = Arguments.createMap().apply {
        putString("callId", c.callId)
        putString("type", c.type.name)
        putString("state", c.state.name)
        putBoolean("outgoing", c.outgoing)
        putBoolean("isEmergency", c.isEmergency)
        putBoolean("isImminentPeril", c.isImminentPeril)
        putString("callerId", c.callerId)
        putString("calleeId", c.calleeId)
        putString("groupId", c.groupId)
    }

    override fun onIncomingCall(callInfo: CallInfo) {
        emit(EVENT_INCOMING_CALL, callInfoToMap(callInfo))
    }

    override fun onCallUpdated(callInfo: CallInfo) {
        emit(EVENT_CALL_UPDATED, callInfoToMap(callInfo))
    }

    override fun onCallTerminated(terminationInfo: TerminationInfo) {
        emit(EVENT_CALL_TERMINATED, Arguments.createMap().apply {
            putString("callId", terminationInfo.callId)
            putString("mode", terminationInfo.mode.name)
            putString("reason", terminationInfo.reason.name)
            // PJSIP's final cause for the dialog: 200 "Normal call clearing"
            // for any BYE, otherwise the final response's code and reason
            // phrase. A Reason header on the BYE is not parsed into it.
            putInt("sipCode", terminationInfo.sipCode)
            putString("sipReason", terminationInfo.sipReason)
        })
    }

    /**
     * Floor state for one call. `status` is the headline; most other fields are
     * only meaningful for a particular status — denyReason for DENIED,
     * revokeReason for REVOKED, queuePosition/queuePriority while QUEUED.
     *
     * `talkers` carries every current talker (more than one in multi-talker
     * groups); `ownerId` is just the first of them, kept because it is what the
     * UI uses to tell "we hold the floor" from "someone else does".
     *
     * The Floor Indicator bitmap (TS 24.380 §8.2.3.15) is flattened into the
     * named booleans the SDK exposes rather than shipping the raw bits, so JS
     * does not have to know the bit layout.
     */
    override fun onFloorUpdated(floorInfo: FloorInfo) {
        emit(EVENT_FLOOR_UPDATED, Arguments.createMap().apply {
            putString("callId", floorInfo.callId)
            putString("ownerId", floorInfo.ownerId)
            putString("status", floorInfo.status.name)
            putInt("queuePosition", floorInfo.queuePosition)
            putInt("queuePriority", floorInfo.queuePriority)
            putInt("grantedDuration", floorInfo.grantedDuration)
            putBoolean("isEmergency", floorInfo.isEmergency)
            putBoolean("isImminentPeril", floorInfo.isImminentPeril)
            putString("denyReason", floorInfo.denyReason.name)
            putString("revokeReason", floorInfo.revokeReason.name)
            putBoolean("isMultiTalker", floorInfo.isMultiTalker)
            putBoolean("overridingWithoutRevoke", floorInfo.overridingWithoutRevoke)
            putBoolean("overriddenWithoutRevoke", floorInfo.overriddenWithoutRevoke)
            // Floor Indicator bits, already decoded by the SDK's helpers.
            putBoolean("isBroadcastCall", floorInfo.isBroadcastCall())
            putBoolean("isSystemCall", floorInfo.isSystemCall())
            putBoolean("isQueueingSupported", floorInfo.isQueueingSupported())
            putBoolean("isDualFloor", floorInfo.isDualFloor())
            putArray("talkers", Arguments.createArray().apply {
                floorInfo.talkers.forEach { t ->
                    pushMap(Arguments.createMap().apply {
                        putString("id", t.id)
                        // SSRC is an unsigned 32-bit value; WritableMap has no
                        // uint type, so it goes over as a double to stay exact.
                        putDouble("ssrc", t.ssrc.toDouble())
                    })
                }
            })
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
