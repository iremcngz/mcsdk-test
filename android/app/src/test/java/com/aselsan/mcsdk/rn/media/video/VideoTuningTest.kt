package com.aselsan.mcsdk.rn.media.video

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class VideoTuningTest {

    private val defaults = VideoConfig()

    @After fun restore() = VideoTuning.set(
        defaults.bitrateKbps, defaults.frameRate, defaults.keyFrameIntervalSeconds, true,
    )

    @Test
    fun `the settings become the encoder's config, the size untouched`() {
        VideoTuning.set(bitrateKbps = 300, frameRate = 15, keyFrameIntervalSeconds = 2, freezeOnLoss = false)
        val c = VideoTuning.config()
        assertEquals(300, c.bitrateKbps)
        assertEquals(15, c.frameRate)
        assertEquals(2, c.keyFrameIntervalSeconds)
        assertEquals(defaults.width to defaults.height, c.width to c.height)
        assertFalse(VideoTuning.freezeOnLoss)
    }

    // 0 would not fail, only misbehave: no bitrate, or a key frame every frame.
    @Test
    fun `values out of range are clamped`() {
        VideoTuning.set(bitrateKbps = 0, frameRate = 120, keyFrameIntervalSeconds = 0, freezeOnLoss = true)
        val c = VideoTuning.config()
        assertEquals(VideoTuning.MIN_BITRATE_KBPS, c.bitrateKbps)
        assertEquals(VideoTuning.MAX_FRAME_RATE, c.frameRate)
        assertEquals(VideoTuning.MIN_KEY_FRAME_INTERVAL_S, c.keyFrameIntervalSeconds)
    }
}
