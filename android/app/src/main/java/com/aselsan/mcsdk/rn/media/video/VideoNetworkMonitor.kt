package com.aselsan.mcsdk.rn.media.video

/**
 * VideoNetworkMonitor — turns the receiver's counters into what the viewer should be
 * told: the picture is fine, weak, or not coming.
 *
 * It looks only at what the playout buffer could not hide. Short stalls are no signal:
 * on the Wi-Fi this was measured on they came 76 times in 50 s on a strong signal, the
 * buffer covered them, and a warning based on them would never go away. For the same
 * reason signal strength is not used.
 *
 * A warning needs to last before it shows and stay clear before it goes, so one bad
 * moment neither raises it nor makes it flicker. Before the first frame nothing is
 * reported, since a sender that has not started yet says nothing about the network.
 *
 * Kept free of Android types so it can be tested on the JVM. One thread only.
 */
class VideoNetworkMonitor {

    enum class Quality { GOOD, WEAK, LOST }

    private companion object {
        const val WINDOW_MS = 4_000L
        const val WEAK_AFTER_MS = 3_000L
        const val GOOD_AFTER_MS = 5_000L
        const val LOST_AFTER_MS = 2_000L

        const val MAX_LOSS_PERCENT = 2.0
        const val MAX_LATE_PERCENT = 5.0

        /** One is normal: joining a stream in mid-frame costs exactly that. */
        const val MAX_DISCARDED = 1
    }

    private class Sample(
        val nowMs: Long,
        val packets: Int,
        val lost: Int,
        val frames: Int,
        val discarded: Int,
        val late: Int,
    )

    private val samples = ArrayDeque<Sample>()
    private var quality = Quality.GOOD
    private var lastFrames = 0
    private var lastFrameMs = -1L
    private var badSinceMs = -1L
    private var goodSinceMs = -1L

    /**
     * Takes the receiver's cumulative counters, about once a second.
     *
     * @return what to tell the viewer now
     */
    fun onSample(nowMs: Long, packets: Int, lost: Int, frames: Int, discarded: Int, late: Int): Quality {
        samples.addLast(Sample(nowMs, packets, lost, frames, discarded, late))
        while (samples.size > 1 && nowMs - samples.first().nowMs > WINDOW_MS) samples.removeFirst()

        if (frames > lastFrames) {
            lastFrames = frames
            lastFrameMs = nowMs
        }
        if (lastFrameMs < 0) return quality

        if (nowMs - lastFrameMs >= LOST_AFTER_MS) {
            badSinceMs = -1
            goodSinceMs = -1
            quality = Quality.LOST
            return quality
        }

        if (windowIsBad(samples.first(), samples.last())) {
            goodSinceMs = -1
            if (badSinceMs < 0) badSinceMs = nowMs
            if (quality == Quality.LOST || nowMs - badSinceMs >= WEAK_AFTER_MS) quality = Quality.WEAK
        } else {
            badSinceMs = -1
            if (goodSinceMs < 0) goodSinceMs = nowMs
            when {
                nowMs - goodSinceMs >= GOOD_AFTER_MS -> quality = Quality.GOOD
                // Frames are back, but it is too soon to call it fine.
                quality == Quality.LOST -> quality = Quality.WEAK
                else -> Unit
            }
        }
        return quality
    }

    private fun windowIsBad(from: Sample, to: Sample): Boolean {
        val lost = to.lost - from.lost
        val packets = to.packets - from.packets + lost
        val frames = to.frames - from.frames
        val late = to.late - from.late
        val discarded = to.discarded - from.discarded

        val lossPercent = if (packets > 0) lost * 100.0 / packets else 0.0
        val latePercent = if (frames > 0) late * 100.0 / frames else 0.0
        return lossPercent > MAX_LOSS_PERCENT ||
            latePercent > MAX_LATE_PERCENT ||
            discarded > MAX_DISCARDED
    }
}
