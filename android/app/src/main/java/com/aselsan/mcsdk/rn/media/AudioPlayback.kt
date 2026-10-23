package com.aselsan.mcsdk.rn.media

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Process
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * AudioPlayback — the speaker thread: pull a frame, decode it, write PCM.
 *
 * The mirror of AudioCapture, and real-time for the same reason: AudioTrack
 * drains its buffer at a fixed rate, and arriving late leaves a hole that is
 * heard as a click. The loop therefore does the minimum — read, decode, write —
 * and anything slow stays on other threads.
 *
 * Pacing comes from the hardware, not from a timer. AudioTrack.write() blocks
 * while the device buffer is full, so the loop is clocked by the speaker the
 * same way capture is clocked by the microphone. A sleep() here would drift
 * against the audio clock.
 *
 * It owns neither the audio mode, the routing, nor the jitter buffer's contents;
 * MediaPipeline sequences those around it.
 */
class AudioPlayback(
    private val codec: AudioCodec,
    private val jitter: JitterBuffer,
    /**
     * True while frames may still arrive. A file source goes false at end of
     * file; a live SDK stream never does. Playback drains whatever the jitter
     * buffer still holds and then stops itself, so a finite recording does not
     * sit there emitting silence until someone presses stop.
     */
    private val sourceActive: () -> Boolean = { true },
    /** Called on the playback thread when the stream has run out. */
    private val onFinished: () -> Unit = {},
) {

    companion object {
        private const val TAG = "McSdkPlayback"

        /**
         * Device buffer, in frames. The reported minimum is the smallest that
         * works rather than a comfortable one — at that size a single
         * scheduling hiccup underruns it. Four frames of slack costs 80 ms of
         * latency and removes that class of glitch.
         */
        private const val BUFFER_FRAMES = 4
    }

    @Volatile
    var lastError: String? = null
        private set

    private val running = AtomicBoolean(false)
    private val framesPlayed = AtomicInteger(0)
    private val silentFrames = AtomicInteger(0)
    private val decodeFailures = AtomicInteger(0)

    private var track: AudioTrack? = null
    private var thread: Thread? = null

    val isRunning: Boolean get() = running.get()

    /** Frames written to the device, concealed and silent ones included. */
    val playedFrames: Int get() = framesPlayed.get()

    /** Frames the jitter buffer had nothing for — written as silence. */
    val silentCount: Int get() = silentFrames.get()

    /** Frames the decoder produced no samples for. */
    val decodeFailureCount: Int get() = decodeFailures.get()

    /** 0 until [start] succeeds. */
    var audioSessionId: Int = 0
        private set

    fun start(): Boolean {
        if (running.get()) return true
        lastError = null

        val frameBytes = codec.frameSamples * 2        // 16-bit mono
        val minBuffer = AudioTrack.getMinBufferSize(
            codec.sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) {
            lastError = "getMinBufferSize failed ($minBuffer) — " +
                "${codec.sampleRate} Hz mono PCM16 unsupported for output"
            Log.e(TAG, lastError!!)
            return false
        }
        val bufferBytes = maxOf(minBuffer, frameBytes * BUFFER_FRAMES)

        val t = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        // VOICE_COMMUNICATION, not MEDIA: this routes to the
                        // earpiece/call path and is what pairs with the
                        // capture side's echo canceller.
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(codec.sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(bufferBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        } catch (e: Exception) {
            lastError = "AudioTrack build failed: ${e.message}"
            Log.e(TAG, lastError!!, e)
            return false
        }

        if (t.state != AudioTrack.STATE_INITIALIZED) {
            lastError = "AudioTrack not initialised (state=${t.state})"
            Log.e(TAG, lastError!!)
            t.release()
            return false
        }

        track = t
        audioSessionId = t.audioSessionId
        framesPlayed.set(0)
        silentFrames.set(0)
        decodeFailures.set(0)
        running.set(true)

        try {
            t.play()
        } catch (e: Exception) {
            lastError = "play() threw: ${e.message}"
            Log.e(TAG, lastError!!, e)
            stop()
            return false
        }

        thread = Thread({ playbackLoop() }, "McSdkPlayback").apply { start() }
        Log.d(TAG, "started: ${codec.name} ${codec.sampleRate}Hz " +
                   "frame=${codec.frameSamples} buffer=$bufferBytes session=$audioSessionId")
        return true
    }

    fun stop() {
        running.set(false)
        // Join before release: the loop must not touch a freed AudioTrack.
        thread?.join(1000)
        thread = null
        try {
            track?.let {
                if (it.playState == AudioTrack.PLAYSTATE_PLAYING) it.stop()
                it.release()
            }
        } catch (e: Exception) {
            Log.w(TAG, "stop/release failed: ${e.message}")
        }
        track = null
        Log.d(TAG, "stopped: played=${framesPlayed.get()} silent=${silentFrames.get()}")
    }

    private fun playbackLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)

        // Allocated once: a GC pause mid-loop would be audible.
        val encoded = ByteArray(codec.maxEncodedBytes)
        val pcm = ShortArray(codec.frameSamples)

        val t = track ?: return

        while (running.get()) {
            // Finished when the source is done and the buffer is empty. Checked
            // before the read so the last frames are still played out.
            if (!sourceActive() && jitter.depth() == 0 && jitter.isPrimed) {
                Log.d(TAG, "stream ended: played=${framesPlayed.get()}")
                running.set(false)
                finished = true
                break
            }

            val len = jitter.read(encoded)

            var samples = 0
            if (len > 0) {
                samples = codec.decode(encoded, len, pcm)
                if (samples <= 0) decodeFailures.incrementAndGet()
            }

            if (samples <= 0) {
                // Nothing to play: before priming, on a genuine underrun, or
                // when a buffering decoder has not produced output yet. Silence
                // keeps the timeline intact — skipping the write would make the
                // stream run early and desynchronise everything after it.
                java.util.Arrays.fill(pcm, 0)
                samples = codec.frameSamples
                silentFrames.incrementAndGet()
            }

            // Blocking write: this is what paces the loop. The device drains at
            // its own rate, so no sleep is needed and none would be correct.
            val written = try {
                t.write(pcm, 0, samples)
            } catch (e: Exception) {
                lastError = "write threw: ${e.message}"
                break
            }

            if (written < 0) {
                lastError = "AudioTrack.write returned $written"
                break
            }
            framesPlayed.incrementAndGet()
        }

        if (lastError != null) Log.e(TAG, "playbackLoop exited: $lastError")
        // Notified outside the loop so the callback cannot stall a real-time
        // iteration. The owner tears the pipeline down from its own thread.
        if (finished) onFinished()
    }

    /** Set when the loop exited because the stream ran out, not by a stop(). */
    @Volatile
    private var finished = false

    /** True once the source ran dry and everything buffered has been played. */
    val isFinished: Boolean get() = finished
}
