package com.aselsan.mcsdk.rn.media

import android.os.Process
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * FileFrameSource — replays a recording at real time, as if it arrived off the
 * network.
 *
 * Deliberately paced rather than read as fast as possible. The whole point of
 * the downlink is that frames arrive one per [AudioCodec.frameMs] and the jitter
 * buffer absorbs the irregularity; dumping the file in one go would bypass the
 * buffer entirely and prove nothing about it.
 *
 * Timestamps are synthesised by counting frames (+frameSamples each), the same
 * rule AudioCapture uses on the way out. The jitter buffer therefore sees
 * exactly the shape it will see from the SDK, so swapping this for
 * SdkFrameSource changes nothing downstream.
 *
 * Framing differs per codec and that difference is real:
 *   PCMU   — fixed 320 bytes per frame; the stream carries no structure, so the
 *            size has to come from the codec.
 *   AMR-WB — self-describing: the first byte of each frame is the ToC, whose FT
 *            field gives the mode and therefore the frame length (RFC 4867
 *            Table 1a). Verified against the recording on the device: ToC 0x44 →
 *            FT 8 → 60-byte payload + 1 ToC = 61, and 69418/61 = 1138 frames,
 *            matching the encoder's own counter exactly.
 */
class FileFrameSource(
    private val file: File,
    /**
     * How to mistreat the stream on its way to the jitter buffer.
     *
     * The file on disk is never touched — what changes is only *how* its frames
     * are delivered. That is the point: a recording replayed perfectly can never
     * exercise loss, reordering or starvation, because a file has none of the
     * misbehaviour a network has. Nothing here is permanent; the same file plays
     * cleanly again in NORMAL.
     */
    private val impair: Impairment = Impairment.NORMAL,
) : AudioFrameSource {

    enum class Impairment {
        /** Every frame, in order, on time. */
        NORMAL,
        /** Drops roughly one frame in ten — drives the concealment path. */
        LOSS,
        /** Swaps adjacent frames, so each pair arrives out of order. */
        REORDER,
        /** Holds frames back at random, up to ~150 ms late. */
        JITTER,
        /** Sends nothing for 500 ms every few seconds — starves the buffer. */
        FREEZE,
        /** Sends some frames twice. */
        DUPLICATE,
    }

    companion object {
        private const val TAG = "McSdkFileSource"

        /**
         * AMR-WB payload bytes per frame type (RFC 4867 Table 1a), excluding the
         * 1-byte ToC. Index is the FT field; 9-14 are SID/future/no-data and are
         * treated as unsupported here rather than guessed at.
         */
        private val AMRWB_PAYLOAD = intArrayOf(17, 23, 32, 36, 40, 46, 50, 58, 60)

        /** `.amr` container magic, if the file happens to carry one. */
        private val AMR_WB_MAGIC = "#!AMR-WB\n".toByteArray()
    }

    override val name = "File"

    private val running = AtomicBoolean(false)
    private val delivered = AtomicInteger(0)
    /** Frames parsed out of the file, whether or not they were delivered. */
    private val readFromFile = AtomicInteger(0)
    /** Frames deliberately withheld, so the impairment can be proven. */
    private val dropped = AtomicInteger(0)
    private var thread: Thread? = null
    private var listener: AudioFrameSource.Listener? = null

    @Volatile
    override var lastError: String? = null
        private set

    override val isRunning: Boolean get() = running.get()
    override val framesDelivered: Int get() = delivered.get()

    /**
     * Read vs delivered is the source's own account of what it did: in LOSS or
     * FREEZE these diverge by exactly [framesDropped], which is the evidence
     * that the impairment really happened rather than being claimed.
     */
    val framesRead: Int get() = readFromFile.get()
    val framesDropped: Int get() = dropped.get()
    val impairmentName: String get() = impair.name

    val path: String get() = file.absolutePath

    override fun setListener(listener: AudioFrameSource.Listener) {
        this.listener = listener
    }

    override fun start(codec: AudioCodec): Boolean {
        if (running.get()) return true
        lastError = null

        if (!file.exists() || file.length() == 0L) {
            lastError = "no such recording: ${file.name}"
            Log.e(TAG, lastError!!)
            return false
        }
        if (listener == null) {
            lastError = "setListener() not called"
            Log.e(TAG, lastError!!)
            return false
        }

        delivered.set(0)
        readFromFile.set(0)
        dropped.set(0)
        running.set(true)
        thread = Thread({ replayLoop(codec) }, "McSdkFileSource").apply {
            start()
        }
        Log.d(TAG, "start: ${file.name} (${file.length()} bytes) " +
                   "codec=${codec.name} impairment=${impair.name}")
        return true
    }

    override fun stop() {
        running.set(false)
        thread?.join(1000)
        thread = null
        Log.d(TAG, "stop: read=${readFromFile.get()} delivered=${delivered.get()} " +
                   "dropped=${dropped.get()} (${impair.name})")
    }

    private fun replayLoop(codec: AudioCodec) {
        // Not URGENT_AUDIO: this stands in for the network, not for a device.
        // The playback thread is the real-time one.
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)

        val frame = ByteArray(codec.maxEncodedBytes)
        var timestamp = 0
        var input: BufferedInputStream? = null

        try {
            input = BufferedInputStream(FileInputStream(file))

            // Skip a container header if present, so a file pulled off the
            // device and a file wrapped for a desktop decoder both replay.
            val magic = ByteArray(AMR_WB_MAGIC.size)
            input.mark(magic.size)
            val got = input.read(magic)
            if (got != magic.size || !magic.contentEquals(AMR_WB_MAGIC)) {
                input.reset()
            } else {
                Log.d(TAG, "skipped #!AMR-WB container header")
            }

            // Absolute schedule, not sleep(20): sleeping per iteration lets the
            // read and the hand-off accumulate as drift, so playback would
            // slowly fall behind real time.
            var nextDueNs = System.nanoTime()
            val frameNs = codec.frameMs * 1_000_000L

            // REORDER needs one frame of lookahead: a frame can only arrive
            // after its successor if it is held while the next one is read.
            val heldFrame = ByteArray(codec.maxEncodedBytes)
            var heldLen = 0
            var heldTs = 0

            var frameNo = 0

            while (running.get()) {
                val len = readFrame(input, codec, frame)
                if (len <= 0) break      // clean end of file
                readFromFile.incrementAndGet()

                when (impair) {
                    Impairment.NORMAL -> emit(frame, len, timestamp)

                    // Every tenth frame never reaches the buffer. The jitter
                    // buffer has no way to tell this from a lost packet, which
                    // is the point.
                    Impairment.LOSS ->
                        if (frameNo % 10 == 7) dropped.incrementAndGet()
                        else emit(frame, len, timestamp)

                    // Hold one, send the next, then send the held one — so the
                    // buffer receives each pair in the wrong order and has to
                    // place them by timestamp.
                    Impairment.REORDER -> {
                        if (heldLen == 0) {
                            System.arraycopy(frame, 0, heldFrame, 0, len)
                            heldLen = len
                            heldTs = timestamp
                        } else {
                            emit(frame, len, timestamp)
                            emit(heldFrame, heldLen, heldTs)
                            heldLen = 0
                        }
                    }

                    // Random extra delay. Within the buffer's depth it is
                    // absorbed silently; beyond it the frame is counted late.
                    Impairment.JITTER -> {
                        emit(frame, len, timestamp)
                        val extra = (Math.random() * 150).toLong()
                        if (extra > 0) Thread.sleep(extra)
                    }

                    // A gap long enough to drain the buffer, every ~5 s.
                    Impairment.FREEZE -> {
                        emit(frame, len, timestamp)
                        if (frameNo > 0 && frameNo % 250 == 0) {
                            Log.d(TAG, "FREEZE: withholding 500 ms at frame $frameNo")
                            Thread.sleep(500)
                        }
                    }

                    // Same frame twice: same timestamp, so the buffer must
                    // recognise the second as a duplicate rather than store it.
                    Impairment.DUPLICATE -> {
                        emit(frame, len, timestamp)
                        if (frameNo % 8 == 3) emit(frame, len, timestamp)
                    }
                }

                timestamp += codec.frameSamples
                frameNo++

                nextDueNs += frameNs
                val waitNs = nextDueNs - System.nanoTime()
                if (waitNs > 0) {
                    Thread.sleep(waitNs / 1_000_000L, (waitNs % 1_000_000L).toInt())
                }
                // waitNs <= 0 means we are behind; carry on without sleeping and
                // let the schedule catch up rather than compounding the lag.
            }

            // Flush a frame still held by REORDER so the tail is not lost.
            if (heldLen > 0) emit(heldFrame, heldLen, heldTs)
            Log.d(TAG, "replay finished: ${delivered.get()} frames")
        } catch (e: Exception) {
            lastError = "replay failed: ${e.message}"
            Log.e(TAG, lastError!!, e)
        } finally {
            try {
                input?.close()
            } catch (e: Exception) {
                Log.w(TAG, "close failed: ${e.message}")
            }
            running.set(false)
        }
    }

    private fun emit(buf: ByteArray, len: Int, timestamp: Int) {
        listener?.onFrame(buf, len, timestamp)
        delivered.incrementAndGet()
    }

    /**
     * Reads one frame, returning its length or 0 at end of stream.
     *
     * The two codecs need different framing, and guessing would silently
     * desynchronise the whole stream, so each is handled explicitly.
     */
    private fun readFrame(
        input: BufferedInputStream,
        codec: AudioCodec,
        out: ByteArray,
    ): Int = when (codec) {
        is PcmuCodec -> {
            // Fixed size: one byte per sample.
            val n = input.read(out, 0, codec.frameSamples)
            if (n <= 0) 0 else n
        }

        is AmrWbCodec -> {
            val toc = input.read()
            if (toc < 0) {
                0
            } else {
                val ft = (toc shr 3) and 0x0F
                if (ft >= AMRWB_PAYLOAD.size) {
                    // SID / reserved / no-data. Bailing out beats emitting a
                    // frame of the wrong length and corrupting everything after.
                    lastError = "unsupported AMR-WB frame type $ft at frame ${delivered.get()}"
                    Log.e(TAG, lastError!!)
                    0
                } else {
                    val payload = AMRWB_PAYLOAD[ft]
                    out[0] = toc.toByte()
                    var read = 0
                    while (read < payload) {
                        val n = input.read(out, 1 + read, payload - read)
                        if (n < 0) break
                        read += n
                    }
                    if (read < payload) 0 else 1 + payload
                }
            }
        }

        else -> {
            lastError = "no framing rule for codec ${codec.name}"
            Log.e(TAG, lastError!!)
            0
        }
    }
}
