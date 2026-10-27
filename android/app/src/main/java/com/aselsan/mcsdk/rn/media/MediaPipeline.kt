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
    // The interface, not FileFrameSink: the destination is swapped for
    // UdpFrameSink without capture or this class knowing the difference, which
    // is the whole point of AudioFrameSink. Per-sink extras (a file's path, a
    // socket's packet count) are read back by narrowing where they are needed.
    private var sink: AudioFrameSink? = null
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
        // ── UDP sink only, 0 and null for a file ──────────────────────────────
        /**
         * Packets handed to the kernel. Compare with the peer's receivedFrames:
         * the difference is the real packet loss, which is what RTCP would
         * report automatically and has to be read off two screens here.
         */
        val packetsSent: Int = 0,
        /** send() threw — the frame was abandoned rather than retried. */
        val sendErrors: Int = 0,
        /** Where packets are going, for the diagnostics screen. */
        val target: String? = null,
    )

    fun stats(): Stats {
        val c = capture
        val s = sink
        val cd = codec
        val ts = c?.rtpTimestamp ?: 0
        // Narrowed rather than hoisted into AudioFrameSink: a file has bytes and
        // a path, a socket has packets and a peer, and neither belongs in the
        // interface the capture thread talks to.
        val fileSink = s as? FileFrameSink
        val udpSink = s as? UdpFrameSink
        return Stats(
            running = c?.isRunning == true,
            transmitting = c?.isTransmitting == true,
            codecName = cd?.name ?: "-",
            sinkName = s?.name ?: "-",
            capturedFrames = c?.capturedFrames ?: 0,
            encodedFrames = c?.encodedFrames ?: 0,
            droppedFrames = s?.droppedFrames ?: 0,
            bytesWritten = fileSink?.bytesWritten ?: 0,
            timestamp = ts,
            mediaSeconds = if (cd != null && cd.sampleRate > 0) ts.toDouble() / cd.sampleRate else 0.0,
            filePath = fileSink?.path,
            aec = effects?.aec == true,
            ns = effects?.ns == true,
            error = lastError ?: c?.lastError ?: udpSink?.lastError,
            packetsSent = udpSink?.framesSent ?: 0,
            sendErrors = udpSink?.sendErrors ?: 0,
            target = udpSink?.target,
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
        val sink = startCapture(codecName) { cd ->
            FileFrameSink(File(mediaDir, "capture-${System.currentTimeMillis()}.${cd.name.lowercase()}"))
        } ?: return null
        return (sink as FileFrameSink).path
    }

    /**
     * Starts capture sending to a peer over RTP/UDP instead of to a file.
     *
     * No signalling: the address and port are typed in. A real call learns them
     * from the SDP offer/answer, which is the SDK's job and is deliberately out
     * of scope here.
     *
     * @return true on success; [lastError] explains a false.
     */
    fun startUdpCapture(codecName: String, remoteHost: String, remotePort: Int): Boolean {
        if (remoteHost.isBlank()) {
            lastError = "remote host is empty"
            return false
        }
        if (remotePort !in 1..65535) {
            lastError = "remote port $remotePort out of range"
            return false
        }
        return startCapture(codecName) { UdpFrameSink(remoteHost, remotePort) } != null
    }

    /**
     * The shared half of starting capture: open the codec, claim the microphone
     * and the audio session, open the sink, start the thread — and unwind in the
     * right order from whichever step fails.
     *
     * [makeSink] runs only once everything it depends on is held, so a sink is
     * never constructed for a start that was already doomed.
     */
    private fun startCapture(codecName: String, makeSink: (AudioCodec) -> AudioFrameSink): AudioFrameSink? {
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

        val snk = makeSink(cd)
        val cap = AudioCapture(cd)

        try {
            snk.open(cd)
        } catch (e: Exception) {
            // The sink's own message when it has one — a UDP sink knows the
            // host it could not resolve, which the generic text would lose.
            lastError = (snk as? UdpFrameSink)?.lastError
                ?: "could not open ${snk.name} sink: ${e.message}"
            Log.e(TAG, lastError!!, e)
            teardown(cap = null, snk = null, cd = cd)
            return null
        }

        if (!cap.start(snk)) {
            lastError = cap.lastError ?: "capture failed to start"
            Log.e(TAG, lastError!!)
            teardown(cap = null, snk = snk, cd = cd)
            return null
        }

        // Only possible now: the effects bind to capture's session id.
        effects = session.attachEffects(cap.audioSessionId)

        capture = cap
        sink = snk
        codec = cd
        Log.d(TAG, "started: codec=${cd.name} sink=${snk.name} " +
                   "aec=${effects?.aec} ns=${effects?.ns}")
        return snk
    }

    /**
     * Stops capture and releases everything. Returns the finished file's path.
     *
     * Safe to call when not running: teardown is idempotent, because it also
     * serves as the cleanup path for a half-built start.
     */
    @Synchronized
    fun stop(): String? {
        // Only a file sink has a path; a UDP sink returns null and the caller
        // has nothing to open afterwards.
        val path = (sink as? FileFrameSink)?.path
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
    private fun teardown(cap: AudioCapture?, snk: AudioFrameSink?, cd: AudioCodec?) {
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

    // The interface, for the same reason as `sink` above: FileFrameSource and
    // UdpFrameSource are interchangeable from here down, and the jitter buffer
    // cannot tell them apart — which is what makes the file a valid rehearsal
    // for the network.
    private var source: AudioFrameSource? = null
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
        // ── UDP source only, 0 for a file ─────────────────────────────────────
        /** Datagrams taken off the socket, valid or not. */
        val packetsReceived: Int = 0,
        /** Rejected by the RTP parser — wrong version, too short, truncated. */
        val malformedPackets: Int = 0,
        /**
         * Packets the sender produced that never arrived, from gaps in the
         * sequence number. This is the number a bare timestamp cannot give:
         * a timestamp gap is either loss or the sender pausing, and capture
         * does pause while still advancing the timestamp.
         */
        val lostPackets: Int = 0,
        val localPort: Int = 0,
        /** SSRC of the stream being received, for telling peers apart. */
        val remoteSsrc: Int = 0,
    )

    fun playbackStats(): PlaybackStats {
        val p = playback
        val j = jitter
        val s = source
        // Narrowed per source: a file has a path, a read count and an
        // impairment mode; a socket has packet counts and a peer SSRC. Neither
        // set belongs in AudioFrameSource, which is what the jitter buffer sees.
        val fileSrc = s as? FileFrameSource
        val udpSrc = s as? UdpFrameSource
        return PlaybackStats(
            running = p?.isRunning == true,
            finished = p?.isFinished == true,
            codecName = playCodec?.name ?: "-",
            sourceName = s?.name ?: "-",
            filePath = fileSrc?.path,
            receivedFrames = j?.receivedFrames ?: 0,
            sourceRead = fileSrc?.framesRead ?: 0,
            sourceDropped = fileSrc?.framesDropped ?: 0,
            impairment = fileSrc?.impairmentName ?: "-",
            playedFrames = j?.playedFrames ?: 0,
            writtenFrames = p?.playedFrames ?: 0,
            concealedFrames = j?.concealedFrames ?: 0,
            underrunFrames = j?.underrunFrames ?: 0,
            lateFrames = j?.lateFrames ?: 0,
            duplicateFrames = j?.duplicateFrames ?: 0,
            jitterDepth = j?.depth() ?: 0,
            error = p?.lastError ?: s?.lastError,
            packetsReceived = udpSrc?.packetsReceived ?: 0,
            malformedPackets = udpSrc?.malformedPackets ?: 0,
            lostPackets = udpSrc?.lostPackets ?: 0,
            localPort = udpSrc?.port ?: 0,
            remoteSsrc = udpSrc?.remoteSsrcValue ?: 0,
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

    /**
     * Starts playback of RTP arriving on [localPort].
     *
     * The codec is named rather than inferred: a file carries its extension, a
     * socket carries nothing, and the RTP payload type is in the dynamic range
     * (96) where the number means only what both ends were configured to agree
     * it means. Getting this wrong decodes noise, so it is explicit.
     *
     * Unlike the file path there is no impairment setting. A real network
     * supplies loss, reordering and jitter of its own; the impairment modes
     * exist precisely because a file cannot.
     */
    @Synchronized
    fun startUdpPlayback(codecName: String, localPort: Int): Boolean {
        if (playback?.isRunning == true) {
            lastError = "playback already running"
            return false
        }
        lastError = null

        if (localPort !in 1..65535) {
            lastError = "local port $localPort out of range"
            return false
        }

        val cd: AudioCodec = when (codecName.uppercase()) {
            "PCMU" -> PcmuCodec()
            "AMR-WB", "AMRWB" -> {
                val amr = AmrWbCodec()
                if (!amr.startDecoder()) {
                    lastError = amr.lastError ?: "AMR-WB decoder unavailable"
                    Log.e(TAG, lastError!!)
                    return false
                }
                amr
            }
            else -> {
                lastError = "unknown codec '$codecName'"
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
        val src = UdpFrameSource(localPort)
        // sourceActive stays true for as long as the socket is open: a live
        // stream has no end to detect, so playback must not stop itself during a
        // silent stretch the way it does at the end of a recording.
        val pb = AudioPlayback(
            cd, jb,
            sourceActive = { src.isRunning },
            onFinished = { Log.d(TAG, "udp playback stopped") },
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
        Log.d(TAG, "udp playback started: port=$localPort codec=${cd.name}")
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

    private fun teardownPlayback(pb: AudioPlayback?, src: AudioFrameSource?, cd: AudioCodec?) {
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
