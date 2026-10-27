package com.aselsan.mcsdk.rn.media

import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/**
 * UdpFrameSink — sends encoded frames as RTP over UDP to a manually configured
 * peer.
 *
 * Second destination for the capture path, after [FileFrameSink]. The file
 * proved capture and encode in isolation; this proves the timestamps, because
 * only a real network reorders, duplicates and loses frames, and only then does
 * the receiving jitter buffer have anything to do.
 *
 * There is no signalling: the peer's address and port are typed in. A real call
 * would learn them from the SDP offer/answer, which the SDK handles and this
 * test deliberately skips.
 *
 * Unlike [FileFrameSink] there is no ring buffer and no writer thread, and that
 * difference is the whole design:
 *
 *   - A disk write can stall for tens of milliseconds, which is why the file
 *     sink hands bytes to another thread and returns.
 *   - [DatagramSocket.send] copies into the kernel's send buffer and returns in
 *     microseconds, so the capture thread can do it inline.
 *
 * The SDK does the same thing — `RtpRtcpSession::SendRtp` calls
 * `rtpAgent.SendSync(...)` on the caller's thread — so this is also the
 * behaviour the app will have once the SDK's media API lands, rather than a
 * shortcut that gets replaced.
 *
 * The cost of that choice is honest: the capture thread is now exposed to the
 * network. If the kernel's buffer ever fills, `send` can block, and a stall
 * there costs captured samples. [sendErrors] is what makes that visible, and a
 * larger SO_SNDBUF is what makes it unlikely.
 */
class UdpFrameSink(
    private val remoteHost: String,
    private val remotePort: Int,
) : AudioFrameSink {

    companion object {
        private const val TAG = "McSdkUdpSink"

        /**
         * ~900 packets of AMR-WB. Sized so an ordinary network hiccup drains
         * into the kernel rather than reaching the capture thread as a block.
         */
        private const val SEND_BUFFER_BYTES = 64 * 1024
    }

    override val name = "UDP"

    private val running = AtomicBoolean(false)
    private val dropped = AtomicInteger(0)
    private val sent = AtomicInteger(0)
    private val errors = AtomicInteger(0)

    private var socket: DatagramSocket? = null
    private var address: InetAddress? = null

    /**
     * Allocated once in [open] and rewritten per frame. A per-frame ByteArray
     * would be 50 short-lived objects a second on the capture thread, and a GC
     * pause there overruns AudioRecord's buffer and loses samples for good.
     */
    private var packetBuf: ByteArray = ByteArray(0)
    private var datagram: DatagramPacket? = null

    /** Incremented per packet, wrapped to 16 bits — what the SDK does for us. */
    private var sequenceNumber = 0

    /** Fixed for the life of the stream, as RFC 3550 §8.1 requires. */
    private var ssrc = 0

    @Volatile
    var lastError: String? = null
        private set

    override val droppedFrames: Int get() = dropped.get()

    /** Packets handed to the kernel. Compare with the peer's receivedFrames. */
    val framesSent: Int get() = sent.get()

    /** send() threw — the frame was abandoned rather than retried. */
    val sendErrors: Int get() = errors.get()

    val ssrcValue: Int get() = ssrc
    val target: String get() = "$remoteHost:$remotePort"

    override fun open(codec: AudioCodec) {
        if (running.get()) return
        lastError = null
        dropped.set(0)
        sent.set(0)
        errors.set(0)

        // Resolved here, never per frame: getByName may hit DNS and block, which
        // is fine on the controlling thread and unacceptable on the capture one.
        // Rethrown with the host in the message — "unable to resolve host" alone
        // does not say which address was typed wrong.
        address = try {
            InetAddress.getByName(remoteHost)
        } catch (e: Exception) {
            lastError = "cannot resolve '$remoteHost': ${e.message}"
            Log.e(TAG, lastError!!)
            throw e
        }

        val sock = DatagramSocket()
        try {
            sock.sendBufferSize = SEND_BUFFER_BYTES
        } catch (e: Exception) {
            // Advisory only — the OS may clamp or refuse it. Not worth failing
            // the whole sink over.
            Log.w(TAG, "sendBufferSize refused: ${e.message}")
        }
        socket = sock

        // Random, non-zero, and fixed from here on. A receiver tells streams
        // apart by SSRC, so it must not change mid-stream.
        ssrc = Random.nextInt().let { if (it == 0) 1 else it }
        // Starts at a random point rather than 0, as RFC 3550 §5.1 asks, so the
        // stream is not trivially predictable.
        sequenceNumber = Random.nextInt(0x10000)

        packetBuf = ByteArray(RtpPacket.HEADER_BYTES + codec.maxEncodedBytes)
        datagram = DatagramPacket(packetBuf, packetBuf.size, address, remotePort)

        running.set(true)
        Log.d(TAG, "open: -> $remoteHost:$remotePort codec=${codec.name} " +
                   "ssrc=${"%08x".format(ssrc)} firstSeq=$sequenceNumber " +
                   "sndbuf=${sock.sendBufferSize}")
    }

    /**
     * Capture thread. Builds the packet in place and sends it inline.
     *
     * No logging on this path: a broken network would otherwise produce 50 lines
     * a second, which slows the very thread the budget belongs to. The counters
     * carry the diagnosis instead.
     */
    override fun onFrame(payload: ByteArray, len: Int, timestamp: Int, marker: Boolean) {
        if (!running.get()) return

        val n = RtpPacket.write(
            out = packetBuf,
            payload = payload,
            len = len,
            timestamp = timestamp,
            sequenceNumber = sequenceNumber,
            ssrc = ssrc,
            marker = marker,
        )
        if (n < 0) {
            // Frame larger than the buffer sized from codec.maxEncodedBytes —
            // dropped whole, since a truncated packet would read as a valid
            // frame of the wrong length at the far end.
            dropped.incrementAndGet()
            return
        }

        // Advanced even if the send below fails: the sequence number counts what
        // was produced, so a gap is exactly how the receiver learns a packet was
        // lost. Re-using it would hide the loss.
        sequenceNumber = (sequenceNumber + 1) and 0xFFFF

        val dg = datagram ?: return
        try {
            dg.setData(packetBuf, 0, n)
            socket?.send(dg)
            sent.incrementAndGet()
        } catch (e: Exception) {
            // Abandoned, not retried: by the time a resend arrived its moment to
            // be played would have passed, and blocking here would cost the
            // frames that come after it too.
            errors.incrementAndGet()
            lastError = "send failed: ${e.message}"
        }
    }

    override fun close() {
        if (!running.compareAndSet(true, false)) return
        try {
            socket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "close failed: ${e.message}")
        }
        socket = null
        datagram = null
        Log.d(TAG, "close: sent=${sent.get()} dropped=${dropped.get()} " +
                   "errors=${errors.get()} lastSeq=$sequenceNumber")
    }
}
