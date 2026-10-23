package com.aselsan.mcsdk.rn.media

import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.telephony.TelephonyManager
import android.util.Log

/**
 * AudioSessionManager — owns the device-level audio session for MC calls.
 *
 * Three jobs, none of which need media data to flow, which is why this lands
 * before the capture/playback pipeline:
 *
 *  1. Put the device in communication mode. MODE_IN_COMMUNICATION is what opens
 *     the telephony audio path and arms the hardware echo canceller; without it
 *     MediaRecorder.AudioSource.VOICE_COMMUNICATION behaves like a plain mic.
 *  2. Hold audio focus, so music pauses for a call and resumes after.
 *  3. Route the call — earpiece / speaker / wired headset / Bluetooth — and
 *     notice when the route disappears or a GSM call interrupts us.
 *
 * Lifecycle is strict: [enterCallMode] must be paired with [exitCallMode] on
 * every path, error paths included. MODE_IN_COMMUNICATION is a device-global
 * setting; leaving it set makes the app's other sounds (notifications, the
 * ringer) behave oddly long after the call is gone.
 */
class AudioSessionManager(private val context: Context) {

    companion object {
        private const val TAG = "McSdkAudio"
    }

    /** What interrupted us, reported to the app so it can drop the floor. */
    enum class Interruption { PHONE_CALL, ROUTE_LOST, FOCUS_LOST }

    private val audioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var focusRequest: AudioFocusRequest? = null
    private var previousMode: Int = AudioManager.MODE_NORMAL
    private var inCallMode = false

    private var echoCanceler: AcousticEchoCanceler? = null
    private var noiseSuppressor: NoiseSuppressor? = null

    /** Set by the owner to be told about interruptions. */
    var onInterruption: ((Interruption) -> Unit)? = null

    // ── Call mode ─────────────────────────────────────────────────────────────

    /**
     * Enters communication mode and takes transient audio focus. Idempotent.
     * Returns false when focus was refused — the caller should not start
     * capture, since another app owns the audio device.
     */
    fun enterCallMode(): Boolean {
        if (inCallMode) return true

        previousMode = audioManager.mode

        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

        // TRANSIENT (not EXCLUSIVE): a media player should duck or pause and
        // then come back, which is what a PTT burst wants.
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                        Log.d(TAG, "audio focus lost ($change)")
                        onInterruption?.invoke(Interruption.FOCUS_LOST)
                    }
                }
            }
            .build()

        val granted = audioManager.requestAudioFocus(request)
        if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            Log.w(TAG, "audio focus refused: $granted")
            return false
        }
        focusRequest = request

        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        inCallMode = true
        registerReceivers()
        // Read back rather than assume: on API 28 the setter was observed to be
        // a no-op (mode stayed 0), and the legacy speaker flag only applies
        // while the mode is actually MODE_IN_COMMUNICATION. Knowing which case
        // we are in is the difference between routing working and failing
        // silently.
        Log.d(TAG, "entered call mode (previous=$previousMode, " +
                   "requested=${AudioManager.MODE_IN_COMMUNICATION}, " +
                   "effective=${audioManager.mode})")
        return true
    }

    /** Leaves communication mode and drops focus. Safe to call when not in it. */
    fun exitCallMode() {
        if (!inCallMode) return
        inCallMode = false

        unregisterReceivers()
        releaseEffects()
        // SCO is device-global like the mode: leaving it up keeps the headset's
        // call channel open after we are done with it.
        stopSco()

        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null

        // Restore rather than assume MODE_NORMAL: another component may have
        // had the device in a different mode before the call.
        audioManager.mode = previousMode
        Log.d(TAG, "exited call mode (restored $previousMode)")
    }

    val isInCallMode: Boolean get() = inCallMode

    // ── Routing ───────────────────────────────────────────────────────────────

    /**
     * Where call audio should go.
     *
     * BLUETOOTH is its own case rather than a kind of "headset": Bluetooth call
     * audio runs over SCO/HFP, a separate profile from the A2DP link that
     * carries music, and SCO does not come up on its own — it has to be started
     * and then waited for. Measured on this device with a Jabra Elite 4
     * connected: the headset profile was CONNECTED, yet
     * `setForceUse(FOR_COMMUNICATION, FORCE_NONE)` and an empty SCO client list
     * meant call audio still went to the speaker.
     */
    enum class Route { EARPIECE, SPEAKER, BLUETOOTH }

    /**
     * What the app last asked for. Re-applied by [reapplyRouting] once the audio
     * mode is up, because below API 31 the speaker flag is a property of
     * MODE_IN_COMMUNICATION and a choice made before that is dropped.
     */
    private var routeWanted = Route.EARPIECE

    /** True once SCO has reported CONNECTED, so audio is really on the headset. */
    @Volatile
    var scoConnected = false
        private set

    /** Selects the output route. For BLUETOOTH this starts SCO asynchronously —
     *  [scoConnected] turns true when it is actually usable. */
    fun setRoute(route: Route) {
        routeWanted = route
        when (route) {
            Route.BLUETOOTH -> startSco()
            else -> {
                // Drop SCO first: while it is up the platform keeps call audio
                // on the headset and the speaker flag has no effect.
                stopSco()
                applySpeaker(route == Route.SPEAKER)
            }
        }
    }

    /** Back-compatible shim: true = speaker, false = earpiece. */
    fun setSpeakerphone(on: Boolean) =
        setRoute(if (on) Route.SPEAKER else Route.EARPIECE)

    /** Re-applies the remembered route. Called after entering call mode. */
    fun reapplyRouting() {
        setRoute(routeWanted)
    }

    private fun applySpeaker(on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val target = if (on) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                         else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            val device = audioManager.availableCommunicationDevices
                .firstOrNull { it.type == target }
            if (device != null) {
                val ok = audioManager.setCommunicationDevice(device)
                Log.d(TAG, "setCommunicationDevice(${device.type}) -> $ok")
                return
            }
            Log.w(TAG, "no communication device of type $target")
        }

        // Legacy path. The flag only applies while the device is in
        // MODE_IN_COMMUNICATION, so the read-back says which of the two failed
        // when routing does not change.
        @Suppress("DEPRECATION")
        run {
            audioManager.isSpeakerphoneOn = on
            val effective = audioManager.isSpeakerphoneOn
            if (effective != on) {
                Log.w(TAG, "routing REFUSED: asked speaker=$on, got $effective " +
                           "(mode=${audioManager.mode}, " +
                           "expected=${AudioManager.MODE_IN_COMMUNICATION})")
            } else {
                Log.d(TAG, "routing applied: speaker=$on (mode=${audioManager.mode})")
            }
        }
    }

    // ── Bluetooth SCO ─────────────────────────────────────────────────────────

    /**
     * Brings up the Bluetooth call-audio channel.
     *
     * Asynchronous by nature: startBluetoothSco() only requests the link, and
     * audio keeps going to the previous route until SCO_AUDIO_STATE_CONNECTED
     * arrives — typically a few hundred milliseconds. Playback started before
     * that will have its first moments come out of the speaker, which is why
     * [scoConnected] is exposed rather than assumed.
     */
    private fun startSco() {
        // SCO only comes up while the device is in communication mode. Asking
        // for it beforehand produces the state seen in testing: a CONNECTED
        // event from an earlier attempt arriving before the new request, so the
        // flag looked set while audio was still elsewhere. reapplyRouting()
        // calls this again once the mode is up.
        if (!inCallMode) {
            Log.d(TAG, "SCO deferred: not in call mode yet")
            return
        }
        if (scoConnected) return

        if (!audioManager.isBluetoothScoAvailableOffCall) {
            Log.w(TAG, "SCO not available off-call on this device")
        }
        // Registered fresh each time so a stale CONNECTED from a previous
        // attempt cannot be mistaken for this one.
        unregisterScoReceiver()
        registerScoReceiver()
        try {
            @Suppress("DEPRECATION")
            run {
                audioManager.startBluetoothSco()
                audioManager.isBluetoothScoOn = true
            }
            Log.d(TAG, "startBluetoothSco requested (awaiting CONNECTED)")
        } catch (e: Exception) {
            Log.e(TAG, "startBluetoothSco failed: ${e.message}", e)
        }
    }

    private fun stopSco() {
        val had = scoConnected || scoReceiver != null
        try {
            @Suppress("DEPRECATION")
            run {
                audioManager.isBluetoothScoOn = false
                audioManager.stopBluetoothSco()
            }
        } catch (e: Exception) {
            Log.w(TAG, "stopBluetoothSco failed: ${e.message}")
        }
        scoConnected = false
        unregisterScoReceiver()
        if (had) Log.d(TAG, "SCO stopped")
    }

    private var scoReceiver: BroadcastReceiver? = null

    private fun registerScoReceiver() {
        if (scoReceiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                @Suppress("DEPRECATION")
                val state = intent?.getIntExtra(
                    AudioManager.EXTRA_SCO_AUDIO_STATE,
                    AudioManager.SCO_AUDIO_STATE_ERROR,
                ) ?: return
                @Suppress("DEPRECATION")
                when (state) {
                    AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                        scoConnected = true
                        Log.d(TAG, "SCO CONNECTED — call audio is on the headset")
                    }
                    AudioManager.SCO_AUDIO_STATE_DISCONNECTED -> {
                        val wasConnected = scoConnected
                        scoConnected = false
                        Log.d(TAG, "SCO DISCONNECTED")
                        // Only an unexpected drop is an interruption; a
                        // disconnect we asked for is not.
                        if (wasConnected && routeWanted == Route.BLUETOOTH) {
                            onInterruption?.invoke(Interruption.ROUTE_LOST)
                        }
                    }
                    AudioManager.SCO_AUDIO_STATE_ERROR -> {
                        scoConnected = false
                        Log.w(TAG, "SCO ERROR — headset did not accept the link")
                    }
                }
            }
        }
        @Suppress("DEPRECATION")
        context.registerReceiver(r, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
        scoReceiver = r
    }

    private fun unregisterScoReceiver() {
        scoReceiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (e: IllegalArgumentException) {
                Log.d(TAG, "SCO receiver was not registered: ${e.message}")
            }
        }
        scoReceiver = null
    }

    /** True when a Bluetooth headset is paired and connected for calls. */
    fun hasBluetoothHeadset(): Boolean =
        audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        }

    /** True when a wired or Bluetooth headset is connected. */
    fun hasHeadset(): Boolean =
        audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
            it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        }

    // ── Echo cancellation / noise suppression ─────────────────────────────────

    /**
     * Attaches the platform AEC and NS to a capture session. Call with
     * AudioRecord.getAudioSessionId() once capture exists.
     *
     * Both are hardware-backed and genuinely absent on some devices, so the
     * result is reported rather than assumed: half-duplex PTT tolerates no AEC,
     * but a full-duplex private call without it will echo, and the app needs to
     * know which it is dealing with.
     */
    fun attachEffects(audioSessionId: Int): EffectSupport {
        releaseEffects()

        val aecAvailable = AcousticEchoCanceler.isAvailable()
        val nsAvailable = NoiseSuppressor.isAvailable()

        if (aecAvailable) {
            echoCanceler = AcousticEchoCanceler.create(audioSessionId)?.apply {
                enabled = true
            }
        }
        if (nsAvailable) {
            noiseSuppressor = NoiseSuppressor.create(audioSessionId)?.apply {
                enabled = true
            }
        }

        val support = EffectSupport(
            aec = echoCanceler?.enabled == true,
            ns = noiseSuppressor?.enabled == true,
        )
        Log.d(TAG, "effects: aec=${support.aec} (available=$aecAvailable) " +
                   "ns=${support.ns} (available=$nsAvailable)")
        return support
    }

    /** What the device actually gave us, as opposed to what we asked for. */
    data class EffectSupport(val aec: Boolean, val ns: Boolean)

    /** Probes AEC/NS support without a capture session, for diagnostics. */
    fun probeEffectSupport(): EffectSupport =
        EffectSupport(AcousticEchoCanceler.isAvailable(), NoiseSuppressor.isAvailable())

    private fun releaseEffects() {
        echoCanceler?.release()
        echoCanceler = null
        noiseSuppressor?.release()
        noiseSuppressor = null
    }

    // ── Interruptions ─────────────────────────────────────────────────────────

    private var receiver: BroadcastReceiver? = null

    private fun registerReceivers() {
        if (receiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                when (intent?.action) {
                    AudioManager.ACTION_AUDIO_BECOMING_NOISY -> {
                        // The headset was unplugged: audio is about to blast out
                        // of the speaker. Treat it as losing the route.
                        Log.d(TAG, "audio becoming noisy — headset removed")
                        onInterruption?.invoke(Interruption.ROUTE_LOST)
                    }
                    TelephonyManager.ACTION_PHONE_STATE_CHANGED -> {
                        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
                        if (state == TelephonyManager.EXTRA_STATE_RINGING ||
                            state == TelephonyManager.EXTRA_STATE_OFFHOOK) {
                            Log.d(TAG, "cellular call ($state) — interrupting")
                            onInterruption?.invoke(Interruption.PHONE_CALL)
                        }
                    }
                    android.bluetooth.BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED -> {
                        val state = intent.getIntExtra(
                            android.bluetooth.BluetoothProfile.EXTRA_STATE,
                            BluetoothProfile.STATE_DISCONNECTED,
                        )
                        if (state == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.d(TAG, "bluetooth headset disconnected")
                            onInterruption?.invoke(Interruption.ROUTE_LOST)
                        }
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
            addAction(TelephonyManager.ACTION_PHONE_STATE_CHANGED)
            addAction(android.bluetooth.BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
        }
        context.registerReceiver(r, filter)
        receiver = r
    }

    private fun unregisterReceivers() {
        receiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (e: IllegalArgumentException) {
                // Already gone; nothing to undo.
                Log.d(TAG, "receiver was not registered: ${e.message}")
            }
        }
        receiver = null
    }
}
