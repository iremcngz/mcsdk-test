package com.aselsan.mcsdk.rn.media

import java.util.concurrent.atomic.AtomicInteger

/**
 * RingBuffer — single-producer/single-consumer byte queue with no locks.
 *
 * The capture thread has a hard 20 ms budget: AudioRecord's own buffer overflows
 * if it is not drained in time, and those samples are gone for good. Writing to
 * disk from that thread would blow the budget — a flush can stall for tens of
 * milliseconds. So capture hands frames over here and returns immediately, and a
 * separate thread does the slow work.
 *
 * Why no lock: with `synchronized`, the capture thread would block whenever the
 * writer happened to hold the monitor while waiting on the disk — reintroducing
 * exactly the stall the hand-off exists to avoid. Instead each side owns one
 * index and only ever reads the other's:
 *
 *   producer (capture): writes `head`, reads `tail`
 *   consumer (writer):  writes `tail`, reads `head`
 *
 * No field is written by both threads, so plain atomic loads and stores are
 * enough and neither side can ever wait on the other. The atomics are for
 * visibility across cores, not mutual exclusion.
 *
 * Correctness rests on there being exactly ONE producer and ONE consumer. Two
 * writers would corrupt `head` and the data silently; this class does not and
 * cannot detect that.
 *
 * One slot is always left empty so that `head == tail` means empty rather than
 * being ambiguous with full — hence usable capacity is `capacity - 1`.
 */
class RingBuffer(capacity: Int) {

    private val buf = ByteArray(capacity)
    private val cap = capacity

    /** Next index to write. Producer writes, consumer reads. */
    private val head = AtomicInteger(0)

    /** Next index to read. Consumer writes, producer reads. */
    private val tail = AtomicInteger(0)

    /** Bytes available to read right now. */
    fun available(): Int {
        val h = head.get()
        val t = tail.get()
        return if (h >= t) h - t else cap - t + h
    }

    /** Free bytes. One slot is reserved to disambiguate empty from full. */
    fun free(): Int = cap - 1 - available()

    fun isEmpty(): Boolean = head.get() == tail.get()

    /**
     * Appends [len] bytes from [data]. Producer thread only.
     *
     * Returns false and writes NOTHING when the data does not fit — a partial
     * frame would desynchronise the stream, so the frame is dropped whole. The
     * caller is expected to count those drops: a non-zero count is the signal
     * that the consumer cannot keep up (buffer too small, or disk too slow), and
     * silently swallowing it would hide the one failure this design is meant to
     * surface.
     *
     * Real-time safe: no allocation, no locks, no logging.
     */
    fun write(data: ByteArray, len: Int): Boolean {
        if (len <= 0) return true
        if (len > free()) return false

        val h = head.get()
        val firstChunk = minOf(len, cap - h)
        System.arraycopy(data, 0, buf, h, firstChunk)
        if (firstChunk < len) {
            // Wrapped: the rest goes at the start of the array.
            System.arraycopy(data, firstChunk, buf, 0, len - firstChunk)
        }
        // Published last: the consumer must never see an advanced head before
        // the bytes it points at are actually in place.
        head.set((h + len) % cap)
        return true
    }

    /**
     * Reads up to `out.size` bytes into [out], returning how many were copied
     * (0 when empty). Consumer thread only.
     */
    fun read(out: ByteArray): Int {
        val n = minOf(out.size, available())
        if (n == 0) return 0

        val t = tail.get()
        val firstChunk = minOf(n, cap - t)
        System.arraycopy(buf, t, out, 0, firstChunk)
        if (firstChunk < n) {
            System.arraycopy(buf, 0, out, firstChunk, n - firstChunk)
        }
        // Published last: frees the slots only once the bytes have been copied
        // out, so the producer cannot overwrite data still being read.
        tail.set((t + n) % cap)
        return n
    }

    /** Drops everything buffered. Only safe while neither thread is running. */
    fun clear() {
        head.set(0)
        tail.set(0)
    }
}
