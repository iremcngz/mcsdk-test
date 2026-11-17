package com.aselsan.mcsdk.rn

import com.aselsan.mcsdk.Alarm
import com.aselsan.mcsdk.AlarmListener
import com.aselsan.mcsdk.AlarmSeverity
import com.aselsan.mcsdk.AudioCodec
import com.aselsan.mcsdk.AudioFrame
import com.aselsan.mcsdk.FdInfo
import com.aselsan.mcsdk.FdNotificationInfo
import com.aselsan.mcsdk.LocationConfigurationInfo
import com.aselsan.mcsdk.SdsInfo
import com.aselsan.mcsdk.SdsNotificationInfo
import com.aselsan.mcsdk.AudioInfo
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
import com.aselsan.mcsdk.ReceptionInfo
import com.aselsan.mcsdk.TransmissionInfo
import com.aselsan.mcsdk.VideoCodec
import com.aselsan.mcsdk.VideoFrame
import com.aselsan.mcsdk.VideoInfo
import com.aselsan.mcsdk.rn.media.audio.transport.CallAudioRouter
import com.aselsan.mcsdk.rn.media.video.transport.CallVideoRouter
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
private const val EVENT_AUDIO_INFO_UPDATED   = "McSdkAudioInfoUpdated"
private const val EVENT_IDENTITY_UPDATED     = "McSdkIdentityUpdated"
private const val EVENT_GROUPS_UPDATED       = "McSdkGroupsUpdated"
private const val EVENT_AFFILIATIONS_UPDATED = "McSdkAffiliationsUpdated"
private const val EVENT_READY                = "McSdkReady"
private const val EVENT_TERMINATED           = "McSdkTerminated"
private const val EVENT_TRANSMISSION_UPDATED = "McSdkTransmissionUpdated"
private const val EVENT_RECEPTION_UPDATED    = "McSdkReceptionUpdated"
private const val EVENT_VIDEO_UPDATED        = "McSdkVideoUpdated"

/** About every 5 s at 24 fps: enough to see frames arriving, too rare to cost anything. */
private const val VIDEO_RECEIVED_LOG_EVERY = 120

class McSdkModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context),
    SdkListener,
    AlarmListener,
    LogListener,
    com.facebook.react.bridge.LifecycleEventListener {

    // The C++ Sdk owns process-level singletons (SipAgent, HttpAgent) that
    // cannot be re-initialised after destruction. Keep one McSdk for the
    // lifetime of the process; create() / destroy() only toggle JS-visible
    // state and re-bind listeners to the current module instance.
    companion object {
        private var sdk: McSdk? = null
        private var sdkInitialized = false

        // ── State that has to outlive the JS bridge ───────────────────────────
        //
        // Closing the app destroys the Activity and the JS side but NOT the
        // process: Android keeps it cached, so this class stays loaded and these
        // statics keep their values (measured on device: same PID after back,
        // home and a swipe from recents). The C++ SDK survives with them, still
        // registered with the server.
        //
        // The new JS side comes up with empty state and cannot ask: the AAR's
        // Java API has no state getter, only register()/unregister() (checked
        // against the binary). The SDK reports registration only when it
        // *changes*, and that moment is gone. So the bridge remembers it here
        // and replays it on the next create() — see maybeReplayRegistration().

        /** Last registration state the SDK reported, as RegistrationState.name. */
        private var lastRegistrationState: String? = null
        /** Phase that came with it, for the replayed event. */
        private var lastRegistrationPhase: String? = null
        /** Progress that came with it, for the replayed event. */
        private var lastRegistrationProgress = 0
        /** Which MC ID the above belongs to — a different user must not be told
         *  it is already registered. */
        private var registeredMcId: String? = null
        /** The identity setIdentity() was last called with, registered or not. */
        private var currentMcId: String? = null

        /** A register() is waiting for the current unregister() to finish. */
        private var pendingReRegister = false
        private var reRegisterTimeout: java.util.Timer? = null
        /** The teardown talks to the server (de-affiliate, de-register, IdMS
         *  logout), so give it room — but never wait forever. */
        private const val RE_REGISTER_TIMEOUT_MS = 15_000L
        /**
         * How long the teardown requests get before the process ends.
         *
         * Measured: the de-affiliation PUBLISH and the SUBSCRIBE Expires:0
         * requests are all out about 100 ms in, and nothing follows because the
         * chain stalls there. 500 ms covers that with room to spare without
         * holding the close open for a step that is not coming.
         *
         * A longer wait does not help, and that was measured too: at 5 s the
         * close took the full 5.012 s and the chain was still at step one —
         * zero REGISTER Expires:0 sent, HandleSipDeaffiliated never called, no
         * state=UNREGISTERED. The wait is not what the chain is short of: it
         * needs batch.done(), which needs PJSIP to report the subscriptions
         * PJSIP_EVSUB_STATE_TERMINATED, and that never arrives. Waiting longer
         * for an event that is not coming only slows the close down.
         */
        private const val CLOSE_UNREGISTER_GRACE_MS = 500L

        /**
         * Calls the SDK currently has up. Only used to answer "is a call in
         * progress?" when the app is closing: killing the process then would
         * drop a call the media foreground service is deliberately keeping
         * alive. Nothing else reads it, so a plain set is enough.
         */
        private val activeCallIds = java.util.Collections.synchronizedSet(mutableSetOf<String>())

        /** True while the SDK is registered with the server. */
        private fun isRegistered(): Boolean {
            val s = lastRegistrationState?.uppercase() ?: return false
            return s.contains("REGISTERED") && !s.contains("UN")
        }

        /**
         * Keeps the last registration the SDK reported, so create() can replay
         * it to a JS side that was not there when it happened.
         *
         * The UN test matters: UNREGISTERED contains "REGISTERED" and
         * UNREGISTERING contains "REGISTERI", so a plain contains() would read
         * both as success. `registeredMcId` is only set while actually
         * registered and cleared otherwise, so a dropped registration cannot
         * leave a stale owner behind.
         */
        private fun rememberRegistration(state: String, phase: String, progress: Int) {
            lastRegistrationState = state
            lastRegistrationPhase = phase
            lastRegistrationProgress = progress
            registeredMcId = if (isRegistered()) currentMcId else null
        }

        /** Forgets the remembered registration — on destroy(), where the SDK goes. */
        private fun forgetRegistration() {
            lastRegistrationState = null
            lastRegistrationPhase = null
            lastRegistrationProgress = 0
            registeredMcId = null
        }
    }

    init {
        context.addLifecycleEventListener(this)
    }

    override fun getName(): String = "McSdk"

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onHostResume() {}
    override fun onHostPause() {}

    /**
     * The app is going away: drop the registration and end the process.
     *
     * Closing the app does not kill the process — Android caches it (measured:
     * the same PID survives back, home and a swipe from recents). The C++ SDK
     * survives with it, still registered, while the JS side restarts empty.
     * maybeReplayRegistration() makes that state visible, but a closed app that
     * stays registered is not what the user asked for: they expect the old
     * session to be gone. So end it properly here.
     *
     * unregister() is for the server's benefit, not the SDK's: the SDK is about
     * to be freed with the process, but without a de-register the server keeps
     * the registration until it expires. The delay gives that request time to
     * leave the socket — without it, killing the process immediately makes the
     * call pointless.
     *
     * A call in progress is left alone. The media foreground service exists to
     * keep a call alive with the app off screen, so killing the process here
     * would drop exactly the call it is protecting.
     *
     * Measured on an SM-A205F (Android 9) and an SM-S931B (Android 16): both
     * the back button and a swipe from recents finish the Activity, this runs,
     * and the process really does end — the next launch gets a new PID and a
     * fresh JS side. The home key only STOPs the Activity (finishing=false),
     * so this does not run for it and the process stays cached with the SDK
     * registered.
     *
     * A Service.onTaskRemoved was tried for the recents gesture and removed
     * again: it fired 12-36 ms after this method, killing the process while
     * the teardown was still at SIP_DEAFFILIATING, so the de-register never
     * reached the server. This path already covers recents on both handsets,
     * and it is the one that waits for the request to leave.
     *
     * Still not a guarantee — hence maybeReplayRegistration() and the
     * re-register in register(): they run on the way back up, where code
     * cannot be skipped, and they cover every close this misses.
     */
    override fun onHostDestroy() {
        // Closing the app tears the SDK down whether or not a call is up. The
        // media foreground service exists to keep a call alive with the app off
        // SCREEN — not after the user has closed it — so a call in progress is
        // terminated with everything else rather than outliving the app that
        // owns it. Without this a closed app left a call running behind an
        // ongoing notification with no UI to end it from.
        if (activeCallIds.isNotEmpty()) {
            Log.i(
                "McSdkBridge",
                "app closing with ${activeCallIds.size} call(s) up — terminating them",
            )
            synchronized(activeCallIds) { activeCallIds.toList() }.forEach { callId ->
                try {
                    sdk?.terminateCall(callId)
                } catch (t: Throwable) {
                    Log.w("McSdkBridge", "terminateCall($callId) on close failed: ${t.message}")
                }
            }
        }

        if (sdk == null) {
            // Nothing was ever brought up, so there is nothing to unregister —
            // but the process still has to go, or the next launch reuses it.
            Log.i("McSdkBridge", "app closing (no SDK) — ending process")
            endProcess()
            return
        }

        Log.i("McSdkBridge", "app closing — terminating the SDK, then ending the process")
        // terminate(), not unregister(). The history of this line matters, so
        // the measurements that led to each are kept below.
        //
        // The difference: unregister() walks the four steps as a chain, each
        // waiting for the previous step's callback, and that chain was measured
        // stalling at step one — the SUBSCRIBE Expires:0 requests get their 200
        // OKs, but AffiliationModule only counts a subscription as gone once
        // PJSIP reports PJSIP_EVSUB_STATE_TERMINATED, which never arrives here.
        // So HandleSipDeaffiliated() is not called and REGISTER Expires:0 — the
        // request that actually drops the registration — is never sent. Only the
        // de-affiliation gets through.
        //
        // RegistrationMachine::Terminate fires all four straight through with no
        // waiting, so it would send that de-register. But Sdk::Terminate cannot
        // be called from the app at all. Both threads were tried and both abort
        // the process on the same assertion:
        //   os_core_unix.c:974 pj_thread_this(): "Calling pjlib from unknown/
        //   external thread. You must register that thread..."
        // — from a plain Java thread (SIGABRT in tid 6018) and from the UI
        // thread itself (SIGABRT in tid 7412), both during
        // XcapModule::Unsubscribe, with no request sent either time. So the ANR
        // that SipAgent::Terminate's thread joins would risk never even comes
        // up: PJLIB rejects the caller first.
        //
        // PJSIP requires every calling thread to be registered with it.
        // Engine::workerEntry does exactly that for the SDK's own worker
        // (pj_thread_register("sdk-worker", ...)), but pj_thread_register is not
        // exposed through the AAR, and Sdk::Terminate stops that worker as its
        // first act anyway. Fixing this means registering the thread inside
        // terminate()'s JNI entry — the SDK's side, not the bridge's.
        //
        // That was the state when unregister() was chosen, and the trade was
        // "de-affiliation only, registration left to expire" over a close that
        // might abort. The call is now made the other way round — see below.
        //
        // What terminate() is for: RegistrationMachine::Terminate fires all four
        // teardown steps straight through with no waiting, so it sends the
        // REGISTER Expires:0 that unregister()'s chain never reaches. That is
        // the request that actually drops the registration server-side, which
        // is what we want on close.
        //
        // The risk, and why the call is fenced: Sdk::Terminate reaches PJSIP
        // from whatever thread calls it, and PJLIB rejects a thread it does not
        // know —
        //   os_core_unix.c:974 pj_thread_this(): "Calling pjlib from unknown/
        //   external thread. You must register that thread..."
        // — which is a SIGABRT, not an exception. nativeTerminate() in
        // McSdkJni.cpp calls gSdk->Terminate() with no pj_thread_register, so
        // the fix belongs in the SDK's JNI entry, not here.
        //
        // An abort cannot be caught, so the fence is ordering rather than a
        // try/catch: endProcess() is already scheduled on a timer BEFORE this
        // runs. If terminate() aborts, the process dies — which is where it was
        // heading anyway. If it returns, the timer ends the process on schedule.
        // Either way the close completes, and the de-register is sent whenever
        // the SDK permits it. The catch below still covers an ordinary Throwable.
        // Stop the media foreground service BEFORE terminate(), not only in
        // endProcess(). terminate() can take the process down itself (see the
        // SIGABRT below), and that happens ~2 ms in — long before the timer
        // scheduled here would run. If the service is still started at that
        // moment the system reads the death as a crashed START_STICKY service
        // and restarts the process; measured, that is exactly what happened.
        stopMediaService()

        // Scheduled BEFORE the teardown call, so the close finishes on its own
        // schedule whatever terminate() does — including hanging, which a chain
        // that waits on a callback can do. Long enough for the requests to
        // leave the socket: measured, the last of them is out ~100 ms in. A
        // Timer rather than Thread.sleep, because onHostDestroy runs on the UI
        // thread and blocking it risks an ANR.
        java.util.Timer().schedule(
            object : java.util.TimerTask() {
                override fun run() {
                    Log.i("McSdkBridge", "ending process after terminate")
                    endProcess()
                }
            },
            CLOSE_UNREGISTER_GRACE_MS,
        )
        try {
            sdk?.terminate()
        } catch (t: Throwable) {
            Log.w("McSdkBridge", "terminate() on close failed: ${t.message}")
        }
    }

    /**
     * Ends the process, so the next launch starts from nothing.
     *
     * This is the only way to get a clean slate. The C++ SDK owns
     * process-level singletons that cannot be re-initialised, which is why the
     * bridge keeps one McSdk for the whole process — destroy() plus a fresh
     * create() does not give a working SDK back. So a real restart means a real
     * new process: statics, the C++ instance, its threads and its SIP socket
     * all go with it.
     *
     * killProcess rather than exitProcess: it is the same SIGKILL the system
     * uses, and it does not run shutdown hooks that would touch an SDK whose
     * teardown is already under way. The file log is written per event and
     * uncapped on purpose, so nothing is waiting in a buffer to be lost.
     */
    private fun endProcess() {
        stopMediaService()
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    /**
     * Stops the media foreground service, so the process death that follows is
     * final.
     *
     * The service returns START_STICKY. Dying while it is still started — by
     * killProcess here, or by the SIGABRT terminate() can raise — reads to the
     * system as a crashed service, and it restarts the process to bring the
     * service back. Measured on an SM-S931B (Android 16):
     *   ActivityManager: Process com.mcxtest (pid 26233) has died
     *   ActivityManager: Scheduling restart of crashed service
     *                    MediaForegroundService in 1000ms
     *   ActivityManager: Start proc 26573 for service MediaForegroundService
     * — leaving the user a process with no Activity, no SDK and an ongoing
     * notification, one second after they closed the app.
     *
     * Safe to call more than once: stopService on a stopped service is a no-op.
     */
    private fun stopMediaService() {
        try {
            com.aselsan.mcsdk.rn.media.MediaForegroundService.stop(context)
        } catch (t: Throwable) {
            Log.w("McSdkBridge", "stopping the media service on close failed: ${t.message}")
        }
    }

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
     * under the SDK tag. Capped so a large document or group list stays one line;
     * the cap clears a full CallInfo or FloorInfo, which 300 used to cut short.
     */
    private fun logEvent(e: PendingEvent) {
        val body = try {
            e.body.toHashMap().entries.joinToString(" ") { (k, v) -> "$k=$v" }
        } catch (ex: Exception) {
            "<unreadable: ${ex.message}>"
        }
        Log.d("McSdkBridge", "event=${e.name} ${body.take(1000)}")
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

            // The uplink of a call's audio: SdkFrameSink → router → here. Reads
            // `sdk` at send time, so a destroy() leaves it sending to nothing
            // rather than to a released instance.
            CallAudioRouter.sender = CallAudioRouter.Sender { callId, payload, captureTimeUs ->
                sdk?.sendAudioFrame(callId, payload, captureTimeUs)
            }
            // The same for a call's video: SdkVideoFrameSink → router → here.
            CallVideoRouter.sender = CallVideoRouter.Sender { callId, data, captureTimeUs, keyFrame ->
                sdk?.sendVideoFrame(callId, data, captureTimeUs, keyFrame)
            }
            CallVideoRouter.keyFrameRequester = CallVideoRouter.KeyFrameRequester { callId, ssrc ->
                sdk?.requestKeyFrame(callId, ssrc)
            }

            // Last, so the pump and the listeners are up to carry it.
            maybeReplayRegistration()
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
        activeCallIds.clear()
        forgetRegistration()
    }

    /**
     * Tells a fresh JS side what the surviving SDK's registration is.
     *
     * Only reached when create() found an existing `sdk`, which means the
     * process outlived the last JS side. Without this the new JS side shows
     * NOT REGISTERED while the SDK is registered, init() returns true without
     * doing anything (sdkInitialized is still set), and register() is refused
     * by the SDK with a LOGW and no callback — RegistrationMachine::Register
     * returns early unless state is Unregistered. The user then waits forever
     * for a registration that already happened.
     *
     * Replayed as an ordinary McSdkRegistration event, so the JS side needs no
     * new code path: SdkContext's onRegistration handler already maps it to the
     * badge and the progress card.
     *
     * Nothing is replayed for a different user: after a re-login as someone
     * else the old registration is not theirs, and claiming otherwise would
     * hide that they still need to register.
     */
    private fun maybeReplayRegistration() {
        val state = lastRegistrationState ?: return
        // No identity check here: JS calls setIdentity() from its init step,
        // which is after create(), so on a fresh JS side currentMcId is still
        // null at this point and any comparison would be meaningless. Who the
        // registration belongs to is checked in register() instead, where the
        // identity has been set — see the re-registration path there.
        Log.i("McSdkBridge", "replaying registration to a new JS side: state=$state")
        emit(EVENT_REGISTRATION, Arguments.createMap().apply {
            putString("state", state)
            putString("phase", lastRegistrationPhase ?: "")
            putInt("progress", lastRegistrationProgress)
            // Marks this as a replay rather than something the SDK just said,
            // so the JS side can log it as such.
            putBoolean("replayed", true)
        })
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
     *
     * audioCodec names the AMR-WB framing the app's encoder produces — an
     * AudioCodec constant such as "AMR_WB_OCTET_ALIGNED". It is the call's only
     * audio payload type and the SDK sends the app's bytes as that, verbatim.
     * Empty leaves the choice to the SDK (its default is octet-aligned too).
     * One method rather than an overload: @ReactMethod names must be unique.
     */
    @ReactMethod
    fun startPrivateCall(mcId: String, autoCommence: Boolean, fullDuplex: Boolean, audioCodec: String) {
        val s = sdk ?: return
        if (audioCodec.isEmpty()) {
            s.startPrivateCall(mcId, autoCommence, fullDuplex)
            return
        }
        val codec = audioCodecOf(audioCodec) ?: return
        s.startPrivateCall(mcId, autoCommence, fullDuplex, codec)
    }

    /**
     * The SDK's AudioCodec for a name from JS, or null — logged — for one it
     * does not know. Refusing beats guessing: a framing the encoder does not
     * produce would reach the far end as noise.
     */
    private fun audioCodecOf(name: String): AudioCodec? =
        try {
            AudioCodec.valueOf(name)
        } catch (e: IllegalArgumentException) {
            Log.e("McSdkBridge", "unknown audio codec '$name' — call not placed/answered")
            null
        }

    /**
     * audioCodec as for startPrivateCall: the framing this device sends to the
     * group, and empty for the SDK's default. It is this member's choice only —
     * the group's other members each name their own.
     */
    @ReactMethod
    fun startGroupCall(groupId: String, audioCodec: String) {
        val s = sdk ?: return
        if (audioCodec.isEmpty()) {
            s.startGroupCall(groupId)
            return
        }
        val codec = audioCodecOf(audioCodec) ?: return
        s.startGroupCall(groupId, codec)
    }
    /**
     * A call to [groupId] on MCVideo (TS 24.281 §9.2.1), a separate call from the
     * group's MCPTT one: the SDK's calls carry one media plane each. Video goes out
     * once requestTransmission is granted; no implicit request, so that there is one
     * way to permission whatever call the group already has.
     */
    @ReactMethod
    fun startVideoGroupCall(groupId: String) {
        sdk?.startVideoGroupCall(groupId)
    }

    /**
     * A call to [mcId] on MCVideo (TS 24.281 §10.2). Video only: the SDK's MCVideo
     * calls carry no audio. It has no transmission control (§10.2.3), so both sides
     * send while it is up. autoCommence as for startPrivateCall. The SDK names the
     * codecs itself (no audio, H.264), which is what the video pipeline produces.
     */
    @ReactMethod
    fun startVideoPrivateCall(mcId: String, autoCommence: Boolean) {
        sdk?.startVideoPrivateCall(mcId, autoCommence)
    }

    /**
     * audioCodec as for startPrivateCall. Pass empty for an MCVideo call: its
     * media plane carries no audio, so it names H.264 instead. The SDK wants both
     * named, NONE for the plane the call does not carry, and refuses NONE for the
     * one it does (CALL_CODEC_INVALID).
     */
    @ReactMethod
    fun answerCall(callId: String, audioCodec: String) {
        val s = sdk ?: return
        if (audioCodec.isEmpty()) {
            s.answerCall(callId, AudioCodec.NONE, VideoCodec.H264)
            return
        }
        val codec = audioCodecOf(audioCodec) ?: return
        s.answerCall(callId, codec, VideoCodec.NONE)
    }
    @ReactMethod fun rejectCall(callId: String)      { sdk?.rejectCall(callId) }
    @ReactMethod fun terminateCall(callId: String)   { sdk?.terminateCall(callId) }

    // ── Call priority ─────────────────────────────────────────────────────────

    /**
     * Sets or clears the USER's emergency state (TS 24.379 Annex G.1), not one
     * call's — the calls follow it. Setting it re-INVITEs every active call as
     * an emergency call and makes every later call one; clearing it cancels the
     * emergency on the calls this user raised. Another user's emergency on a
     * call stays, as does one the network refused to cancel — `CallInfo.isEmergency`
     * is what says so per call.
     *
     * This took a `callId` until the SDK made it a per-user state. There is no
     * per-call setter any more, so a caller that wants one call in emergency
     * cannot have it: the state is the user's.
     *
     * `onEmergencyStateChanged` reports the state, `onCallUpdated` each call.
     */
    @ReactMethod fun setEmergency(emergency: Boolean) {
        sdk?.setEmergency(emergency)
    }

    /** Same as setEmergency but raises <imminentperil-ind>. Imminent peril
     *  shares the provisioned emergency priority — the SDK has no separate
     *  field for it. Also the user's state, not a call's. */
    @ReactMethod fun setImminentPeril(imminentPeril: Boolean) {
        sdk?.setImminentPeril(imminentPeril)
    }

    /** The user's current emergency / imminent-peril state, as the SDK holds it. */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isEmergencyState(): Boolean = sdk?.isEmergencyState ?: false

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isImminentPerilState(): Boolean = sdk?.isImminentPerilState ?: false

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

    // ── Transmission (MCVideo) ────────────────────────────────────────────────

    @ReactMethod fun requestTransmission(callId: String) { sdk?.requestTransmission(callId) }
    @ReactMethod fun endTransmission(callId: String)     { sdk?.endTransmission(callId) }
    @ReactMethod fun receiveMedia(callId: String, transmitterId: String) {
        sdk?.receiveMedia(callId, transmitterId)
    }

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
        // Which user the remembered registration belongs to. Logging in as
        // someone else must not be told "already registered" on the next
        // create(), so maybeReplayRegistration() compares against this.
        currentMcId = mcId
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

    /**
     * Registers, re-registering first if the SDK is already registered.
     *
     * RegistrationMachine::Register returns early unless state is Unregistered,
     * with a LOGW and no callback at all — not even onSdkError. On a process
     * that outlived its JS side that is exactly the state we are in, so a plain
     * register() would be silently refused and the app would wait forever.
     *
     * So when the SDK is already registered this drops the registration first
     * and registers again once the SDK reports Unregistered. That is observable:
     * RegistrationMachine sets state = Unregistered and then notifies, which
     * reaches onRegistrationProgress like any other phase.
     *
     * Re-registering (rather than just reporting success) is what makes a
     * re-login work: the surviving registration belongs to whoever was logged
     * in before, and the server has to be told about the new identity.
     */
    @ReactMethod
    fun register() {
        val s = sdk ?: return
        if (!isRegistered()) {
            s.register()
            return
        }
        Log.i(
            "McSdkBridge",
            "register() while registered as '$registeredMcId' (now '$currentMcId')" +
                " — unregistering first",
        )
        pendingReRegister = true
        s.unregister()
        // If the teardown never completes, do not leave the app waiting on a
        // registration that will never be requested.
        reRegisterTimeout?.cancel()
        reRegisterTimeout = java.util.Timer().also { t ->
            t.schedule(
                object : java.util.TimerTask() {
                    override fun run() {
                        if (!pendingReRegister) return
                        pendingReRegister = false
                        Log.w("McSdkBridge", "re-register timed out waiting for Unregistered")
                        emit(EVENT_SDK_ERROR, Arguments.createMap().apply {
                            putString("error", "REGISTRATION_RETRY_TIMEOUT")
                        })
                    }
                },
                RE_REGISTER_TIMEOUT_MS,
            )
        }
    }

    @ReactMethod
    fun unregister() {
        // A deliberate unregister is not a step towards registering again.
        pendingReRegister = false
        reRegisterTimeout?.cancel()
        reRegisterTimeout = null
        sdk?.unregister()
    }

    // ── Required by RCTEventEmitter protocol (JS side calls addListener) ──────

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ── SdkListener ───────────────────────────────────────────────────────────

    override fun onReady() {
        sdkInitialized = true
        initPromise?.resolve(true)
        initPromise = null
        emit(EVENT_READY, Arguments.createMap())
    }

    override fun onTerminated() {
        emit(EVENT_TERMINATED, Arguments.createMap())
    }

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
        rememberRegistration(state.name, phase.name, progress)
        emit(EVENT_REGISTRATION, Arguments.createMap().apply {
            putString("state", state.name)
            putString("phase", phase.name)
            putInt("progress", progress)
        })
        // The re-register from register() waits for this: Register() only runs
        // from Unregistered. Done after the emit so JS sees the teardown reach
        // its end before the new attempt starts.
        if (pendingReRegister && state == RegistrationState.UNREGISTERED) {
            pendingReRegister = false
            reRegisterTimeout?.cancel()
            reRegisterTimeout = null
            Log.i("McSdkBridge", "unregister complete — registering again as '$currentMcId'")
            sdk?.register()
        }
    }

    override fun onRegistered() {
        rememberRegistration("REGISTERED", "DONE", 100)
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
        rememberRegistration("FAILED", phase.name, 0)
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
     * Everything emitted here also lands in the logs, so only whether one is
     * present goes across.
     */
    override fun onIdentityUpdated(identity: IdentityInfo) {
        emit(EVENT_IDENTITY_UPDATED, Arguments.createMap().apply {
            putBoolean("isPtt",   identity.isPtt)
            putBoolean("isVideo", identity.isVideo)
            putBoolean("isData",  identity.isData)
            putBoolean("hasToken", !identity.token.isNullOrEmpty())
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
        putInt("sipCode", c.sipCode)
        putString("sipReason", c.sipReason)
        // Added in 98fb4c6. isFloorControlEnabled tells a full-duplex private
        // call (§11.1.2) from a PTT one; isVideo marks an MCVideo call, which
        // must be answered without an audio codec.
        putBoolean("isFloorControlEnabled", c.isFloorControlEnabled)
        putBoolean("isVideo", c.isVideo)
        putBoolean("isAutoCommencement", c.isAutoCommencement)
    }

    override fun onIncomingCall(callInfo: CallInfo) {
        activeCallIds.add(callInfo.callId)
        emit(EVENT_INCOMING_CALL, callInfoToMap(callInfo))
    }

    override fun onCallUpdated(callInfo: CallInfo) {
        // Tracked only so a closing app can tell whether killing the process
        // would drop a live call. Any state the SDK reports counts as "up"; the
        // call leaves the set in onCallTerminated.
        activeCallIds.add(callInfo.callId)
        emit(EVENT_CALL_UPDATED, callInfoToMap(callInfo))
    }

    override fun onCallTerminated(terminationInfo: TerminationInfo) {
        activeCallIds.remove(terminationInfo.callId)
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
            // Floor Indicator bits, already decoded by the SDK's helpers. The raw
            // value goes along for the logs, in case a bit has no helper yet.
            putInt("floorIndicator", floorInfo.floorIndicator)
            putBoolean("isNormalCall", floorInfo.isNormalCall())
            putBoolean("isBroadcastCall", floorInfo.isBroadcastCall())
            putBoolean("isSystemCall", floorInfo.isSystemCall())
            putBoolean("isQueueingSupported", floorInfo.isQueueingSupported())
            putBoolean("isDualFloor", floorInfo.isDualFloor())
            putBoolean("isTemporaryGroup", floorInfo.isTemporaryGroup())
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

    // ── MCData: SDS (short data) and FD (file distribution) ───────────────────
    //
    // The SDK gained these callbacks and declared them abstract — no default
    // bodies — so SdkListener cannot be implemented without them. The app has
    // no MCData feature yet: nothing sends an SDS message or a file, and no
    // screen would show one arriving.
    //
    // So they are stubs, and deliberately not wired to emit(). Bridging an
    // event to JS that no JS subscriber reads would put a WritableMap build on
    // the SDK worker thread for nothing — the thread the event pump exists to
    // keep free. They log instead, at debug, so a message that does arrive is
    // visible in logcat rather than silently dropped.
    //
    // When MCData is built: give each one an EVENT_* name, emit() it, and add
    // it to McSdkEvents on the JS side — onAnyEvent picks it up from there and
    // the Log Console shows it with no further work.

    override fun onSdsSent(sds: SdsInfo) {
        Log.d("McSdkBridge", "onSdsSent (MCData not implemented) id=${sds.messageId}")
    }

    override fun onSdsSendFailed(sds: SdsInfo) {
        Log.d("McSdkBridge", "onSdsSendFailed (MCData not implemented) id=${sds.messageId}")
    }

    override fun onSdsDelivered(info: SdsNotificationInfo) {
        Log.d("McSdkBridge", "onSdsDelivered (MCData not implemented) id=${info.messageId}")
    }

    override fun onSdsRead(info: SdsNotificationInfo) {
        Log.d("McSdkBridge", "onSdsRead (MCData not implemented) id=${info.messageId}")
    }

    override fun onSdsReceived(sds: SdsInfo) {
        Log.d("McSdkBridge", "onSdsReceived (MCData not implemented) id=${sds.messageId}")
    }

    override fun onSdsNotificationSent(info: SdsNotificationInfo) {
        Log.d("McSdkBridge", "onSdsNotificationSent (MCData not implemented) id=${info.messageId}")
    }

    override fun onSdsNotificationSendFailed(info: SdsNotificationInfo) {
        Log.d("McSdkBridge", "onSdsNotificationSendFailed (MCData not implemented) id=${info.messageId}")
    }

    override fun onFdSent(fd: FdInfo) {
        Log.d("McSdkBridge", "onFdSent (MCData not implemented) id=${fd.messageId}")
    }

    override fun onFdSendFailed(fd: FdInfo) {
        Log.d("McSdkBridge", "onFdSendFailed (MCData not implemented) id=${fd.messageId}")
    }

    override fun onFdAccepted(info: FdNotificationInfo) {
        Log.d("McSdkBridge", "onFdAccepted (MCData not implemented) id=${info.messageId}")
    }

    override fun onFdRejected(info: FdNotificationInfo) {
        Log.d("McSdkBridge", "onFdRejected (MCData not implemented) id=${info.messageId}")
    }

    override fun onFdCompleted(info: FdNotificationInfo) {
        Log.d("McSdkBridge", "onFdCompleted (MCData not implemented) id=${info.messageId}")
    }

    override fun onFdReceived(fd: FdInfo) {
        Log.d("McSdkBridge", "onFdReceived (MCData not implemented) id=${fd.messageId}")
    }

    override fun onFdDownloaded(fd: FdInfo) {
        Log.d("McSdkBridge", "onFdDownloaded (MCData not implemented) id=${fd.messageId}")
    }

    override fun onFdDownloadFailed(fd: FdInfo) {
        Log.d("McSdkBridge", "onFdDownloadFailed (MCData not implemented) id=${fd.messageId}")
    }

    override fun onFdNotificationSent(info: FdNotificationInfo) {
        Log.d("McSdkBridge", "onFdNotificationSent (MCData not implemented) id=${info.messageId}")
    }

    override fun onFdNotificationSendFailed(info: FdNotificationInfo) {
        Log.d("McSdkBridge", "onFdNotificationSendFailed (MCData not implemented) id=${info.messageId}")
    }

    override fun onFdUnavailable(info: FdNotificationInfo) {
        Log.d("McSdkBridge", "onFdUnavailable (MCData not implemented) id=${info.messageId}")
    }

    /**
     * The server telling us how it wants location reported. A stub for the same
     * reason as the MCData ones: the app reports no location, so there is
     * nothing to reconfigure. Logged so the arrival of a configuration is
     * visible if location work starts.
     */
    override fun onLocationConfigurationUpdated(info: LocationConfigurationInfo) {
        Log.d("McSdkBridge", "onLocationConfigurationUpdated (location not implemented)")
    }

    /**
     * MCVideo transmission control (TS 24.581 §6.2): our own permission to send
     * video. SSRCs are unsigned 32-bit in Java's long; a double carries them exactly.
     */
    override fun onTransmissionUpdated(transmissionInfo: TransmissionInfo) {
        emit(EVENT_TRANSMISSION_UPDATED, Arguments.createMap().apply {
            putString("callId", transmissionInfo.callId)
            putString("status", transmissionInfo.status.name)
            putInt("queuePosition", transmissionInfo.queuePosition)
            putInt("queuePriority", transmissionInfo.queuePriority)
            putInt("grantedDuration", transmissionInfo.grantedDuration)
            putInt("grantedPriority", transmissionInfo.grantedPriority)
            putDouble("audioSsrc", transmissionInfo.audioSsrc.toDouble())
            putDouble("videoSsrc", transmissionInfo.videoSsrc.toDouble())
            putString("rejectReason", transmissionInfo.rejectReason.name)
            putString("revokeReason", transmissionInfo.revokeReason.name)
            putBoolean("isEmergency", transmissionInfo.isEmergency)
            putBoolean("isImminentPeril", transmissionInfo.isImminentPeril)
            putBoolean("isBroadcast", transmissionInfo.isBroadcast)
            putInt("transmissionIndicator", transmissionInfo.transmissionIndicator)
        })
    }

    /** MCVideo: one remote transmitter's stream from our side. */
    override fun onReceptionUpdated(receptionInfo: ReceptionInfo) {
        emit(EVENT_RECEPTION_UPDATED, Arguments.createMap().apply {
            putString("callId", receptionInfo.callId)
            putString("transmitterId", receptionInfo.transmitterId)
            putString("functionalAlias", receptionInfo.functionalAlias)
            putDouble("audioSsrc", receptionInfo.audioSsrc.toDouble())
            putDouble("videoSsrc", receptionInfo.videoSsrc.toDouble())
            putString("status", receptionInfo.status.name)
            putBoolean("automatic", receptionInfo.automatic)
            putString("overridingId", receptionInfo.overridingId)
            putString("rejectReason", receptionInfo.rejectReason.name)
        })
    }

    /**
     * A call's audio stream: what SDP settled on. Once per stream, so it goes
     * through the event queue like the rest. Nothing in JS acts on it yet; the
     * event log is the point for now — it shows the negotiated AMR-WB framing
     * (fmtp) without digging the SDP out of the SIP bodies.
     *
     * Its sibling onAudioFrame below does NOT take this path: frames must never
     * be queued to JS.
     */
    override fun onAudioInfoUpdated(audioInfo: AudioInfo) {
        emit(EVENT_AUDIO_INFO_UPDATED, Arguments.createMap().apply {
            putString("callId", audioInfo.callId)
            putString("encoding", audioInfo.format?.encoding ?: "")
            // Unsigned 32-bit in Java's long; a double carries it exactly.
            putDouble("clockRate", (audioInfo.format?.clockRate ?: 0L).toDouble())
            putString("fmtp", audioInfo.format?.fmtp ?: "")
            putString("path", audioInfo.path?.name ?: "")
            putBoolean("encrypted", audioInfo.encrypted)
        })
    }

    /**
     * A call's video stream: what SDP settled on, and whether RTP is arriving,
     * which is the one field that changes. Nothing in JS acts on it yet; on the
     * receiving phone FLOWING is the first proof that the sender's video got here.
     */
    override fun onVideoUpdated(videoInfo: VideoInfo) {
        emit(EVENT_VIDEO_UPDATED, Arguments.createMap().apply {
            putString("callId", videoInfo.callId)
            putString("encoding", videoInfo.format?.encoding ?: "")
            // Unsigned 32-bit in Java's long; a double carries it exactly.
            putDouble("clockRate", (videoInfo.format?.clockRate ?: 0L).toDouble())
            putString("fmtp", videoInfo.format?.fmtp ?: "")
            putString("flow", videoInfo.flow?.name ?: "")
            putString("path", videoInfo.path?.name ?: "")
            putBoolean("encrypted", videoInfo.encrypted)
        })
    }

    /**
     * One received audio frame of a call, ~50 a second on the SDK's media
     * thread. Straight to the native audio pipeline through CallAudioRouter:
     * no event queue, no JS, no log line — while this runs the SDK is not
     * reading its socket, and anything slow here would be heard as loss.
     *
     * An empty frame is one the SDK marks lost; it carries no speech, and the
     * jitter buffer conceals the gap on its own.
     */
    override fun onAudioFrame(frame: AudioFrame) {
        val data = frame.data ?: return
        if (data.isEmpty()) return
        CallAudioRouter.deliver(frame.callId, frame.ssrc, data, frame.timestampUs, frame.firstOfBurst)
    }

    /**
     * One received video frame of a call, on the SDK's media thread. Straight to the
     * native receiver through CallVideoRouter, never to JS, for the same reason as
     * onAudioFrame. The occasional count shows frames arrive with nobody watching too.
     */
    override fun onVideoFrame(frame: VideoFrame) {
        val data = frame.data ?: return
        val count = CallVideoRouter.deliver(frame.callId, frame.ssrc, data, frame.timestampUs, frame.keyFrame)
        if (count % VIDEO_RECEIVED_LOG_EVERY == 1) {
            Log.d(
                "McSdkBridge",
                "video received: frames=$count keys=${CallVideoRouter.keyFramesReceived} " +
                    "ssrc=${frame.ssrc} last=${data.size} bytes",
            )
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
