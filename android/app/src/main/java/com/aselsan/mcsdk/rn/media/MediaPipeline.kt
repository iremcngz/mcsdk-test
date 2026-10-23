package com.aselsan.mcsdk.rn.media

import android.content.Context
import android.util.Log
import java.io.File

/**
 * MediaPipeline — brings the uplink up and down in the right order.
 *
 * The pieces each do one job; the ordering between them is the job here, and
 * getting it wrong fails in ways that are hard to read:
 *
 *   1. claim the microphone   — evicts the level meter, which would otherwise
 *                               be holding the one physical mic
 *   2. enter communication mode — opens the telephony audio path and arms the
 *                               hardware echo canceller; without it
 *                               VOICE_COMMUNICATION behaves like a plain mic
 *   3. open the sink          — starts its writer thread, ready before frames
 *   4. start capture          — the real-time loop
 *   5. attach AEC/NS          — needs capture's audioSessionId, so it can only
 *                               happen after step 4
 *
 * Teardown is the exact reverse, and runs on EVERY failure path. That matters
 * most for step 2: MODE_IN_COMMUNICATION is device-global state, so leaking it
 * leaves the phone's other sounds misbehaving long after this pipeline is gone.
 *
 * The destination is an [AudioFrameSink], so the SDK is not involved and does
 * not need to be: today a file, later UDP, eventually sdk.sendEncodedFrame().
 */
class MediaPipeline(context: Context) {

    companion object {
        private const val TAG = "McSdkPipeline"
    }

    private val session = AudioSessionManager(context)
    private val mediaDir = File(context.cacheDir, "media")

    private var capture: AudioCapture? = null
    private var sink: FileFrameSink? = null
    private var codec: AudioCodec? = null

    /** Last failure, surfaced to the UI instead of being logged and lost. */
    @Volatile
    var lastError: String? = null
        private set

    /** What the device gave us when AEC/NS were requested. */
    @Volatile
    var effects: AudioSessionManager.EffectSupport? = null
        private set

    val isRunning: Boolean get() = capture?.isRunning == true

    /** Snapshot for the diagnostics screen. Cheap enough to poll once a second. */
    data class Stats(
        val running: Boolean,
        val transmitting: Boolean,
        val codecName: String,
        val sinkName: String,
        /** Frames read off the device. */
        val capturedFrames: Int,
        /** Frames encoded and handed to the sink (lower than captured while muted). */
        val encodedFrames: Int,
        /** Frames the sink could not take — must stay 0. */
        val droppedFrames: Int,
        val bytesWritten: Int,
        /** RTP timestamp, in samples. */
        val timestamp: Int,
        /** Media seconds captured, derived from the timestamp, not the clock. */
        val mediaSeconds: Double,
        val filePath: String?,
        val aec: Boolean,
        val ns: Boolean,
        val error: String?,
    )

    fun stats(): Stats {
        val c = capture
        val s = sink
        val cd = codec
        val ts = c?.rtpTimestamp ?: 0
        return Stats(
            running = c?.isRunning == true,
            transmitting = c?.isTransmitting == true,
            codecName = cd?.name ?: "-",
            sinkName = s?.name ?: "-",
            capturedFrames = c?.capturedFrames ?: 0,
            encodedFrames = c?.encodedFrames ?: 0,
            droppedFrames = s?.droppedFrames ?: 0,
            bytesWritten = s?.bytesWritten ?: 0,
            timestamp = ts,
            mediaSeconds = if (cd != null && cd.sampleRate > 0) ts.toDouble() / cd.sampleRate else 0.0,
            filePath = s?.path,
            aec = effects?.aec == true,
            ns = effects?.ns == true,
            error = lastError ?: c?.lastError,
        )
    }

    /**
     * Starts capture into a timestamped file under cacheDir/media.
     *
     * The caller must already hold RECORD_AUDIO — AudioRecord does not report a
     * missing permission, it just yields silence, so the permission check lives
     * in the bridge where it can prompt.
     *
     * @return the output path, or null on failure with [lastError] set.
     */
    @Synchronized
    fun startFileCapture(codecName: String): String? {
        if (isRunning) {
            lastError = "already running"
            return null
        }
        lastError = null
        effects = null

        val cd = when (codecName.uppercase()) {
            "PCMU" -> PcmuCodec()
            "AMR-WB", "AMRWB" -> {
                // Unlike PCMU's lookup table, this opens a MediaCodec instance,
                // which can fail on a device without the encoder — so it is
                // started here, before any resource is claimed.
                val amr = AmrWbCodec()
                if (!amr.start()) {
                    lastError = amr.lastError ?: "AMR-WB encoder unavailable"
                    Log.e(TAG, lastError!!)
                    return null
                }
                amr
            }
            else -> {
                lastError = "unknown codec '$codecName'"
                Log.e(TAG, lastError!!)
                return null
            }
        }

        // One physical microphone: MEDIA outranks METER, so this evicts the
        // level meter rather than silently fighting it for the device.
        // The codec is already open at this point, so every early return from
        // here on has to release it.
        if (!MicrophoneOwner.claim(MicrophoneOwner.Claimant.MEDIA)) {
            lastError = "microphone is held by ${MicrophoneOwner.heldBy()}"
            Log.e(TAG, lastError!!)
            cd.release()
            return null
        }

        // Through the counter, not enterCallMode() directly: playback may
        // already hold the session, and stopping capture must not drop the mode
        // out from under it.
        if (!acquireSession()) {
            lastError = "audio focus refused — another app owns the audio device"
            Log.e(TAG, lastError!!)
            cd.release()
            MicrophoneOwner.release(MicrophoneOwner.Claimant.MEDIA)
            return null
        }

        val file = File(mediaDir, "capture-${System.currentTimeMillis()}.${cd.name.lowercase()}")
        val fileSink = FileFrameSink(file)
        val cap = AudioCapture(cd)

        try {
            fileSink.open(cd)
        } catch (e: Exception) {
            lastError = "could not open ${file.name}: ${e.message}"
            Log.e(TAG, lastError!!, e)
            teardown(cap = null, snk = null, cd = cd)
            return null
        }

        if (!cap.start(fileSink)) {
            lastError = cap.lastError ?: "capture failed to start"
            Log.e(TAG, lastError!!)
            teardown(cap = null, snk = fileSink, cd = cd)
            return null
        }

        // Only possible now: the effects bind to capture's session id.
        effects = session.attachEffects(cap.audioSessionId)

        capture = cap
        sink = fileSink
        codec = cd
        Log.d(TAG, "started: codec=${cd.name} file=${file.name} " +
                   "aec=${effects?.aec} ns=${effects?.ns}")
        return file.absolutePath
    }

    /**
     * Stops capture and releases everything. Returns the finished file's path.
     *
     * Safe to call when not running: teardown is idempotent, because it also
     * serves as the cleanup path for a half-built start.
     */
    @Synchronized
    fun stop(): String? {
        val path = sink?.path
        teardown(capture, sink, codec)
        capture = null
        sink = null
        codec = null
        return path
    }

    /** Gates the uplink without tearing capture down. Floor control lands here. */
    fun setTransmitEnabled(enabled: Boolean) {
        capture?.setTransmitEnabled(enabled)
    }

    /**
     * Reverse of start, tolerant of partial construction. Each step is
     * independent so an exception in one cannot strand the others — leaving
     * MODE_IN_COMMUNICATION set is the worst of those, since it is device-wide.
     */
    private fun teardown(cap: AudioCapture?, snk: FileFrameSink?, cd: AudioCodec?) {
        try {
            cap?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "capture stop failed: ${e.message}")
        }
        try {
            // After capture: the writer thread drains what is still buffered.
            snk?.close()
        } catch (e: Exception) {
            Log.w(TAG, "sink close failed: ${e.message}")
        }
        try {
            // AMR-WB holds a native MediaCodec; without this every stop leaks an
            // encoder instance, and the device only has so many.
            cd?.release()
        } catch (e: Exception) {
            Log.w(TAG, "codec release failed: ${e.message}")
        }
        releaseSession()
        MicrophoneOwner.release(MicrophoneOwner.Claimant.MEDIA)
    }

    // ── Downlink ──────────────────────────────────────────────────────────────
    // Independent of the uplink by design: capture and playback can run alone or
    // together, and neither tears the other down. They share only the audio
    // session, which is reference-counted below.

    private var source: FileFrameSource? = null
    private var jitter: JitterBuffer? = null
    private var playback: AudioPlayback? = null
    private var playCodec: AudioCodec? = null

    /**
     * How many of capture/playback are using the audio session. enterCallMode()
     * is device-global state, so stopping one direction must not drop the mode
     * out from under the other.
     */
    private var sessionUsers = 0

    data class PlaybackStats(
        val running: Boolean,
        /** True when the stream ran out and playback stopped by itself. */
        val finished: Boolean,
        val codecName: String,
        val sourceName: String,
        val filePath: String?,
        /** Frames the jitter buffer accepted. */
        val receivedFrames: Int,
        /** Frames parsed out of the file. */
        val sourceRead: Int,
        /** Frames the source withheld on purpose — proves the impairment ran. */
        val sourceDropped: Int,
        val impairment: String,
        /** Frames handed to the decoder in order. */
        val playedFrames: Int,
        /** Frames written to the device, silence included. */
        val writtenFrames: Int,
        /** Gaps filled by repeating the previous frame. */
        val concealedFrames: Int,
        /** Nothing to play and nothing to repeat — must stay 0. */
        val underrunFrames: Int,
        val lateFrames: Int,
        val duplicateFrames: Int,
        val jitterDepth: Int,
        val error: String?,
    )

    fun playbackStats(): PlaybackStats {
        val p = playback
        val j = jitter
        val s = source
        return PlaybackStats(
            running = p?.isRunning == true,
            finished = p?.isFinished == true,
            codecName = playCodec?.name ?: "-",
            sourceName = s?.name ?: "-",
            filePath = s?.path,
            receivedFrames = j?.receivedFrames ?: 0,
            sourceRead = s?.framesRead ?: 0,
            sourceDropped = s?.framesDropped ?: 0,
            impairment = s?.impairmentName ?: "-",
            playedFrames = j?.playedFrames ?: 0,
            writtenFrames = p?.playedFrames ?: 0,
            concealedFrames = j?.concealedFrames ?: 0,
            underrunFrames = j?.underrunFrames ?: 0,
            lateFrames = j?.lateFrames ?: 0,
            duplicateFrames = j?.duplicateFrames ?: 0,
            jitterDepth = j?.depth() ?: 0,
            error = p?.lastError ?: s?.lastError,
        )
    }

    /**
     * Replays a recording through decode and out to the speaker.
     *
     * The codec is inferred from the file extension, which is how it was written
     * in the first place — asking the caller to repeat it would let the two
     * disagree and produce noise.
     */
    @Synchronized
    fun startFilePlayback(path: String, impairment: String = "NORMAL"): Boolean {
        if (playback?.isRunning == true) {
            lastError = "playback already running"
            return false
        }
        lastError = null

        val file = File(path)
        if (!file.exists()) {
            lastError = "no such recording: ${file.name}"
            Log.e(TAG, lastError!!)
            return false
        }

        val cd: AudioCodec = when {
            file.name.endsWith(".pcmu", true) -> PcmuCodec()
            file.name.endsWith(".amr-wb", true) || file.name.endsWith(".amr", true) -> {
                val amr = AmrWbCodec()
                if (!amr.startDecoder()) {
                    lastError = amr.lastError ?: "AMR-WB decoder unavailable"
                    Log.e(TAG, lastError!!)
                    return false
                }
                amr
            }
            else -> {
                lastError = "cannot infer codec from ${file.name}"
                Log.e(TAG, lastError!!)
                return false
            }
        }

        if (!acquireSession()) {
            lastError = "audio focus refused — another app owns the audio device"
            Log.e(TAG, lastError!!)
            cd.release()
            return false
        }

        val jb = JitterBuffer(cd)
        val imp = try {
            FileFrameSource.Impairment.valueOf(impairment.uppercase())
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "unknown impairment '$impairment', using NORMAL")
            FileFrameSource.Impairment.NORMAL
        }
        val src = FileFrameSource(file, imp)
        // Playback asks the source whether more frames can still arrive, and
        // stops itself once the source is done and the buffer has drained — a
        // finite recording should end on its own, not sit emitting silence
        // until someone presses stop. A live SDK stream never reports done, so
        // the same wiring serves both.
        val pb = AudioPlayback(
            cd, jb,
            sourceActive = { src.isRunning },
            onFinished = { Log.d(TAG, "playback reached end of ${file.name}") },
        )
        src.setListener { payload, len, timestamp -> jb.put(payload, len, timestamp) }

        if (!pb.start()) {
            lastError = pb.lastError ?: "playback failed to start"
            Log.e(TAG, lastError!!)
            teardownPlayback(null, null, cd)
            return false
        }
        if (!src.start(cd)) {
            lastError = src.lastError ?: "source failed to start"
            Log.e(TAG, lastError!!)
            teardownPlayback(pb, null, cd)
            return false
        }

        source = src
        jitter = jb
        playback = pb
        playCodec = cd
        Log.d(TAG, "playback started: ${file.name} codec=${cd.name}")
        return true
    }

    @Synchronized
    fun stopPlayback() {
        teardownPlayback(playback, source, playCodec)
        playback = null
        source = null
        jitter = null
        playCodec = null
    }

    /**
     * Selects the output route. BLUETOOTH starts SCO asynchronously — audio
     * only reaches the headset once [isScoConnected] turns true.
     */
    fun setRoute(route: String) {
        val r = when (route.uppercase()) {
            "SPEAKER" -> AudioSessionManager.Route.SPEAKER
            "BLUETOOTH", "BT" -> AudioSessionManager.Route.BLUETOOTH
            else -> AudioSessionManager.Route.EARPIECE
        }
        session.setRoute(r)
    }

    val isScoConnected: Boolean get() = session.scoConnected

    fun hasBluetoothHeadset(): Boolean = session.hasBluetoothHeadset()

    private fun teardownPlayback(pb: AudioPlayback?, src: FileFrameSource?, cd: AudioCodec?) {
        // Source first: stop the inflow before the consumer goes away.
        try {
            src?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "source stop failed: ${e.message}")
        }
        try {
            pb?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "playback stop failed: ${e.message}")
        }
        try {
            cd?.release()
        } catch (e: Exception) {
            Log.w(TAG, "codec release failed: ${e.message}")
        }
        releaseSession()
    }

    /**
     * Enters call mode on the first user and counts the rest, so capture and
     * playback can start and stop in any order without one dropping the mode
     * while the other is still using it.
     */
    @Synchronized
    private fun acquireSession(): Boolean {
        if (sessionUsers > 0) {
            sessionUsers++
            return true
        }
        if (!session.enterCallMode()) return false
        sessionUsers = 1
        // Below API 31 the speaker flag only sticks while the device is in
        // communication mode, so a route chosen before this point was dropped.
        // Replay it now that the mode is up.
        session.reapplyRouting()
        return true
    }

    @Synchronized
    private fun releaseSession() {
        if (sessionUsers <= 0) return
        sessionUsers--
        if (sessionUsers == 0) {
            try {
                session.exitCallMode()
            } catch (e: Exception) {
                Log.w(TAG, "exitCallMode failed: ${e.message}")
            }
        }
    }

    /** Device capability probe for the UI, valid before anything is started. */
    fun probeEffects(): AudioSessionManager.EffectSupport = session.probeEffectSupport()

    /** Recorded files, newest first. */
    fun listRecordings(): List<File> =
        mediaDir.listFiles()?.sortedByDescending { it.lastModified() } ?: emptyList()
}
