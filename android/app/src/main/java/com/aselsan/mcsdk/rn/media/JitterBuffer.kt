package com.aselsan.mcsdk.rn.media

import android.util.Log
import java.util.concurrent.atomic.AtomicInteger

/**
 * JitterBuffer — reorders incoming frames and hands them to playback on time.
 *
 * The one piece with no counterpart on the uplink. Capture's ring buffer only
 * moves bytes between threads; here the network's irregularity has to be
 * absorbed as well: frames arrive early, late, out of order, duplicated, or not
 * at all, while AudioTrack wants exactly one frame every [AudioCodec.frameMs].
 *
 * How it works: frames are placed by RTP timestamp, not arrival order, so a
 * frame that overtakes its predecessor still lands in the right slot. Playback
 * does not start until [targetFrames] have accumulated — that deliberate
 * latency is the budget for late arrivals. From then on each read advances the
 * play position by exactly one frame, whether or not a frame was there.
 *
 *   put(ts=0)   → [0]
 *   put(ts=320) → [0,1]
 *   put(ts=960) → [0,1,_,3]      frame 2 is missing, its slot stays open
 *   put(ts=640) → [0,1,2,3]      it arrives late but in time, and fits
 *   read()      → frame 0, position advances
 *
 * A missing frame is concealed by repeating the previous one rather than
 * inserting silence: a 20 ms repeat is far less audible than a 20 ms hole,
 * which clicks. This is the cheap end of packet-loss concealment — a real codec
 * would interpolate — but it is the right default and it is honest, because the
 * substitution is counted.
 *
 * Threading: single producer ([put], from the source thread) and single consumer
 * ([read], from the real-time playback thread). Both are synchronized, which is
 * the one place in this pipeline a lock is acceptable: the critical sections are
 * array copies of tens of bytes, the producer runs at AUDIO priority rather than
 * URGENT, and correct ordering across a sparse buffer cannot be had from two
 * atomic indices the way a FIFO ring can.
 */
class JitterBuffer(
    private val codec: AudioCodec,
    /**
     * Frames to accumulate before playback starts, and the depth it tries to
     * hold. 4 frames = 80 ms, the usual starting point for VoIP: enough to
     * cover ordinary network jitter, short enough not to be heard as delay.
     */
    private val targetFrames: Int = 4,
    /**
     * Slots in the buffer. Must exceed [targetFrames] by a wide margin so a
     * burst of early frames has somewhere to go.
     */
    private val capacityFrames: Int = 32,
) {

    companion object {
        private const val TAG = "McSdkJitter"
    }

    /** One slot: the frame bytes plus whether anything was ever written here. */
    private class Slot(maxBytes: Int) {
        val data = ByteArray(maxBytes)
        var len = 0
        var timestamp = 0
        var filled = false
    }

    // Pre-allocated: nothing in put()/read() may allocate.
    private val slots = Array(capacityFrames) { Slot(codec.maxEncodedBytes) }

    /** Timestamp increment per frame — the stride between adjacent slots. */
    private val stride = codec.frameSamples

    /** Timestamp of the next frame playback will ask for. -1 until primed. */
    private var playTimestamp = -1

    /** True once [targetFrames] have accumulated and reads may begin. */
    private var primed = false

    /** Last frame handed out, reused to conceal a gap. */
    private val lastGood = ByteArray(codec.maxEncodedBytes)
    private var lastGoodLen = 0

    // ── Counters, all read by the UI ──────────────────────────────────────────

    private val received = AtomicInteger(0)
    private val played = AtomicInteger(0)
    /** Arrived after its play position had passed — unusable, dropped. */
    private val late = AtomicInteger(0)
    /** Same timestamp as a frame already held. */
    private val duplicate = AtomicInteger(0)
    /** Never arrived; concealed by repeating the previous frame. */
    private val concealed = AtomicInteger(0)
    /** Nothing at all to play, not even a previous frame to repeat. */
    private val underrun = AtomicInteger(0)
    /** Dropped because the buffer was full — the frame was too far ahead. */
    private val overflow = AtomicInteger(0)

    val receivedFrames: Int get() = received.get()
    val playedFrames: Int get() = played.get()
    val lateFrames: Int get() = late.get()
    val duplicateFrames: Int get() = duplicate.get()
    val concealedFrames: Int get() = concealed.get()
    val underrunFrames: Int get() = underrun.get()
    val overflowFrames: Int get() = overflow.get()

    /** Frames currently held and not yet played. */
    @Synchronized
    fun depth(): Int = slots.count { it.filled }

    val isPrimed: Boolean @Synchronized get() = primed

    /**
     * Accepts one frame. Called from the source thread.
     *
     * The first frame sets the play position; everything after is placed
     * relative to it.
     */
    @Synchronized
    fun put(payload: ByteArray, len: Int, timestamp: Int) {
        received.incrementAndGet()

        if (playTimestamp < 0) {
            // First frame seen: anchor the timeline here. Its own timestamp need
            // not be 0 — an SDK stream can start anywhere.
            playTimestamp = timestamp
        }

        // Where this frame sits relative to what plays next.
        val offsetFrames = (timestamp - playTimestamp) / stride

        if (offsetFrames < 0) {
            // Its moment has passed; playing it now would be out of order.
            late.incrementAndGet()
            return
        }
        if (offsetFrames >= capacityFrames) {
            // Too far ahead to store. Keeping it would mean dropping something
            // nearer, which is worse.
            overflow.incrementAndGet()
            return
        }

        val slot = slots[slotIndex(timestamp)]
        if (slot.filled && slot.timestamp == timestamp) {
            duplicate.incrementAndGet()
            return
        }

        val n = minOf(len, slot.data.size)
        System.arraycopy(payload, 0, slot.data, 0, n)
        slot.len = n
        slot.timestamp = timestamp
        slot.filled = true

        if (!primed && depth() >= targetFrames) {
            primed = true
            Log.d(TAG, "primed at ${depth()} frames (${targetFrames * codec.frameMs} ms)")
        }
    }

    /**
     * Hands out the frame due now, writing it into [out] and returning its
     * length. Called from the real-time playback thread.
     *
     * Returns 0 only when there is nothing to play and nothing to repeat —
     * before priming, or after a genuine underrun. The caller emits silence for
     * that slot.
     *
     * The play position advances on every call, including a concealed or
     * underrun one: playback runs on the media clock, so a missing frame
     * consumes its 20 ms rather than shifting everything after it.
     */
    @Synchronized
    fun read(out: ByteArray): Int {
        if (!primed) return 0

        val slot = slots[slotIndex(playTimestamp)]
        var result: Int

        if (slot.filled && slot.timestamp == playTimestamp) {
            result = minOf(slot.len, out.size)
            System.arraycopy(slot.data, 0, out, 0, result)
            // Remember it for the next gap.
            System.arraycopy(slot.data, 0, lastGood, 0, result)
            lastGoodLen = result
            slot.filled = false
            played.incrementAndGet()
        } else if (lastGoodLen > 0) {
            // Gap: repeat the previous frame.
            result = minOf(lastGoodLen, out.size)
            System.arraycopy(lastGood, 0, out, 0, result)
            concealed.incrementAndGet()
        } else {
            // Nothing yet, not even history.
            result = 0
            underrun.incrementAndGet()
        }

        playTimestamp += stride
        return result
    }

    /**
     * Maps a timestamp onto a slot. Adjacent frames land in adjacent slots and
     * the array wraps, so a frame arriving out of order still finds its place.
     */
    private fun slotIndex(timestamp: Int): Int {
        val frameNo = Math.floorDiv(timestamp, stride)
        return Math.floorMod(frameNo, capacityFrames)
    }

    /** Clears everything. Only safe while neither side is running. */
    @Synchronized
    fun reset() {
        slots.forEach { it.filled = false; it.len = 0 }
        playTimestamp = -1
        primed = false
        lastGoodLen = 0
        received.set(0); played.set(0); late.set(0); duplicate.set(0)
        concealed.set(0); underrun.set(0); overflow.set(0)
    }
}
