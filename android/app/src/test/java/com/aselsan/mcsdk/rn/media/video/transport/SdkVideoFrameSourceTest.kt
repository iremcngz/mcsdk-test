package com.aselsan.mcsdk.rn.media.video.transport

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SdkVideoFrameSourceTest {

    private var now = 0L
    private val frames = mutableListOf<Long>()
    private val source = SdkVideoFrameSource(nowMs = { now })

    private val listener = object : VideoFrameSource.Listener {
        override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
            assertEquals(data.size, len)
            frames += ssrc
        }

        override fun onFrameLost(ssrc: Long) = Unit
    }

    private fun frame(ssrc: Long, key: Boolean = false, call: String = "c1", timestampUs: Long = 0) {
        CallVideoRouter.deliver(call, ssrc, ByteArray(8), timestampUs, key)
    }

    @Before fun setUp() {
        CallVideoRouter.resetForTest()
        source.start(listener)
    }

    @After fun tearDown() = CallVideoRouter.resetForTest()

    // The screen opens before there may be a call to watch.
    @Test
    fun `nothing arrives until a call is named`() {
        frame(1)
        assertTrue(frames.isEmpty())
    }

    @Test
    fun `frames of another call are ignored`() {
        source.callId = "c1"
        frame(1, call = "c2")
        assertTrue(frames.isEmpty())
    }

    @Test
    fun `a call's frames reach the listener`() {
        source.callId = "c1"
        frame(1)
        frame(1)
        assertEquals(listOf(1L, 1L), frames)
        assertEquals(2, source.framesDelivered)
    }

    // One decoder: frames of two transmitters would paint garbage.
    @Test
    fun `holds to one transmitter while it is sending`() {
        source.callId = "c1"
        frame(1)
        now += 40
        frame(2, key = true)
        now += 40
        frame(1)
        assertEquals(listOf(1L, 1L), frames)
        assertEquals(1, source.otherStreamFrames)
    }

    @Test
    fun `moves to the next transmitter's key frame once the first goes quiet`() {
        source.callId = "c1"
        frame(1)
        now += 1500
        frame(2) // not where a decoder can start
        assertEquals(listOf(1L), frames)

        frame(2, key = true)
        frame(2)
        assertEquals(listOf(1L, 2L, 2L), frames)
    }

    @Test
    fun `a new call starts from its own first transmitter`() {
        source.callId = "c1"
        frame(1)
        source.callId = "c2"
        frame(2, call = "c2")
        assertEquals(listOf(1L, 2L), frames)
    }

    @Test
    fun `stopping unhooks it, but not the source that replaced it`() {
        source.callId = "c1"
        source.stop()
        frame(1)
        assertTrue(frames.isEmpty())

        val next = SdkVideoFrameSource(nowMs = { now })
        next.callId = "c1"
        next.start(listener)
        source.stop()
        frame(1)
        assertEquals(listOf(1L), frames)
    }

    @Test
    fun `a key frame request names the call`() {
        var asked: Pair<String, Long>? = null
        CallVideoRouter.keyFrameRequester = CallVideoRouter.KeyFrameRequester { c, s -> asked = c to s }
        source.requestKeyFrame(7) // no call yet
        assertEquals(null, asked)

        source.callId = "c1"
        source.requestKeyFrame(7)
        assertEquals("c1" to 7L, asked)
        assertEquals(1, source.keyFramesRequested)
    }

    // The SDK says nothing of what it lost; the gaps in capture time do.
    @Test
    fun `frames missing from the capture times are counted`() {
        source.callId = "c1"
        var t = 0L
        repeat(30) { t += 41_667; frame(1, timestampUs = t) }
        assertEquals(0, source.framesMissed)

        t += 4 * 41_667
        frame(1, timestampUs = t)
        assertEquals(3, source.framesMissed)
    }

    @Test
    fun `a new transmitter's capture clock is not compared with the old one's`() {
        source.callId = "c1"
        var t = 0L
        repeat(30) { t += 41_667; frame(1, timestampUs = t) }
        now += 1500
        // Its clock is unrelated: a jump that would read as hundreds of frames.
        frame(2, key = true, timestampUs = t + 900_000)
        repeat(30) { i -> frame(2, timestampUs = t + 900_000 + (i + 1) * 41_667L) }
        assertEquals(0, source.framesMissed)
    }

    // VideoTuning.freezeOnLoss: a gap is reported as a lost frame, ahead of the frame
    // after it, so KeyFrameGate holds the picture until a key frame.
    private fun gapSource(freeze: Boolean): MutableList<String> {
        val events = mutableListOf<String>()
        source.stop()
        val s = SdkVideoFrameSource(nowMs = { now }, freezeOnLoss = { freeze })
        s.callId = "c1"
        s.start(object : VideoFrameSource.Listener {
            override fun onFrame(ssrc: Long, data: ByteArray, len: Int, timestampUs: Long, keyFrame: Boolean) {
                events += if (keyFrame) "key" else "frame"
            }
            override fun onFrameLost(ssrc: Long) { events += "lost" }
        })
        var t = 0L
        repeat(30) { t += 41_667; frame(1, timestampUs = t) }
        events.clear()
        t += 3 * 41_667
        frame(1, timestampUs = t)
        return events
    }

    @Test
    fun `with freeze on loss, a gap is reported before the frame after it`() {
        assertEquals(listOf("lost", "frame"), gapSource(freeze = true))
    }

    @Test
    fun `without it, the frames after a gap are just delivered`() {
        assertEquals(listOf("frame"), gapSource(freeze = false))
    }
}
