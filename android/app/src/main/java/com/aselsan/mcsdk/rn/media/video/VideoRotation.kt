package com.aselsan.mcsdk.rn.media.video

import kotlin.math.abs
import kotlin.math.min

/**
 * The geometry of turning the camera's picture upright. Free of Android types so it
 * can be tested on the JVM.
 *
 * A camera sensor is mounted along the phone's long side, so its frames are sideways
 * while the phone is upright. The far end cannot turn them: SDP negotiates no
 * rotation (no CVO extension), so whatever is encoded is what it shows. They have
 * to be turned here, on the pixels.
 */
object VideoRotation {

    /** How far past a corner the phone has to go to count as turned, so it does not flicker. */
    private const val HYSTERESIS_DEGREES = 60

    /**
     * Quantizes OrientationEventListener's angle to 0, 90, 180 or 270, holding [current]
     * until the phone is clearly past it. A negative [raw] is its "unknown": flat on a table.
     */
    fun snap(raw: Int, current: Int): Int {
        if (raw < 0) return current
        val distance = abs(raw - current).let { min(it, 360 - it) }
        if (distance < HYSTERESIS_DEGREES) return current
        return ((raw + 45) / 90 * 90) % 360
    }

    /** True when the phone is on its side, so the frame sent should be wider than tall. */
    fun isLandscape(deviceAngle: Int) = deviceAngle == 90 || deviceAngle == 270

    /**
     * The clockwise rotation and shape of the picture to draw, as (rotation, width, height).
     *
     * @param transformSwapsAxes whether SurfaceTexture's matrix has already turned the
     *        sensor's image to the phone's natural orientation. Camera2 normally does
     *        this for a texture, but it is a framework detail, so it is read off the
     *        matrix at run time rather than assumed.
     */
    fun picture(
        cameraWidth: Int,
        cameraHeight: Int,
        sensorOrientation: Int,
        deviceAngle: Int,
        transformSwapsAxes: Boolean,
    ): Triple<Int, Int, Int> =
        if (transformSwapsAxes) {
            Triple(deviceAngle, cameraHeight, cameraWidth)
        } else {
            Triple((sensorOrientation + deviceAngle) % 360, cameraWidth, cameraHeight)
        }

    /**
     * Fills [out], a column-major GLSL mat2, to draw a quad spanning -1..1 as a
     * [contentWidth]x[contentHeight] picture turned clockwise by [rotation], as large
     * as fits an [outWidth]x[outHeight] frame. A picture that does not match the frame's
     * shape (the phone was turned after sending began) gets black bars rather than
     * being stretched: the frame's own size cannot change without restarting the encoder.
     */
    fun quadMatrix(
        contentWidth: Int,
        contentHeight: Int,
        outWidth: Int,
        outHeight: Int,
        rotation: Int,
        out: FloatArray,
    ) {
        val (cos, sin) = when (rotation) {
            90 -> 0f to 1f
            180 -> -1f to 0f
            270 -> 0f to -1f
            else -> 1f to 0f
        }
        val sideways = rotation == 90 || rotation == 270
        val turnedWidth = if (sideways) contentHeight else contentWidth
        val turnedHeight = if (sideways) contentWidth else contentHeight
        val scale = min(outWidth.toFloat() / turnedWidth, outHeight.toFloat() / turnedHeight)

        val sx = scale * contentWidth / outWidth
        val sy = scale * contentHeight / outHeight
        val tx = scale * contentWidth / outHeight
        val ty = scale * contentHeight / outWidth
        // x' =  cos*x + sin*y, y' = -sin*x + cos*y: clockwise, with y pointing up.
        out[0] = cos * sx
        out[1] = -sin * tx
        out[2] = sin * ty
        out[3] = cos * sy
    }
}

/**
 * Notices when frames stop coming and says what the stall looked like. Comparing how
 * long frames took to arrive with how far apart they were captured is what tells a
 * network stall from a camera that really stopped.
 */
class FrameGapMeter(
    private val thresholdMs: Long,
    private val report: (gapMs: Long, capturedGapMs: Long, keyFrame: Boolean) -> Unit,
) {
    private var lastNowMs = -1L
    private var lastTimeUs = 0L

    /** @param timeUs the frame's capture time; only differences are used */
    fun onFrame(nowMs: Long, timeUs: Long, keyFrame: Boolean) {
        if (lastNowMs >= 0 && nowMs - lastNowMs >= thresholdMs) {
            report(nowMs - lastNowMs, (timeUs - lastTimeUs) / 1000, keyFrame)
        }
        lastNowMs = nowMs
        lastTimeUs = timeUs
    }
}
