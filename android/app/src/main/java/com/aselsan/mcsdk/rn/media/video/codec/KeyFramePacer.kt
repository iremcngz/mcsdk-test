package com.aselsan.mcsdk.rn.media.video.codec

/**
 * KeyFramePacer — asks the encoder for a key frame when it has not made one in time.
 *
 * KEY_I_FRAME_INTERVAL is a request, not a rule. The Galaxy A20's Exynos encoder makes
 * a key frame about every 30 frames whatever it is told: asked for one a second, it gave
 * 32 in 959 frames at 24 fps and 34 in 997 at 15 fps, so at 15 fps a loss lasted 2 s.
 * The S25's Qualcomm encoder keeps to the interval. With no video RTCP the far end
 * cannot ask for a key frame, so the interval is the longest a loss lasts, and it has
 * to be kept here.
 *
 * It watches the encoder's output, in the frames' own capture time rather than on a
 * timer, so it keeps step with the stream and says nothing while the camera is stalled.
 * An encoder that keeps to the interval is never asked: its key frames arrive first.
 * Once asked, it waits for the key frame rather than ask again on every frame, since an
 * encoder takes a frame or two to act on it.
 *
 * One thread: the encoder's output. Kept free of Android types so it can be tested on
 * the JVM.
 */
class KeyFramePacer(
    intervalSeconds: Int,
    private val requestKeyFrame: () -> Unit,
    private val onFirstForced: (sinceKeyMs: Long) -> Unit = {},
) {
    private val intervalUs = intervalSeconds * 1_000_000L

    private var lastKeyUs = NONE
    private var requested = false
    private var forcedAny = false

    /** Key frames this asked for. */
    var forced = 0
        private set

    /** Takes each frame the encoder put out. */
    fun onFrame(captureTimeUs: Long, isKey: Boolean) {
        if (isKey) {
            lastKeyUs = captureTimeUs
            requested = false
            return
        }
        // No key frame seen yet (frames gated before sending began, then a missed
        // request): measure from the first frame seen instead.
        val last = lastKeyUs
        if (last == NONE) {
            lastKeyUs = captureTimeUs
            return
        }
        if (requested) return
        val since = captureTimeUs - last
        if (since < intervalUs) return

        requested = true
        forced++
        if (!forcedAny) {
            forcedAny = true
            onFirstForced(since / 1000)
        }
        requestKeyFrame()
    }

    private companion object {
        const val NONE = Long.MIN_VALUE
    }
}
