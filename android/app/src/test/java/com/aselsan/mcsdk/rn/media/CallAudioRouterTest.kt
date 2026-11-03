package com.aselsan.mcsdk.rn.media

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class CallAudioRouterTest {

    @Before fun setUp() = CallAudioRouter.resetForTest()
    @After fun tearDown() = CallAudioRouter.resetForTest()

    @Test
    fun `send goes to the sender and is counted`() {
        var got: Triple<String, Int, Long>? = null
        CallAudioRouter.sender = CallAudioRouter.Sender { id, p, t -> got = Triple(id, p.size, t) }

        assertTrue(CallAudioRouter.send("c1", ByteArray(62), 20_000))
        assertEquals(Triple("c1", 62, 20_000L), got)
        assertEquals(1, CallAudioRouter.framesSent)
    }

    // No SDK yet (or destroyed): the frame is counted, not lost silently.
    @Test
    fun `send without a sender reports it`() {
        assertFalse(CallAudioRouter.send("c1", ByteArray(62), 0))
        assertEquals(1, CallAudioRouter.framesWithoutSender)
    }

    @Test
    fun `a frame with no receiver is counted as unrouted`() {
        CallAudioRouter.deliver("c1", 1, ByteArray(62), 0, false)
        assertEquals(1, CallAudioRouter.framesReceived)
        assertEquals(1, CallAudioRouter.framesUnrouted)
    }

    // A source stopping late must not unhook the one that replaced it.
    @Test
    fun `clearing a receiver that was already replaced leaves the new one`() {
        var newGot = 0
        val old = CallAudioRouter.Receiver { _, _, _, _, _ -> }
        val new = CallAudioRouter.Receiver { _, _, _, _, _ -> newGot++ }
        CallAudioRouter.setReceiver(old)
        CallAudioRouter.setReceiver(new)
        CallAudioRouter.clearReceiver(old)

        CallAudioRouter.deliver("c1", 1, ByteArray(62), 0, false)
        assertEquals(1, newGot)
    }
}
