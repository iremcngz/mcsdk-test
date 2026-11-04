package com.aselsan.mcsdk.rn.media.video.codec

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyFrameGateTest {

    private var now = 10_000L
    private val requests = mutableListOf<Long>()
    private val gate = KeyFrameGate({ requests += it }, { now })

    @Test
    fun `nothing passes before the first key frame, and one is asked for`() {
        assertFalse(gate.accept(7, keyFrame = false))
        assertEquals(listOf(7L), requests)
    }

    @Test
    fun `a key frame opens the gate for what follows, without asking`() {
        assertTrue(gate.accept(7, keyFrame = true))
        assertTrue(gate.accept(7, keyFrame = false))
        assertTrue(requests.isEmpty())
    }

    @Test
    fun `a loss closes it again`() {
        gate.accept(7, keyFrame = true)
        gate.onLost(7)
        assertFalse(gate.accept(7, keyFrame = false))
        assertTrue(gate.accept(7, keyFrame = true))
    }

    @Test
    fun `requests are limited to one per interval`() {
        repeat(5) { gate.accept(7, keyFrame = false) }
        assertEquals(1, requests.size)
        now += 999
        gate.accept(7, keyFrame = false)
        assertEquals(1, requests.size)
        now += 1
        gate.accept(7, keyFrame = false)
        assertEquals(2, requests.size)
    }

    @Test
    fun `a restart waits again and may ask at once`() {
        gate.accept(7, keyFrame = true)
        gate.onLost(7)
        assertEquals(1, requests.size)
        gate.restart()
        assertFalse(gate.accept(7, keyFrame = false))
        assertEquals(2, requests.size)
    }
}
