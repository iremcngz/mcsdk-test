package com.aselsan.mcsdk.rn.media.video.transport

import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

/**
 * UdpVideoFrameSink — sends encoded frames as RTP over UDP to a typed-in peer.
 *
 * What the SDK will do behind sendVideoFrame, for testing between two phones
 * before it can: no signalling, so the address comes from the screen, and no
 * permission to wait for.
 *
 * Packets go out inline on the encoder's thread, as UdpFrameSink's do on the
 * capture thread: send() copies into the kernel and returns in microseconds. The
 * difference is the burst. One key frame is dozens of packets at once, against one
 * for an audio frame, so the send buffer is several key frames deep; audio's 64 KB
 * would barely hold one.
 *
 * RTP leaves from an ephemeral port to the peer's [remotePort]. RTCP's PLI comes
 * back to the next port up on this side, which is why both phones use the same
 * port setting: there is no signalling to tell the peer anything else.
 */
class UdpVideoFrameSink(
    private val remoteHost: String,
    private val remotePort: Int,
) : VideoFrameSink {

    private companion object {
        const val TAG = "McSdkVideoUdpSink"
        const val SEND_BUFFER_BYTES = 256 * 1024
        const val MAX_RTCP = 64
    }

    override val name = "UDP"

    private val sent = AtomicInteger(0)
    private val errors = AtomicInteger(0)
    private val keyRequests = AtomicInteger(0)

    private var socket: DatagramSocket? = null
    private var rtcpSocket: DatagramSocket? = null
    private var rtcpThread: Thread? = null
    private var packetizer: H264RtpPacketizer? = null
    private var datagram: DatagramPacket? = null
    private var ssrc = 0

    @Volatile
    private var open = false

    @Volatile
    var lastError: String? = null
        private set

    /** Packets handed to the kernel. */
    val packetsSent: Int get() = sent.get()

    /** Packets send() refused. */
    val sendErrors: Int get() = errors.get()

    /** PLIs received from the peer. */
    val keyFramesRequested: Int get() = keyRequests.get()

    val target: String get() = "$remoteHost:$remotePort"

    override fun open(feedback: VideoFrameSink.Feedback) {
        lastError = null
        // Resolved here, never per frame: this can hit DNS and block.
        val address = InetAddress.getByName(remoteHost)

        val rtcp = try {
            DatagramSocket(remotePort + 1)
        } catch (e: SocketException) {
            throw SocketException("cannot bind RTCP port ${remotePort + 1}: ${e.message}")
        }
        rtcpSocket = rtcp

        val sock = DatagramSocket()
        try {
            sock.sendBufferSize = SEND_BUFFER_BYTES
        } catch (e: SocketException) {
            Log.w(TAG, "sendBufferSize refused: ${e.message}")
        }
        socket = sock

        ssrc = Random.nextInt().let { if (it == 0) 1 else it }
        val dg = DatagramPacket(ByteArray(0), 0, address, remotePort)
        datagram = dg
        packetizer = H264RtpPacketizer(ssrc, Random.nextInt(0x10000)) { packet, len ->
            sendPacket(sock, dg, packet, len)
        }
        open = true

        rtcpThread = Thread({ rtcpLoop(rtcp, feedback) }, "McSdkVideoRtcp").apply { start() }
        Log.d(TAG, "open: -> $target ssrc=${"%08x".format(ssrc)} sndbuf=${sock.sendBufferSize}")
    }

    override fun onFrame(data: ByteArray, len: Int, captureTimeUs: Long, keyFrame: Boolean) {
        if (!open) return
        packetizer?.packetize(data, len, captureTimeUs)
    }

    private fun sendPacket(sock: DatagramSocket, dg: DatagramPacket, packet: ByteArray, len: Int) {
        try {
            dg.setData(packet, 0, len)
            sock.send(dg)
            sent.incrementAndGet()
        } catch (e: Exception) {
            // Not retried: the sequence number has moved on, so the peer sees the
            // gap and asks for a key frame, which is the recovery that works.
            errors.incrementAndGet()
            lastError = "send failed: ${e.message}"
        }
    }

    private fun rtcpLoop(sock: DatagramSocket, feedback: VideoFrameSink.Feedback) {
        val buf = ByteArray(MAX_RTCP)
        val dg = DatagramPacket(buf, buf.size)
        try {
            while (open) {
                dg.setData(buf, 0, buf.size)
                sock.receive(dg)
                if (RtcpPli.parseMediaSsrc(buf, dg.length) == ssrc) {
                    keyRequests.incrementAndGet()
                    feedback.onKeyFrameRequested()
                }
            }
        } catch (e: SocketException) {
            // close() closed the socket, the only way to break a blocking receive.
            if (open) lastError = "RTCP receive failed: ${e.message}"
        }
    }

    override fun close() {
        if (!open && socket == null) return
        open = false
        rtcpSocket?.close()
        rtcpThread?.join(1000)
        rtcpThread = null
        rtcpSocket = null
        socket?.close()
        socket = null
        packetizer = null
        datagram = null
        Log.d(TAG, "close: packets=${sent.get()} errors=${errors.get()} plis=${keyRequests.get()}")
    }
}
