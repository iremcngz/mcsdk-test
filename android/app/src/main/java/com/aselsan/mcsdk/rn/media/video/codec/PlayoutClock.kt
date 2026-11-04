package com.aselsan.mcsdk.rn.media.video.codec

/**
 * PlayoutClock — says when a received frame should go on screen.
 *
 * Measured between two phones on Wi-Fi, frames stall for ~240 ms every ~0.73 s and
 * then arrive in a clump, with nothing lost. Drawn on arrival that looks like the
 * picture freezing and jumping. So each frame is held back to its capture time plus
 * a fixed [delayMs], which spreads a clump back out at the rate it was filmed.
 *
 * The two phones' clocks share no origin, so the sum needs the offset between them
 * and the network's own travel time. Only the difference is knowable, and the
 * smallest seen is the best estimate: that frame was the least delayed. It is taken
 * over a sliding window, so a path that has become slower for good is followed
 * rather than leaving every frame late from then on.
 *
 * Kept free of Android types so it can be tested on the JVM. One thread only.
 */
class PlayoutClock(private val delayMs: Long = DEFAULT_DELAY_MS) {

    companion object {
        /**
         * Covers the measured stalls (mean 244 ms) at the cost of that much latency.
         * The longest seen, 402 ms, still shows as a short hitch.
         */
        const val DEFAULT_DELAY_MS = 300L

        private const val WINDOW_MS = 10_000L

        /** More than any network does: a new sender, or RTP's 32-bit timestamp wrapping. */
        private const val JUMP_MS = 5_000L
    }

    private var offset = 0L
    private var windowMin = 0L
    private var windowStart = 0L
    private var started = false

    /**
     * @param nowMs     a monotonic clock, when the frame arrived
     * @param captureUs the frame's capture time on the sender's clock
     * @return when to play it, on [nowMs]'s clock. Earlier than now means it is late.
     */
    fun playAt(nowMs: Long, captureUs: Long): Long {
        val captureMs = captureUs / 1000
        val sample = nowMs - captureMs

        if (!started || kotlin.math.abs(sample - offset) > JUMP_MS) {
            started = true
            offset = sample
            windowMin = sample
            windowStart = nowMs
        } else {
            if (sample < offset) offset = sample
            if (sample < windowMin) windowMin = sample
            if (nowMs - windowStart >= WINDOW_MS) {
                offset = windowMin
                windowMin = sample
                windowStart = nowMs
            }
        }
        return captureMs + offset + delayMs
    }
}
