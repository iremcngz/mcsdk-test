package com.aselsan.mcsdk.rn.media.video

/**
 * What the camera and encoder run at. The defaults are a safe start for an LTE
 * link, well inside the 1280x720 that the SDK's level 3.1 allows; the settings
 * screen can change the last three (VideoTuning).
 *
 * 500 kbps rather than 800: on the Wi-Fi this was tested on, 800 kbps each way was
 * more than the air could carry once both phones sent, and most frames were lost.
 * 24 fps because it is a rate both test phones' cameras hold fixed (as are 15 and 30);
 * a rate in between gets a variable range, and the camera then runs faster than the
 * encoder was told.
 */
data class VideoConfig(
    val width: Int = 640,
    val height: Int = 480,
    val frameRate: Int = 24,
    val bitrateKbps: Int = 500,
    // Short so that a late joiner or a lost frame is not left waiting long: the SDK
    // cannot ask for a key frame (no video RTCP), so this is how long a loss lasts.
    val keyFrameIntervalSeconds: Int = 1,
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
