package com.aselsan.mcsdk.rn.media

import android.util.Log
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * FileFrameSink — writes encoded frames to a raw file, off the capture thread.
 *
 * First milestone of the audio work: it answers "is capture + encode correct,
 * and does the threading hold up?" without any network or SDK involved. The
 * file is then pulled off the device and decoded by an independent tool, which
 * is the point — our own decoder would happily read back our own encoder's
 * mistakes, so a third party has to confirm the bytes are really valid:
 *
 *   adb exec-out run-as com.testaar cat cache/media/<name>.pcmu > capture.pcmu
 *   ffmpeg -f mulaw -ar 16000 -ac 1 -i capture.pcmu out.wav
 *
 * The payload is the bare encoded stream with no container and no RTP headers —
 * exactly what a decoder expects to be handed.
 *
 * Threading: [onFrame] runs on the capture thread and only copies into a
 * lock-free ring buffer, which measured at 46 µs worst case against a 20 ms
 * budget. A private writer thread drains the buffer and does the actual file
 * I/O, where a flush stalling for tens of milliseconds harms nothing.
 */
class FileFrameSink(private val outputFile: File) : AudioFrameSink {

    companion object {
        private const val TAG = "McSdkFileSink"

        /** ~1 s of PCMU. Sized to absorb disk stalls, not to buffer audio. */
        private const val RING_BYTES = 16 * 1024

        /** Drain size. Larger than a frame so a backlog clears in few writes. */
        private const val DRAIN_BYTES = 2048

        /** Idle sleep when the ring is empty — keeps the writer off the CPU. */
        private const val IDLE_SLEEP_MS = 4L
    }

    override val name = "File"

    private val ring = RingBuffer(RING_BYTES)
    private val running = AtomicBoolean(false)
    private val dropped = AtomicInteger(0)
    private val bytesOut = AtomicInteger(0)

    private var writer: Thread? = null

    override val droppedFrames: Int get() = dropped.get()

    /** Bytes that actually reached the file. Frame count belongs to capture —
     *  the writer drains the ring in arbitrary chunks, not frame units. */
    val bytesWritten: Int get() = bytesOut.get()

    val path: String get() = outputFile.absolutePath

    override fun open(codec: AudioCodec) {
        if (running.get()) return

        outputFile.parentFile?.mkdirs()
        ring.clear()
        dropped.set(0)
        bytesOut.set(0)
        running.set(true)

        writer = Thread({ writeLoop() }, "McSdkFileWriter").apply {
            // Deliberately NOT a high priority: this thread is allowed to be
            // slow. The ring buffer is what protects capture from it.
            priority = Thread.NORM_PRIORITY
            start()
        }
        Log.d(TAG, "open: ${outputFile.absolutePath} codec=${codec.name}")
    }

    /**
     * Capture thread. Copies into the ring and returns.
     *
     * A frame that does not fit is dropped whole and counted: a partial frame
     * would desynchronise the stream, and a silent drop would hide the only
     * failure this design exists to reveal. droppedFrames > 0 means the writer
     * could not keep up.
     */
    override fun onFrame(payload: ByteArray, len: Int, timestamp: Int, marker: Boolean) {
        if (!running.get()) return
        if (!ring.write(payload, len)) dropped.incrementAndGet()
    }

    override fun close() {
        if (!running.compareAndSet(true, false)) return
        // join() lets the writer drain what is still buffered before the stream
        // is closed, so the tail of the recording is not lost.
        writer?.join(2000)
        writer = null
        Log.d(TAG, "close: wrote=${bytesOut.get()} bytes, dropped=${dropped.get()} frames, " +
                   "size=${outputFile.length()} bytes")
    }

    private fun writeLoop() {
        val buf = ByteArray(DRAIN_BYTES)
        var out: BufferedOutputStream? = null
        try {
            out = BufferedOutputStream(FileOutputStream(outputFile))
            // Keep draining after running goes false so the final frames land.
            while (running.get() || !ring.isEmpty()) {
                val n = ring.read(buf)
                if (n > 0) {
                    out.write(buf, 0, n)
                    bytesOut.addAndGet(n)
                } else {
                    Thread.sleep(IDLE_SLEEP_MS)
                }
            }
            out.flush()
        } catch (e: Exception) {
            // Capture must not die because the file failed; it keeps running and
            // the drop counter climbs, which is visible in the UI.
            Log.e(TAG, "writeLoop failed: ${e.message}", e)
        } finally {
            try {
                out?.close()
            } catch (e: Exception) {
                Log.w(TAG, "close failed: ${e.message}")
            }
        }
    }
}
