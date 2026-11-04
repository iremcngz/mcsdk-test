package com.aselsan.mcsdk.rn.media.video.codec

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import com.aselsan.mcsdk.rn.media.video.FrameGapMeter
import java.util.ArrayDeque
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.atomic.AtomicInteger

/**
 * VideoDecoder — MediaCodec's H.264 decoder, drawing straight into a Surface.
 *
 * Frames arrive on the source's thread, which is the SDK's media thread once there
 * is an SDK and must not wait. The codec has an input buffer free only when it says
 * so. A small queue sits between the two, and it is bounded: a decoder that falls
 * behind must drop to the next key frame, not show an ever older picture.
 *
 * That queue is also the playout buffer: a frame waits in it until the time
 * PlayoutClock gave it. The waiting is done here, ahead of the codec, because frames
 * held as encoded data cost little memory, while held decoded ones would pin the few
 * output buffers a codec has and stall it. Once decoded, a frame is drawn at once.
 *
 * The SPS and PPS are read from the key frame itself, so the size given at configure
 * is only a hint; the real one comes back through [onSize].
 */
class VideoDecoder(
    private val surface: Surface,
    private val onSize: (width: Int, height: Int) -> Unit,
    private val onFailed: () -> Unit,
) {

    private companion object {
        const val TAG = "McSdkVideoDec"
        const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
        const val HINT_WIDTH = 640
        const val HINT_HEIGHT = 480

        /**
         * ~1.25 s at 24 fps: the playout delay's worth of frames, plus a clump arriving
         * on top of them. Past this the picture is too old to be worth catching up on.
         */
        const val QUEUE_FRAMES = 30

        /** A frame fed this far past its time is one the buffer failed to cover. */
        const val LATE_MS = 50L

        /** A gap this long at 24 fps (42 ms a frame) is visible as a stutter. */
        const val STALL_MS = 120L

        /** The KEY_LOW_LATENCY constant only exists from API 30. */
        const val KEY_LOW_LATENCY = "low-latency"
    }

    private class Frame(val data: ByteArray, val timeUs: Long, val playAtMs: Long)

    private val queue = ArrayBlockingQueue<Frame>(QUEUE_FRAMES)
    private val decoded = AtomicInteger(0)
    private val late = AtomicInteger(0)
    private val pumpTask = Runnable { pump() }

    // What reached the screen, next to the receiver's line for what reached the phone:
    // the difference between the two is what the buffer did.
    private val drawStalls = FrameGapMeter(STALL_MS) { gap, captured, _ ->
        Log.d(TAG, "stall: nothing drawn for $gap ms, captured $captured ms apart")
    }

    /** Input buffers the codec has offered and nothing has filled. Codec thread only. */
    private val freeInputs = ArrayDeque<Int>()

    private var codec: MediaCodec? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    @Volatile
    private var firstDrawNs = 0L

    @Volatile
    private var lastDrawNs = 0L

    @Volatile
    var lastError: String? = null
        private set

    /** Frames drawn to the Surface. */
    val framesDecoded: Int get() = decoded.get()

    /** Frames that arrived too late for the playout delay to cover. */
    val framesLate: Int get() = late.get()

    /** Seconds between the first frame drawn and the last. */
    val drawSeconds: Double
        get() = if (firstDrawNs == 0L) 0.0 else (lastDrawNs - firstDrawNs) / 1_000_000_000.0

    /** @throws Exception if the device cannot decode this */
    fun start() {
        val handlerThread = HandlerThread("McSdkVideoDecoder").apply { start() }
        thread = handlerThread
        val h = Handler(handlerThread.looper)
        handler = h

        val decoder = MediaCodec.createDecoderByType(MIME)
        codec = decoder
        val format = MediaFormat.createVideoFormat(MIME, HINT_WIDTH, HINT_HEIGHT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) format.setInteger(KEY_LOW_LATENCY, 1)
        decoder.setCallback(callback, h)
        decoder.configure(format, surface, null, 0)
        decoder.start()
        Log.d(TAG, "start: ${decoder.name}")
    }

    /**
     * Takes one frame, copying it. Any thread; never blocks.
     *
     * @param playAtMs when to hand it to the codec, on SystemClock.elapsedRealtime()
     * @return false when the queue is full. It is emptied too, because what is in it
     *         is useless without the frame that just failed to fit: the caller must
     *         wait for a key frame.
     */
    fun offer(data: ByteArray, len: Int, timeUs: Long, playAtMs: Long): Boolean {
        if (!queue.offer(Frame(data.copyOf(len), timeUs, playAtMs))) {
            queue.clear()
            return false
        }
        handler?.post(pumpTask)
        return true
    }

    /** Codec thread. Fills free input buffers with every frame whose time has come. */
    private fun pump() {
        val decoder = codec ?: return
        val h = handler ?: return
        h.removeCallbacks(pumpTask)
        try {
            while (freeInputs.isNotEmpty()) {
                val next = queue.peek() ?: return
                val wait = next.playAtMs - SystemClock.elapsedRealtime()
                if (wait > 0) {
                    h.postDelayed(pumpTask, wait)
                    return
                }
                if (-wait > LATE_MS) late.incrementAndGet()
                val frame = queue.poll() ?: return
                val index = freeInputs.removeFirst()
                val input = decoder.getInputBuffer(index) ?: return
                if (frame.data.size > input.capacity()) {
                    // Larger than the codec's buffer: only a resolution past the
                    // hint can do this. Reported as a failure so it restarts clean.
                    Log.e(TAG, "frame of ${frame.data.size} bytes, input holds ${input.capacity()}")
                    lastError = "frame larger than the decoder's buffer"
                    decoder.queueInputBuffer(index, 0, 0, 0, 0)
                    onFailed()
                    return
                }
                input.clear()
                input.put(frame.data)
                decoder.queueInputBuffer(index, 0, frame.data.size, frame.timeUs, 0)
            }
        } catch (e: IllegalStateException) {
            Log.d(TAG, "input after stop: ${e.message}")
        }
    }

    private val callback = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(codec: MediaCodec, index: Int) {
            freeInputs.addLast(index)
            pump()
        }

        override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
            try {
                // true: draw it to the Surface, now.
                codec.releaseOutputBuffer(index, info.size > 0)
            } catch (e: IllegalStateException) {
                Log.d(TAG, "output after stop: ${e.message}")
                return
            }
            if (info.size > 0) {
                val now = System.nanoTime()
                if (firstDrawNs == 0L) firstDrawNs = now
                lastDrawNs = now
                decoded.incrementAndGet()
                drawStalls.onFrame(now / 1_000_000, info.presentationTimeUs, false)
            }
        }

        override fun onError(codec: MediaCodec, e: MediaCodec.CodecException) {
            lastError = "decoder: ${e.diagnosticInfo}"
            Log.e(TAG, "onError: ${e.diagnosticInfo}", e)
            onFailed()
        }

        override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) {
            // The crop rectangle is the picture; width and height include padding.
            val width = if (format.containsKey("crop-right")) {
                format.getInteger("crop-right") - format.getInteger("crop-left") + 1
            } else {
                format.getInteger(MediaFormat.KEY_WIDTH)
            }
            val height = if (format.containsKey("crop-bottom")) {
                format.getInteger("crop-bottom") - format.getInteger("crop-top") + 1
            } else {
                format.getInteger(MediaFormat.KEY_HEIGHT)
            }
            Log.d(TAG, "output: ${width}x$height")
            onSize(width, height)
        }
    }

    /**
     * Stops and releases. The Surface can go once this returns, which is why it does
     * not hand the work off: the view's surfaceDestroyed waits for it.
     */
    fun stop() {
        val decoder = codec
        codec = null
        if (decoder != null) {
            try {
                decoder.stop()
            } catch (e: IllegalStateException) {
                Log.w(TAG, "stop: ${e.message}")
            }
            decoder.release()
        }
        handler = null
        thread?.quitSafely()
        thread = null
        queue.clear()
    }
}
