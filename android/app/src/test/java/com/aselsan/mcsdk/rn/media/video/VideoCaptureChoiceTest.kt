package com.aselsan.mcsdk.rn.media.video

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VideoCaptureChoiceTest {

    @Test
    fun `the wanted size wins when offered`() {
        val offered = listOf(1920 to 1080, 640 to 480, 320 to 240)
        assertEquals(640 to 480, VideoCaptureChoice.chooseSize(offered, 640, 480))
    }

    @Test
    fun `otherwise the closest size the level allows`() {
        val offered = listOf(1920 to 1080, 800 to 600, 320 to 240)
        assertEquals(800 to 600, VideoCaptureChoice.chooseSize(offered, 640, 480))
    }

    @Test
    fun `a size past level 3_1 is never picked`() {
        assertNull(VideoCaptureChoice.chooseSize(listOf(1920 to 1080), 640, 480))
    }

    @Test
    fun `nothing offered means nothing chosen`() {
        assertNull(VideoCaptureChoice.chooseSize(emptyList(), 640, 480))
    }

    @Test
    fun `a fixed rate beats a range that contains it`() {
        val offered = listOf(7 to 30, 24 to 24, 15 to 30)
        assertEquals(24 to 24, VideoCaptureChoice.chooseFpsRange(offered, 24))
    }

    @Test
    fun `otherwise the tightest range`() {
        val offered = listOf(7 to 30, 15 to 30)
        assertEquals(15 to 30, VideoCaptureChoice.chooseFpsRange(offered, 24))
    }

    @Test
    fun `a range that misses the rate is not used`() {
        assertNull(VideoCaptureChoice.chooseFpsRange(listOf(30 to 30), 24))
    }
}
