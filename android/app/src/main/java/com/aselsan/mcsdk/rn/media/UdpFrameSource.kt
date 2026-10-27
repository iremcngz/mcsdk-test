package com.aselsan.mcsdk.rn.media

import android.os.Process
import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.SocketException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * UdpFrameSource — receives RTP over UDP and hands the frames to the jitter
 * buffer.
 *
 * The counterpart of [UdpFrameSink], and the first source where the timestamps
 * come off the wire rather than being synthesised. [FileFrameSource] has to
 * count frames itself, because a file carries no timestamps — harmless there,
 * since a file loses nothing. On a network it would be wrong: five lost packets
 * would leave the counter five frames behind for the rest of the call, and the
 * jitter buffer would place everything after them in the wrong slot.
 *
 * Unlike the sink, this does need a thread of its own, and the reason is that
 * [DatagramSocket.receive] blocks until a packet arrives. That is wanted, not
 * tolerated: it makes the network the clock exactly as AudioRecord.read() makes
 * the microphone the clock on the way out, so there is no sleep anywhere and no
 * drift between a timer and the real packet rate. But it cannot happen on any
 * thread that has other work — least of all the playback thread, where a stall
 * empties AudioTrack's queue and the audio audibly breaks, which is the very
 * thing the jitter buffer exists to prevent.
 *
 * What this thread must NOT do is decode. While it is busy, receive() is not
 * being called and packets pile up in the kernel's receive buffer; if that
 * overflows the kernel drops them silently, and the loss is indistinguishable
 * from network loss — a fault of ours that reads as a fault of the network.
 * Parse, place, return.
 */
class UdpFrameSource(
    private val localPort: Int,
) : AudioFrameSource {

    companion object {
        private const val TAG = "McSdkUdpSource"

        /**
         * Generous on purpose: this is the slack that lets the receive thread be
         * descheduled for a few milliseconds without the kernel discarding
         * packets. ~900 AMR-WB packets.
         */
        private const val RECEIVE_BUFFER_BYTES = 64 * 1024

        /** Largest datagram accepted. Well past one RTP audio packet. */
        private const val MAX_DATAGRAM = 1500
    }

    override val name = "UDP"

    private val running = AtomicBoolean(false)
    private val delivered = AtomicInteger(0)
    private val received = AtomicInteger(0)
    private val malformed = AtomicInteger(0)
    private val lost = AtomicInteger(0)

    private var socket: DatagramSocket? = null
    private var thread: Thread? = null
    private var listener: AudioFrameSource.Listener? = null

    /** Last sequence number seen, for the loss count. -1 until the first packet. */
    private var lastSeq = -1

    /** SSRC of the stream being received, for diagnostics. */
    @Volatile
    private var remoteSsrc = 0

    @Volatile
    override var lastError: String? = null
        private set

    override val isRunning: Boolean get() = running.get()
    override val framesDelivered: Int get() = delivered.get()

    /** Datagrams taken off the socket, valid or not. */
    val packetsReceived: Int get() = received.get()

    /** Rejected by [RtpPacket.parse] — wrong version, too short, truncated. */
    val malformedPackets: Int get() = malformed.get()

    /**
     * Packets the sender produced that never arrived, counted from gaps in the
     * sequence number.
     *
     * This is what the RTP header buys that a bare timestamp cannot: a gap in
     * timestamps is ambiguous — it is either loss or the sender pausing, and
     * AudioCapture does pause while keeping the timestamp advancing. Sequence
     * numbers only advance when a packet is actually sent, so a gap in them is
     * loss and nothing else.
     */
    val lostPackets: Int get() = lost.get()

    val remoteSsrcValue: Int get() = remoteSsrc
    val port: Int get() = localPort

    override fun setListener(listener: AudioFrameSource.Listener) {
        this.listener = listener
    }

    override fun start(codec: AudioCodec): Boolean {
        if (running.get()) return true
        lastError = null

        if (listener == null) {
            lastError = "setListener() not called"
            Log.e(TAG, lastError!!)
            return false
        }

        val sock = try {
            DatagramSocket(localPort)
        } catch (e: Exception) {
            // Almost always the port already being in use — another instance of
            // this app, or the sink and source pointed at the same port.
            lastError = "cannot bind port $localPort: ${e.message}"
            Log.e(TAG, lastError!!)
            return false
        }
        try {
            sock.receiveBufferSize = RECEIVE_BUFFER_BYTES
        } catch (e: Exception) {
            Log.w(TAG, "receiveBufferSize refused: ${e.message}")
        }
        socket = sock

        delivered.set(0)
        received.set(0)
        malformed.set(0)
        lost.set(0)
        lastSeq = -1
        remoteSsrc = 0
        running.set(true)

        thread = Thread({ receiveLoop(codec) }, "McSdkUdpSource").apply { start() }
        Log.d(TAG, "start: listening on :$localPort codec=${codec.name} " +
                   "rcvbuf=${sock.receiveBufferSize}")
        return true
    }

    override fun stop() {
        if (!running.compareAndSet(true, false)) return
        // Closing the socket is what breaks the blocking receive() — there is no
        // other way to interrupt it, and interrupt() does not reach a thread
        // parked in a native socket read.
        try {
            socket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "socket close failed: ${e.message}")
        }
        thread?.join(1000)
        thread = null
        socket = null
        Log.d(TAG, "stop: received=${received.get()} delivered=${delivered.get()} " +
                   "malformed=${malformed.get()} lost=${lost.get()}")
    }

    private fun receiveLoop(codec: AudioCodec) {
        // AUDIO, not URGENT_AUDIO: nothing hardware-bound waits on this thread.
        // Being a few milliseconds late only means packets sit in the kernel's
        // buffer a little longer. The playback thread is the real-time one.
        // Set from inside the loop, since setThreadPriority() affects the
        // calling thread.
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)

        // Allocated once. Reused per packet for the same reason the sink reuses
        // its buffer: 50 short-lived objects a second is GC pressure on a path
        // that must not pause.
        val buf = ByteArray(MAX_DATAGRAM)
        val datagram = DatagramPacket(buf, buf.size)
        val header = RtpPacket.Header()
        val payload = ByteArray(codec.maxEncodedBytes)
        val sock = socket ?: return
        val out = listener ?: return

        try {
            while (running.get()) {
                // Blocks here until a packet arrives. This is what paces the
                // loop — the network is the clock, so there is no sleep.
                datagram.setData(buf, 0, buf.size)
                try {
                    sock.receive(datagram)
                } catch (e: SocketException) {
                    // stop() closed the socket. Expected, not an error.
                    if (!running.get()) break
                    throw e
                }
                received.incrementAndGet()

                if (!RtpPacket.parse(buf, datagram.length, header)) {
                    // Dropped whole: a header we cannot trust means a timestamp
                    // we cannot trust, and a fabricated one would put the frame
                    // in the wrong slot rather than simply missing one.
                    malformed.incrementAndGet()
                    continue
                }

                remoteSsrc = header.ssrc

                // Gaps mean loss. Unsigned 16-bit arithmetic so the wrap at
                // 65535 reads as +1 rather than a 65535-packet gap.
                if (lastSeq < 0) {
                    lastSeq = header.sequenceNumber
                } else {
                    val delta = (header.sequenceNumber - lastSeq) and 0xFFFF
                    when {
                        // Ahead of the highest we have seen: anything skipped is
                        // missing, at least for now.
                        delta in 1..0x7FFF -> {
                            if (delta >= 2) lost.addAndGet(delta - 1)
                            lastSeq = header.sequenceNumber
                        }
                        // delta 0 is a duplicate, and delta > 0x7FFF is a packet
                        // that arrived after its successor. Neither is loss, and
                        // in both cases lastSeq must stay where it is: tracking
                        // the *highest* sequence seen rather than the last one,
                        // or a reordered packet would pull it backwards and the
                        // gap it already accounted for would be counted twice.
                        // This is RTP's own extendedHighestSeq (RFC 3550 §6.4.1).
                        else -> Unit
                    }
                }

                val len = minOf(header.payloadLength, payload.size)
                if (len <= 0) {
                    malformed.incrementAndGet()
                    continue
                }
                System.arraycopy(buf, header.payloadOffset, payload, 0, len)

                // Straight to the jitter buffer with the timestamp from the
                // wire. No decode here, deliberately.
                out.onFrame(payload, len, header.timestamp)
                delivered.incrementAndGet()
            }
        } catch (e: Exception) {
            if (running.get()) {
                lastError = "receive failed: ${e.message}"
                Log.e(TAG, lastError!!, e)
            }
        } finally {
            running.set(false)
        }
    }
}
