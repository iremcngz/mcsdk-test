package com.aselsan.mcsdk.rn.media.video

/**
 * What the camera and encoder run at. The defaults are a safe start for an LTE
 * link, well inside the 1280x720 that the SDK's level 3.1 allows.
 */
data class VideoConfig(
    val width: Int = 640,
    val height: Int = 480,
    val frameRate: Int = 24,
    val bitrateKbps: Int = 800,
    // Short so that a late joiner or a lost frame is not left waiting long.
    val keyFrameIntervalSeconds: Int = 2,
)

/**
 * Picks what the camera actually offers. Plain pairs rather than android.util
 * types, so the rules can be tested on the JVM.
 */
object VideoCaptureChoice {

    /** H.264 level 3.1's largest frame: 3600 macroblocks. */
    private const val MAX_PIXELS = 1280 * 720

    /**
     * The wanted size if offered, otherwise the closest one in pixels that the
     * level allows. Null when the camera offers nothing usable.
     */
    fun chooseSize(offered: List<Pair<Int, Int>>, width: Int, height: Int): Pair<Int, Int>? {
        val wanted = width to height
        if (wanted in offered) return wanted
        val pixels = width * height
        return offered
            .filter { (w, h) -> w * h <= MAX_PIXELS && w % 2 == 0 && h % 2 == 0 }
            .minByOrNull { (w, h) -> kotlin.math.abs(w * h - pixels) }
    }

    /**
     * The frame rate range that pins [fps] most tightly, preferring a fixed one:
     * in a range like 7-30 the camera lowers the rate in dim light, which the
     * encoder's bitrate then has to absorb. Null when no range contains [fps].
     */
    fun chooseFpsRange(offered: List<Pair<Int, Int>>, fps: Int): Pair<Int, Int>? =
        offered
            .filter { (low, high) -> fps in low..high }
            .minWithOrNull(compareBy({ (low, high) -> high - low }, { (_, high) -> high }))
}
