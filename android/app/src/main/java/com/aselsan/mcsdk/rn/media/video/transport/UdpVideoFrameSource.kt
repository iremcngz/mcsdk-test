package com.aselsan.mcsdk.rn.media.video.transport

import android.os.Process
import android.util.Log
import com.aselsan.mcsdk.rn.media.rtp.RtpPacket
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/**
 * UdpVideoFrameSource — receives RTP over UDP and hands on complete frames.
 *
 * The counterpart of [UdpVideoFrameSink]. As in UdpFrameSource, the blocking
 * receive() paces the thread, and the thread must not do anything slow: while it is
 * busy packets pile up in the kernel, and when that buffer overflows they vanish in
 * a way that looks just like network loss. So the buffer here is deep, because one
 * key frame arrives as a burst of dozens of packets, and the listener only copies.
 *
 * The peer's address is learned from what it sends, which is where a PLI goes back
 * to, on the port above this one: see [UdpVideoFrameSink].
 */
class UdpVideoFrameSource(private val localPort: Int) : VideoFrameSource {

    private companion object {
        const val TAG = "McSdkVideoUdpSource"
        const val RECEIVE_BUFFER_BYTES = 1024 * 1024
        const val MAX_DATAGRAM = 1500
    }

    override val name = "UDP"

    private val received = AtomicInteger(0)
    private val malformed = AtomicInteger(0)
    private val plis = AtomicInteger(0)

    private var socket: DatagramSocket? = null
    private var thread: Thread? = null
    private var depacketizer: H264RtpDepacketizer? = null
    private val ownSsrc = Random.nextInt().let { if (it == 0) 1 else it }

    @Volatile
    private var running = false

    @Volatile
    private var peer: InetAddress? = null

    @Volatile
    var lastError: String? = null
        private set

    /** Datagrams taken off the socket, valid or not. */
    val packetsReceived: Int get() = received.get()

    /** Datagrams that were not RTP. */
    val malformedPackets: Int get() = malformed.get()

    val packetsLost: Int get() = depacketizer?.packetsLost ?: 0
    val framesDelivered: Int get() = depacketizer?.framesDelivered ?: 0
    val framesDiscarded: Int get() = depacketizer?.framesDiscarded ?: 0

    /** PLIs sent to the peer. */
    val keyFramesRequested: Int get() = plis.get()

    override fun start(listener: VideoFrameSource.Listener): Boolean {
        lastError = null
        val sock = try {
            DatagramSocket(localPort)
        } catch (e: SocketException) {
            lastError = "cannot bind port $localPort: ${e.message}"
            Log.e(TAG, lastError!!)
            return false
        }
        try {
            sock.receiveBufferSize = RECEIVE_BUFFER_BYTES
        } catch (e: SocketException) {
            Log.w(TAG, "receiveBufferSize refused: ${e.message}")
        }
        socket = sock
        val parts = H264RtpDepacketizer(listener)
        depacketizer = parts
        running = true
        thread = Thread({ receiveLoop(sock, parts) }, "McSdkVideoUdpSource").apply { start() }
        // The OS can clamp the request, and a clamped buffer is the first suspect
        // when key frames arrive broken, so what it really gave is worth seeing.
        Log.d(TAG, "start: listening on :$localPort rcvbuf=${sock.receiveBufferSize}")
        return true
    }

    private fun receiveLoop(sock: DatagramSocket, parts: H264RtpDepacketizer) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val buf = ByteArray(MAX_DATAGRAM)
        val dg = DatagramPacket(buf, buf.size)
        val header = RtpPacket.Header()
        try {
            while (running) {
                dg.setData(buf, 0, buf.size)
                sock.receive(dg)
                received.incrementAndGet()
                peer = dg.address
                if (RtpPacket.parse(buf, dg.length, header)) {
                    parts.onPacket(header, buf)
                } else {
                    malformed.incrementAndGet()
                }
            }
        } catch (e: SocketException) {
            // stop() closed the socket, the only way to break a blocking receive.
            if (running) {
                lastError = "receive failed: ${e.message}"
                Log.e(TAG, lastError!!)
            }
        }
    }

    override fun requestKeyFrame(ssrc: Long) {
        val to = peer ?: return
        try {
            val pli = RtcpPli.write(ownSsrc, ssrc.toInt())
            // A socket of its own per request: they are about one a second at
            // worst, and receive() holds the main one.
            DatagramSocket().use { it.send(DatagramPacket(pli, pli.size, to, localPort + 1)) }
            plis.incrementAndGet()
        } catch (e: Exception) {
            Log.w(TAG, "PLI not sent: ${e.message}")
        }
    }

    override fun stop() {
        if (!running) return
        running = false
        socket?.close()
        thread?.join(1000)
        thread = null
        socket = null
        Log.d(TAG, "stop: packets=${received.get()} lost=$packetsLost frames=$framesDelivered " +
                   "discarded=$framesDiscarded plis=${plis.get()}")
    }
}
