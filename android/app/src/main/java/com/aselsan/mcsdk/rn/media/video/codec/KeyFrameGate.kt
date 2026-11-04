package com.aselsan.mcsdk.rn.media.video.codec

/**
 * KeyFrameGate — decides which received frames the decoder may have.
 *
 * Every frame but a key frame depends on the one before it. So after a loss, and
 * before the first frame, a frame is worthless until a key frame arrives; decoding
 * it would paint garbage rather than fail. While waiting, this asks the sender for
 * one, at most once per [requestIntervalMs]: a PLI goes out for every frame
 * otherwise, and each one that reaches the encoder spends bitrate on a key frame
 * nobody needs.
 *
 * Kept free of Android types so it can be tested on the JVM. Called from the source's
 * thread and, on a decoder restart, the main thread, hence the lock.
 */
class KeyFrameGate(
    private val requestKeyFrame: (ssrc: Long) -> Unit,
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val requestIntervalMs: Long = DEFAULT_REQUEST_INTERVAL_MS,
) {

    private companion object {
        const val DEFAULT_REQUEST_INTERVAL_MS = 1000L
    }

    private var waiting = true
    private var lastRequestMs = Long.MIN_VALUE

    /** True if this frame may go to the decoder. */
    @Synchronized
    fun accept(ssrc: Long, keyFrame: Boolean): Boolean {
        if (keyFrame) waiting = false
        if (waiting) requestIfDue(ssrc)
        return !waiting
    }

    /** A frame was lost, or the decoder lost its state: wait for a key frame. */
    @Synchronized
    fun onLost(ssrc: Long) {
        waiting = true
        requestIfDue(ssrc)
    }

    /** The decoder is new and has seen nothing. Asks at the next frame. */
    @Synchronized
    fun restart() {
        waiting = true
        lastRequestMs = Long.MIN_VALUE
    }

    private fun requestIfDue(ssrc: Long) {
        val now = nowMs()
        if (lastRequestMs != Long.MIN_VALUE && now - lastRequestMs < requestIntervalMs) return
        lastRequestMs = now
        requestKeyFrame(ssrc)
    }
}
