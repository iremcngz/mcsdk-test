package com.aselsan.mcsdk.rn.media.video

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoRotationTest {

    /** Where the matrix sends a corner of the quad. */
    private fun apply(m: FloatArray, x: Float, y: Float) =
        (m[0] * x + m[2] * y) to (m[1] * x + m[3] * y)

    private fun assertPoint(ex: Float, ey: Float, got: Pair<Float, Float>) {
        assertEquals(ex, got.first, 0.001f)
        assertEquals(ey, got.second, 0.001f)
    }

    private fun matrix(cw: Int, ch: Int, ow: Int, oh: Int, rotation: Int) =
        FloatArray(4).also { VideoRotation.quadMatrix(cw, ch, ow, oh, rotation, it) }

    // ── snap ─────────────────────────────────────────────────────────────────

    @Test
    fun `a clearly turned phone snaps to the nearest quarter`() {
        assertEquals(90, VideoRotation.snap(85, 0))
        assertEquals(270, VideoRotation.snap(280, 0))
        assertEquals(180, VideoRotation.snap(170, 90))
    }

    @Test
    fun `a small tilt does not change anything`() {
        assertEquals(0, VideoRotation.snap(50, 0))
        assertEquals(0, VideoRotation.snap(310, 0))
        assertEquals(90, VideoRotation.snap(140, 90))
    }

    @Test
    fun `angles close to the wrap count as close to zero`() {
        assertEquals(0, VideoRotation.snap(355, 0))
        assertEquals(0, VideoRotation.snap(350, 270).let { VideoRotation.snap(5, it) })
    }

    @Test
    fun `a flat phone keeps what it had`() {
        assertEquals(90, VideoRotation.snap(-1, 90))
    }

    @Test
    fun `sideways means a wide frame`() {
        assertTrue(VideoRotation.isLandscape(90))
        assertTrue(VideoRotation.isLandscape(270))
        assertFalse(VideoRotation.isLandscape(0))
        assertFalse(VideoRotation.isLandscape(180))
    }

    // ── picture ──────────────────────────────────────────────────────────────

    @Test
    fun `a matrix that already turned the image leaves only the phone's own angle`() {
        assertEquals(Triple(0, 480, 640), VideoRotation.picture(640, 480, 90, 0, true))
        assertEquals(Triple(90, 480, 640), VideoRotation.picture(640, 480, 90, 90, true))
    }

    @Test
    fun `otherwise the sensor's mounting has to be undone too`() {
        assertEquals(Triple(90, 640, 480), VideoRotation.picture(640, 480, 90, 0, false))
        assertEquals(Triple(0, 640, 480), VideoRotation.picture(640, 480, 90, 270, false))
    }

    // ── quadMatrix ───────────────────────────────────────────────────────────

    @Test
    fun `an unturned picture of the frame's shape fills it exactly`() {
        val m = matrix(480, 640, 480, 640, 0)
        assertPoint(1f, 1f, apply(m, 1f, 1f))
        assertPoint(-1f, -1f, apply(m, -1f, -1f))
    }

    @Test
    fun `a quarter turn is clockwise and fills a frame of the turned shape`() {
        val m = matrix(480, 640, 640, 480, 90)
        // The picture's top right ends up at the frame's bottom right.
        assertPoint(1f, -1f, apply(m, 1f, 1f))
        // Its top left at the top right.
        assertPoint(1f, 1f, apply(m, -1f, 1f))
    }

    @Test
    fun `a half turn swaps opposite corners`() {
        val m = matrix(480, 640, 480, 640, 180)
        assertPoint(-1f, -1f, apply(m, 1f, 1f))
    }

    @Test
    fun `three quarters is a quarter the other way`() {
        val m = matrix(480, 640, 640, 480, 270)
        assertPoint(-1f, 1f, apply(m, 1f, 1f))
    }

    @Test
    fun `a picture of the wrong shape gets bars instead of being stretched`() {
        // A phone turned after sending began: a wide picture in a tall 480x640 frame.
        val m = matrix(480, 640, 480, 640, 90)
        val corner = apply(m, 1f, 1f)
        assertEquals(1f, kotlin.math.abs(corner.first), 0.001f)
        // 480 wide by 360 tall inside 640 of height.
        assertEquals(360f / 640f, kotlin.math.abs(corner.second), 0.001f)
    }

    // ── FrameGapMeter ────────────────────────────────────────────────────────

    @Test
    fun `steady frames report nothing`() {
        val reports = mutableListOf<Triple<Long, Long, Boolean>>()
        val meter = FrameGapMeter(100) { g, c, k -> reports += Triple(g, c, k) }
        for (i in 0..20) meter.onFrame(i * 42L, i * 42_000L, false)
        assertTrue(reports.isEmpty())
    }

    @Test
    fun `a stall reports its length next to how far apart the frames were captured`() {
        val reports = mutableListOf<Triple<Long, Long, Boolean>>()
        val meter = FrameGapMeter(100) { g, c, k -> reports += Triple(g, c, k) }
        meter.onFrame(1000, 5_000_000, false)
        meter.onFrame(1300, 5_042_000, true)
        assertEquals(listOf(Triple(300L, 42L, true)), reports)
    }

    @Test
    fun `the first frame is not a stall`() {
        val reports = mutableListOf<Long>()
        val meter = FrameGapMeter(100) { g, _, _ -> reports += g }
        meter.onFrame(999_999, 0, true)
        assertTrue(reports.isEmpty())
    }
}
