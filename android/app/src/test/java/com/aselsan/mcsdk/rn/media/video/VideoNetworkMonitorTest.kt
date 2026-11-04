package com.aselsan.mcsdk.rn.media.video

import com.aselsan.mcsdk.rn.media.video.VideoNetworkMonitor.Quality
import org.junit.Assert.assertEquals
import org.junit.Test

class VideoNetworkMonitorTest {

    private val monitor = VideoNetworkMonitor()

    private var nowMs = 0L
    private var packets = 0
    private var lost = 0
    private var frames = 0
    private var discarded = 0
    private var late = 0

    /** Plays [seconds] of a stream at 24 frames and 100 packets a second. */
    private fun run(
        seconds: Int,
        lostPerSecond: Int = 0,
        latePerSecond: Int = 0,
        framesPerSecond: Int = 24,
    ): Quality {
        var quality = Quality.GOOD
        repeat(seconds) {
            nowMs += 1000
            packets += if (framesPerSecond > 0) 100 else 0
            lost += lostPerSecond
            frames += framesPerSecond
            late += latePerSecond
            quality = monitor.onSample(nowMs, packets, lost, frames, discarded, late)
        }
        return quality
    }

    @Test
    fun `a clean stream stays good`() {
        assertEquals(Quality.GOOD, run(30))
    }

    @Test
    fun `nothing is reported before the first frame`() {
        assertEquals(Quality.GOOD, run(10, framesPerSecond = 0))
    }

    @Test
    fun `steady loss turns weak after it has lasted`() {
        run(5)
        // ~5 s in all: the window's clean seconds dilute the first second of loss, and
        // the 3 s it must then last only start counting after that.
        assertEquals(Quality.GOOD, run(4, lostPerSecond = 5))
        assertEquals(Quality.WEAK, run(1, lostPerSecond = 5))
    }

    @Test
    fun `loss within the limit is not a warning`() {
        run(5)
        assertEquals(Quality.GOOD, run(20, lostPerSecond = 2))
    }

    @Test
    fun `frames the buffer could not cover count`() {
        run(5)
        assertEquals(Quality.WEAK, run(5, latePerSecond = 3))
    }

    @Test
    fun `a late frame now and then does not`() {
        run(5)
        assertEquals(Quality.GOOD, run(20, latePerSecond = 1))
    }

    @Test
    fun `one discarded frame, as on joining mid-stream, is no warning`() {
        run(2)
        discarded += 1
        assertEquals(Quality.GOOD, run(10))
    }

    @Test
    fun `repeated discarded frames are`() {
        run(5)
        discarded += 2
        run(1)
        discarded += 2
        run(1)
        discarded += 2
        run(1)
        discarded += 2
        assertEquals(Quality.WEAK, run(1))
    }

    @Test
    fun `the warning waits for a clean stretch before it goes`() {
        run(5)
        assertEquals(Quality.WEAK, run(5, lostPerSecond = 5))
        // The window still holds the loss for its first seconds, then 5 s must be clean.
        assertEquals(Quality.WEAK, run(6))
        assertEquals(Quality.GOOD, run(4))
    }

    @Test
    fun `a brief return of loss does not clear the wait early`() {
        run(5)
        run(5, lostPerSecond = 5)
        run(8)
        run(1, lostPerSecond = 20)
        assertEquals(Quality.WEAK, run(3))
    }

    @Test
    fun `no frames for two seconds is lost`() {
        run(5)
        assertEquals(Quality.GOOD, run(1, framesPerSecond = 0))
        assertEquals(Quality.LOST, run(1, framesPerSecond = 0))
    }

    @Test
    fun `lost goes to weak when frames return, then to good`() {
        run(5)
        assertEquals(Quality.LOST, run(3, framesPerSecond = 0))
        assertEquals(Quality.WEAK, run(1))
        assertEquals(Quality.GOOD, run(6))
    }
}
