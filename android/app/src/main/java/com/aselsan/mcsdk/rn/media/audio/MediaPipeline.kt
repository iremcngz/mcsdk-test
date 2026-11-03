package com.aselsan.mcsdk.rn.media.audio

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import com.aselsan.mcsdk.rn.media.audio.codec.AmrWbCodec
import com.aselsan.mcsdk.rn.media.audio.codec.AudioCodec
import com.aselsan.mcsdk.rn.media.audio.codec.PcmuCodec
import com.aselsan.mcsdk.rn.media.audio.transport.AudioFrameSink
import com.aselsan.mcsdk.rn.media.audio.transport.AudioFrameSource
import com.aselsan.mcsdk.rn.media.audio.transport.FileFrameSink
import com.aselsan.mcsdk.rn.media.audio.transport.FileFrameSource
import com.aselsan.mcsdk.rn.media.audio.transport.SdkFrameSink
import com.aselsan.mcsdk.rn.media.audio.transport.SdkFrameSource
import com.aselsan.mcsdk.rn.media.audio.transport.UdpFrameSink
import com.aselsan.mcsdk.rn.media.audio.transport.UdpFrameSource
import java.io.File
import java.util.Locale

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

        /** Concealment on a call: 5 frames = 100 ms, then silence. */
        private const val CALL_MAX_CONCEAL_FRAMES = 5

        /**
         * A call's starting jitter budget: 4 frames = 80 ms, as for a file or
         * the UDP test. 200 ms was tried; the shorter start is kept because
         * rebuffering already deepens the buffer to whatever stall the network
         * actually produces (measured on Wi-Fi: clumps up to ~300 ms apart),
         * so a calm link is not made to pay for a bad one.
         */
        private const val CALL_TARGET_FRAMES = 4

        /**
         * 64 frames = 1.28 s. Rebuffering lets the depth grow to the longest
         * stall, and a clump must still fit on top of it.
         */
        private const val CALL_CAPACITY_FRAMES = 64

        private const val STATS_TAG = "McSdkCallStats"
        private const val STATS_FIELDS = 19
    }

    private val session = AudioSessionManager(context)
    private val mediaDir = File(context.cacheDir, "media")
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

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
        val sdkSink = s as? SdkFrameSink
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
            packetsSent = udpSink?.framesSent ?: sdkSink?.framesSent ?: 0,
            sendErrors = udpSink?.sendErrors ?: sdkSink?.droppedFrames ?: 0,
            target = udpSink?.target ?: sdkSink?.target,
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
    private fun startCapture(
        codecName: String,
        transmitInitially: Boolean = true,
        makeSink: (AudioCodec) -> AudioFrameSink,
    ): AudioFrameSink? {
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
        // Before start, so not one frame slips through a gate that should be
        // shut: on a call nothing may go out until the floor says so.
        cap.setTransmitEnabled(transmitInitially)

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
     * Silences what is received, leaving the call and the uplink as they are —
     * a group's "stop listening". Applies to the playback running now; a new
     * one starts unmuted.
     */
    fun setPlaybackMuted(muted: Boolean) {
        playback?.muted = muted
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
        val sdkSrc = s as? SdkFrameSource
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
            packetsReceived = udpSrc?.packetsReceived ?: sdkSrc?.packetsReceived ?: 0,
            malformedPackets = udpSrc?.malformedPackets ?: sdkSrc?.malformedPackets ?: 0,
            lostPackets = udpSrc?.lostPackets ?: 0,
            localPort = udpSrc?.port ?: 0,
            remoteSsrc = udpSrc?.remoteSsrcValue ?: sdkSrc?.remoteSsrcValue ?: 0,
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
        src.setListener { payload, len, timestamp, _ -> jb.put(payload, len, timestamp) }

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
        src.setListener { payload, len, timestamp, firstOfBurst ->
            if (firstOfBurst) jb.restartBurst()
            jb.put(payload, len, timestamp)
        }

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

    // ── A call's audio through the SDK ────────────────────────────────────────

    /** The call whose audio is running through the SDK, or null. */
    @Volatile
    var callAudioId: String? = null
        private set

    /**
     * Runs a call's audio through the SDK: capture → AMR-WB → SdkFrameSink on
     * the way out, SdkFrameSource → jitter buffer → AMR-WB → playback on the
     * way in. The same chain the Audio tab's UDP test proved, with the SDK at
     * both ends instead of a socket.
     *
     * The uplink starts gated: nothing is sent until [setTransmitEnabled] opens
     * it — on a half-duplex call that is the floor being granted.
     *
     * Fails, leaving nothing running, if a test session already holds capture
     * or playback, or either half cannot start.
     */
    @Synchronized
    fun startCallAudio(callId: String): Boolean {
        if (callAudioId != null) {
            lastError = "call audio already running for $callAudioId"
            return false
        }
        if (startCapture("AMR-WB", transmitInitially = false) { SdkFrameSink(callId) } == null) {
            return false
        }
        if (!startSdkPlayback(callId)) {
            stop()
            return false
        }
        callAudioId = callId
        Log.d(TAG, "call audio started: callId=$callId")
        acquireWifiLock()
        startCallStats()
        return true
    }

    /**
     * Stops a call's audio. Safe to call when none is running.
     *
     * With [onlyFor], only that call's: a stop that arrives late — from a call
     * whose start was still in flight when another call took the pipeline —
     * must not end the audio of the call that took it.
     */
    @Synchronized
    fun stopCallAudio(onlyFor: String? = null) {
        val id = callAudioId ?: return
        if (onlyFor != null && onlyFor != id) {
            Log.d(TAG, "call audio stop for $onlyFor ignored: $id holds the pipeline")
            return
        }
        stopCallStats()
        releaseWifiLock()
        stopPlayback()
        stop()
        callAudioId = null
        Log.d(TAG, "call audio stopped: callId=$id")
    }

    // ── Wi-Fi power save ──────────────────────────────────────────────────────

    private var wifiLock: WifiManager.WifiLock? = null

    /**
     * Keeps Wi-Fi out of power save for as long as a call's audio runs. A
     * dozing phone only collects its packets from the AP at the beacons it
     * wakes for, so a 20 ms stream arrives in clumps: measured ~300 ms apart
     * (three beacon intervals) on a call, and the jitter buffer holds 80 ms.
     *
     * LOW_LATENCY is the mode made for this (API 29+), and it only applies
     * while the app is in the foreground with the screen on — as it is while
     * someone holds the PTT button. Below 29 HIGH_PERF is all there is; most
     * devices turn power save off for it, but that is the vendor's choice.
     *
     * Not reference counted: one lock per call, released when it ends.
     */
    private fun acquireWifiLock() {
        val wm = wifi ?: return
        if (wifiLock?.isHeld == true) return
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
            WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
        try {
            wifiLock = wm.createWifiLock(mode, "McSdkCallAudio").apply {
                setReferenceCounted(false)
                acquire()
            }
            Log.d(TAG, "wifi lock held: mode=$mode")
        } catch (e: Exception) {
            // Audio still works without it, only less evenly — not worth
            // failing the call for.
            Log.w(TAG, "wifi lock failed: ${e.message}")
            wifiLock = null
        }
    }

    private fun releaseWifiLock() {
        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (e: Exception) {
            Log.w(TAG, "wifi lock release failed: ${e.message}")
        }
        wifiLock = null
    }

    // ── Call stats, once a second ─────────────────────────────────────────────

    private var statsThread: Thread? = null

    /**
     * Logs one McSdkCallStats line a second while a call's audio runs. Counts
     * are per second, lag/depth/jitter are the value at that moment. Both
     * directions share a line so the two phones' logs can be read side by
     * side: one phone's UP sent should reappear as the other's DOWN pkt, and
     * the difference is what the network lost.
     *
     * On its own thread, polling counters the real-time threads already keep —
     * nothing is added to the capture, playback or SDK media paths.
     */
    private fun startCallStats() {
        stopCallStats()
        val t = Thread({
            val prev = IntArray(STATS_FIELDS)
            val now = IntArray(STATS_FIELDS)
            while (true) {
                try {
                    Thread.sleep(1000)
                } catch (e: InterruptedException) {
                    break
                }
                val cap = capture
                val snk = sink as? SdkFrameSink
                val enc = codec as? AmrWbCodec
                val src = source as? SdkFrameSource
                val jb = jitter
                val pb = playback
                val dec = playCodec as? AmrWbCodec

                now[0] = cap?.capturedFrames ?: 0
                now[1] = cap?.encodedFrames ?: 0
                now[2] = snk?.framesSent ?: 0
                now[3] = snk?.droppedFrames ?: 0
                now[4] = snk?.timestampGapFrames ?: 0
                now[5] = enc?.encoderInputDropped ?: 0
                now[6] = src?.packetsReceived ?: 0
                now[7] = src?.framesDelivered ?: 0
                now[8] = src?.burstStarts ?: 0
                now[9] = src?.timestampGapFrames ?: 0
                now[10] = jb?.lateFrames ?: 0
                now[11] = jb?.duplicateFrames ?: 0
                now[12] = jb?.overflowFrames ?: 0
                now[13] = jb?.playedFrames ?: 0
                now[14] = jb?.concealedFrames ?: 0
                now[15] = jb?.underrunFrames ?: 0
                now[16] = pb?.decodeFailureCount ?: 0
                now[17] = dec?.decoderInputDropped ?: 0
                now[18] = jb?.rebufferCount ?: 0
                val d = IntArray(STATS_FIELDS) { now[it] - prev[it] }
                now.copyInto(prev)

                Log.i(STATS_TAG, String.format(Locale.US,
                    "UP tx=%d cap=%d enc=%d sent=%d notSent=%d tsGap=%d encDrop=%d encLag=%d | " +
                    "DOWN pkt=%d frm=%d burst=%d tsGap=%d late=%d dup=%d ovf=%d played=%d " +
                    "conceal=%d underrun=%d rebuf=%d decMiss=%d decDrop=%d decLag=%d depth=%d " +
                    "jitter=%.1fms maxGap=%dms",
                    if (cap?.isTransmitting == true) 1 else 0,
                    d[0], d[1], d[2], d[3], d[4], d[5], enc?.encoderLag ?: 0,
                    d[6], d[7], d[8], d[9], d[10], d[11], d[12], d[13],
                    d[14], d[15], d[18], d[16], d[17], dec?.decoderLag ?: 0, jb?.depth() ?: 0,
                    (src?.interarrivalJitterUs ?: 0L) / 1000.0,
                    (src?.takeMaxArrivalGapUs() ?: 0L) / 1000))
            }
        }, STATS_TAG)
        t.isDaemon = true
        t.start()
        statsThread = t
    }

    private fun stopCallStats() {
        statsThread?.let {
            it.interrupt()
            it.join(1000)
        }
        statsThread = null
    }

    /**
     * Playback fed by the SDK. As the UDP receive, except that the source has
     * no socket or thread — frames arrive on the SDK's media thread — and the
     * jitter buffer bounds its concealment: on a PTT call the stream stops
     * between talk bursts, and an unbounded repeat of the last frame would buzz
     * through every pause.
     */
    private fun startSdkPlayback(callId: String): Boolean {
        if (playback?.isRunning == true) {
            lastError = "playback already running"
            return false
        }
        val amr = AmrWbCodec()
        if (!amr.startDecoder()) {
            lastError = amr.lastError ?: "AMR-WB decoder unavailable"
            Log.e(TAG, lastError!!)
            return false
        }
        if (!acquireSession()) {
            lastError = "audio focus refused — another app owns the audio device"
            Log.e(TAG, lastError!!)
            amr.release()
            return false
        }

        val jb = JitterBuffer(
            amr,
            targetFrames = CALL_TARGET_FRAMES,
            capacityFrames = CALL_CAPACITY_FRAMES,
            maxConcealFrames = CALL_MAX_CONCEAL_FRAMES,
            rebufferOnStall = true,
        )
        val src = SdkFrameSource(callId)
        // Active for as long as the call's audio runs: silence between bursts
        // is normal, and must not read as the stream having ended.
        val pb = AudioPlayback(
            amr, jb,
            sourceActive = { src.isRunning },
            onFinished = { Log.d(TAG, "sdk playback stopped") },
        )
        src.setListener { payload, len, timestamp, firstOfBurst ->
            if (firstOfBurst) jb.restartBurst()
            jb.put(payload, len, timestamp)
        }

        if (!pb.start()) {
            lastError = pb.lastError ?: "playback failed to start"
            Log.e(TAG, lastError!!)
            teardownPlayback(null, null, amr)
            return false
        }
        if (!src.start(amr)) {
            lastError = src.lastError ?: "source failed to start"
            Log.e(TAG, lastError!!)
            teardownPlayback(pb, null, amr)
            return false
        }

        source = src
        jitter = jb
        playback = pb
        playCodec = amr
        return true
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
