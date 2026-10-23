package com.aselsan.mcsdk.rn.media

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Process
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * AudioCapture — the microphone thread: read PCM, encode, hand off, repeat.
 *
 * This is the only real-time path in the uplink. AudioRecord keeps a small
 * hardware-backed buffer; if it is not drained roughly every [AudioCodec.frameMs]
 * the buffer overruns and those samples are lost for good. So the loop does the
 * minimum — read, encode, pass to the sink — and everything slow (disk, network,
 * the SDK) lives behind [AudioFrameSink] on another thread.
 *
 * Real-time rules observed here: every buffer is allocated once in [start], the
 * loop takes no locks, and it does not log per frame. Breaking any of those
 * shows up as clicks in the audio, not as an error.
 *
 * It does NOT own the microphone grant, the audio mode, or the effects — those
 * belong to MediaPipeline, which sequences MicrophoneOwner and
 * AudioSessionManager around this class.
 */
class AudioCapture(private val codec: AudioCodec) {

    companion object {
        private const val TAG = "McSdkCapture"

        /**
         * Multiplier over the device minimum buffer. AudioRecord's reported
         * minimum is the smallest that works, not a comfortable one: at the
         * minimum, a single scheduling hiccup overruns it. Four frames of slack
         * costs 40 ms of latency and removes that class of loss.
         */
        private const val BUFFER_FRAMES = 4
    }

    /** Set when the capture thread dies on its own (device error). */
    @Volatile
    var lastError: String? = null
        private set

    private val running = AtomicBoolean(false)
    private val transmitting = AtomicBoolean(true)

    private val framesCaptured = AtomicInteger(0)
    private val framesEncoded = AtomicInteger(0)

    private var record: AudioRecord? = null
    private var thread: Thread? = null
    private var sink: AudioFrameSink? = null

    /** RTP timestamp, in samples. Read by the UI; written by the capture thread. */
    private val timestamp = AtomicInteger(0)

    val isRunning: Boolean get() = running.get()
    val capturedFrames: Int get() = framesCaptured.get()
    val encodedFrames: Int get() = framesEncoded.get()
    val rtpTimestamp: Int get() = timestamp.get()

    /** 0 until [start] succeeds. Needed to attach AEC/NS to this session. */
    var audioSessionId: Int = 0
        private set

    /**
     * Opens the device and starts the capture thread.
     *
     * Requires RECORD_AUDIO to already be granted and the microphone to already
     * be claimed — without the permission AudioRecord does not fail, it just
     * returns buffers full of zeros, which is far harder to diagnose than a
     * refusal. MediaPipeline checks both before calling this.
     *
     * @return false if the device could not be opened; [lastError] says why.
     */
    @SuppressLint("MissingPermission")
    fun start(sink: AudioFrameSink): Boolean {
        if (running.get()) return true
        lastError = null

        val frameBytes = codec.frameSamples * 2          // 16-bit mono
        val minBuffer = AudioRecord.getMinBufferSize(
            codec.sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) {
            lastError = "getMinBufferSize failed ($minBuffer) — " +
                "${codec.sampleRate} Hz mono PCM16 unsupported"
            Log.e(TAG, lastError!!)
            return false
        }
        val bufferBytes = maxOf(minBuffer, frameBytes * BUFFER_FRAMES)

        val rec = try {
            AudioRecord(
                // VOICE_COMMUNICATION, not MIC: MIC is the raw capture path and
                // bypasses the platform's echo-cancellation chain, which a
                // full-duplex call needs.
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                codec.sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferBytes,
            )
        } catch (e: Exception) {
            lastError = "AudioRecord ctor threw: ${e.message}"
            Log.e(TAG, lastError!!, e)
            return false
        }

        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            lastError = "AudioRecord not initialised (state=${rec.state}) — " +
                "permission missing or device busy"
            Log.e(TAG, lastError!!)
            rec.release()
            return false
        }

        record = rec
        audioSessionId = rec.audioSessionId
        this.sink = sink

        framesCaptured.set(0)
        framesEncoded.set(0)
        timestamp.set(0)
        running.set(true)

        try {
            rec.startRecording()
        } catch (e: Exception) {
            lastError = "startRecording threw: ${e.message}"
            Log.e(TAG, lastError!!, e)
            stop()
            return false
        }
        if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            lastError = "device did not enter RECORDING state"
            Log.e(TAG, lastError!!)
            stop()
            return false
        }

        thread = Thread({ captureLoop() }, "McSdkCapture").apply {
            start()
        }
        Log.d(TAG, "started: ${codec.name} ${codec.sampleRate}Hz " +
                   "frame=${codec.frameSamples} buffer=$bufferBytes session=$audioSessionId")
        return true
    }

    /** Stops the thread and releases the device. Safe to call repeatedly. */
    fun stop() {
        running.set(false)
        // Join before release(): the loop must not touch a freed AudioRecord.
        thread?.join(1000)
        thread = null
        try {
            record?.let {
                if (it.recordingState == AudioRecord.RECORDSTATE_RECORDING) it.stop()
                it.release()
            }
        } catch (e: Exception) {
            Log.w(TAG, "stop/release failed: ${e.message}")
        }
        record = null
        sink = null
        Log.d(TAG, "stopped: captured=${framesCaptured.get()} encoded=${framesEncoded.get()}")
    }

    /**
     * Gates the uplink without tearing capture down.
     *
     * Capture keeps running so the level meter stays live and PTT re-arms
     * instantly, but nothing is encoded or sent while this is false. Floor
     * control and mute both land here, and in MCPTT sending before the floor is
     * granted is a protocol violation — so the gate is checked per frame rather
     * than trusted to the caller.
     */
    fun setTransmitEnabled(enabled: Boolean) {
        transmitting.set(enabled)
    }

    val isTransmitting: Boolean get() = transmitting.get()

    private fun captureLoop() {
        // URGENT_AUDIO asks the scheduler to treat this as real-time work.
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)

        // Allocated once: per-frame allocation would invite a GC pause mid-loop.
        val pcm = ShortArray(codec.frameSamples)
        val encoded = ByteArray(codec.maxEncodedBytes)
        var firstOfSpurt = true
        var wasTransmitting = transmitting.get()

        val rec = record ?: return
        val out = sink ?: return

        while (running.get()) {
            // Blocking read: returns when a full frame is available, which is
            // what paces this loop. No sleep anywhere — the device is the clock.
            val read = try {
                rec.read(pcm, 0, codec.frameSamples)
            } catch (e: Exception) {
                lastError = "read threw: ${e.message}"
                break
            }

            if (read <= 0) {
                // ERROR_INVALID_OPERATION etc. A short read is not recoverable
                // here; stop and let the UI surface it.
                if (read < 0) {
                    lastError = "AudioRecord.read returned $read"
                    break
                }
                continue
            }
            framesCaptured.incrementAndGet()

            val tx = transmitting.get()
            if (!tx) {
                // Mark the next enabled frame as a talk-spurt start.
                if (wasTransmitting) firstOfSpurt = true
                wasTransmitting = false
                // Timestamp still advances: RTP time is the media clock, and a
                // gap in it is how the far end learns the talk spurt paused.
                timestamp.addAndGet(read)
                continue
            }
            wasTransmitting = true

            val n = codec.encode(pcm, read, encoded)
            if (n > 0) {
                out.onFrame(encoded, n, timestamp.get(), firstOfSpurt)
                firstOfSpurt = false
                framesEncoded.incrementAndGet()
            }
            // Counted in samples produced, never from the wall clock: the audio
            // device's clock and the system clock drift apart, and a timestamp
            // derived from the latter slowly corrupts the far end's jitter
            // buffer — a failure that only appears minutes into a call.
            timestamp.addAndGet(read)
        }

        if (lastError != null) Log.e(TAG, "captureLoop exited: $lastError")
    }
}
