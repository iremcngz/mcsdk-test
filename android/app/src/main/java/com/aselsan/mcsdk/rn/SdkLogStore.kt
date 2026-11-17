package com.aselsan.mcsdk.rn

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Where the SDK's own log stream lives: a process-level ring buffer the SDK Logs
 * screen reads from, and a writer thread that puts every line in the file log.
 *
 * Why this exists. With the default params (logLevel 0, pjLogLevel 0, rxTxEnabled
 * true) the SDK emits ~450 log lines a second, and every one of them used to be
 * pushed to JS as a `McSdkLog` event: a bridge crossing in, a handler run on the
 * JS thread (two Date objects, a string, a push into a buffer), and a second
 * bridge crossing back out to the file logger. ~900 crossings and 450 handler
 * runs a second, whether or not anybody was looking at the logs — and the JS
 * thread is also where every touch is handled, so taps queued behind that work
 * and the app read as frozen. Measured on an SM-A205F: 98% of all events
 * reaching JS were VERBOSE and DEBUG log lines.
 *
 * Now nothing per line reaches JS. [append] runs on the SDK thread and does two
 * cheap things: puts the line in the ring and offers it to the writer queue.
 * The SDK Logs screen *pulls* with [since] while it is open — a few hundred
 * lines in one crossing, twice a second — and costs nothing while it is closed.
 * Every line is still kept and still shown; only the route to the screen changed.
 *
 * The ring is an `object`, so it lives as long as the process does — like the
 * registration state in McSdkModule's companion. A JS reload therefore comes
 * back to the full history rather than an empty screen.
 *
 * The file. Lines go to the same `app-latest.log` the app's own logger writes,
 * with the same `[time] [LEVEL] [APP] [SDK/NAME]` prefix the JS path used to
 * produce, so the file is indistinguishable from before and the app and SDK
 * lines stay interleaved in one timeline. It works because react-native-file-
 * logger attaches its RollingFileAppender to the *root* logger of the
 * process-wide logback context (the app resolves slf4j-api 1.7.x, so
 * `LoggerFactory` hands out that context), which an ordinary slf4j logger from
 * here reaches too. Size limit and rotation are therefore the appender's own,
 * configured once from JS; nothing is duplicated here.
 *
 * Threads. The ring is guarded by one lock held for an append or a copy — the
 * SDK calls [append] from more than one of its threads (Logger.h keeps a
 * thread-local re-entrancy guard, which only makes sense with several). The
 * file write is logback's and takes a lock of its own, so it is kept off the
 * SDK thread entirely: the writer thread drains a bounded queue, and the queue
 * is offered to rather than put to — a full queue must never block the SDK,
 * the same rule the event pump follows. Dropped lines are counted and reported,
 * never silently swallowed.
 */
object SdkLogStore {

    private const val TAG = "McSdkBridge"

    /** How many lines the ring keeps. 5000 is what the JS buffer held. */
    const val MAX_ENTRIES = 5000

    /**
     * A line longer than this is cut in the ring (the file keeps the whole text).
     * SIP bodies run to several KB; a few of those at 5000 lines is fine, but a
     * pathological one must not be able to take the ring's memory by itself.
     */
    private const val MAX_RING_CHARS = 16 * 1024

    /** Room for ~18 s of the default stream while logback is busy rolling a file. */
    private const val FILE_QUEUE_CAPACITY = 8192

    /**
     * Lines kept while no file appender is attached yet. FileLogger.configure()
     * runs from JS at startup; the SDK is created after it, so this is only ever
     * a short window — but a line produced in it should not be lost.
     */
    private const val PENDING_CAPACITY = 2000

    /** The name react-native-file-logger gives its appender (FileLoggerModule.APPENDER_NAME). */
    private const val FILE_APPENDER_NAME = "FileLoggerAppender"

    private const val WARN_EVERY_DROPPED = 100

    /** One log line. `level` is the SDK's LogLevel ordinal: VERBOSE 0 .. FATAL 5. */
    class Entry(val seq: Long, val timeMs: Long, val level: Int, val msg: String)

    /** What [since] hands back. */
    class Batch(
        /** Oldest first. */
        val entries: List<Entry>,
        /** The newest seq in the ring, filter or not; pass it back as `sinceSeq`. -1 while empty. */
        val latestSeq: Long,
        /** Lines in the ring now. */
        val total: Int,
        /** Matching lines newer than `sinceSeq` that did not fit in `max` (the oldest of them). */
        val skipped: Int,
        /** Lines newer than `sinceSeq` that left the ring before this call — the caller fell behind. */
        val evicted: Int,
        /** Lines that never reached the file because the writer queue was full. */
        val fileDropped: Int,
    )

    private val lock = Any()
    private val ring = ArrayDeque<Entry>(MAX_ENTRIES)
    private var nextSeq = 0L

    private val fileQueue = ArrayBlockingQueue<Entry>(FILE_QUEUE_CAPACITY)
    private val fileDropped = AtomicInteger(0)
    @Volatile private var writer: Thread? = null

    /** Called from the SDK's threads. Enqueues and returns. */
    fun append(level: Int, msg: String) {
        val now = System.currentTimeMillis()
        val full: Entry
        synchronized(lock) {
            val seq = nextSeq++
            full = Entry(seq, now, level, msg)
            if (ring.size >= MAX_ENTRIES) ring.removeFirst()
            ring.addLast(if (msg.length <= MAX_RING_CHARS) full else Entry(
                seq, now, level,
                msg.substring(0, MAX_RING_CHARS) +
                    "… [+${msg.length - MAX_RING_CHARS} chars, full text in the file log]",
            ))
        }
        ensureWriter()
        if (!fileQueue.offer(full)) {
            val n = fileDropped.incrementAndGet()
            if (n % WARN_EVERY_DROPPED == 1) {
                Log.w(TAG, "SDK log file queue full, dropped $n line(s) — the file writer is not keeping up")
            }
        }
    }

    /**
     * The lines newer than [sinceSeq] (exclusive; pass -1 for the tail) at
     * [minLevel] or above, the newest [max] of them in chronological order.
     *
     * Scans from the newest end and stops once [max] are collected, so a poll
     * that finds a handful of new lines costs a handful of steps however full
     * the ring is; the remaining matches are only counted.
     */
    fun since(sinceSeq: Long, max: Int, minLevel: Int): Batch {
        val picked = ArrayList<Entry>(minOf(max, 512))
        var skipped = 0
        val total: Int
        val latestSeq: Long
        val oldestSeq: Long
        synchronized(lock) {
            total = ring.size
            latestSeq = ring.lastOrNull()?.seq ?: -1L
            oldestSeq = ring.firstOrNull()?.seq ?: nextSeq
            val it = ring.listIterator(ring.size)
            while (it.hasPrevious()) {
                val e = it.previous()
                if (e.seq <= sinceSeq) break
                if (e.level < minLevel) continue
                if (picked.size < max) picked.add(e) else skipped++
            }
        }
        picked.reverse()
        // The caller last saw sinceSeq; anything between it and the ring's oldest
        // line is gone for good. Only meaningful for a caller that has seen something.
        val evicted = if (sinceSeq >= 0 && oldestSeq > sinceSeq + 1) (oldestSeq - sinceSeq - 1).toInt() else 0
        return Batch(picked, latestSeq, total, skipped, evicted, fileDropped.get())
    }

    /** Empties the ring. The file is left alone: it is the record, the ring is the view. */
    fun clear() {
        synchronized(lock) { ring.clear() }
    }

    fun count(): Int = synchronized(lock) { ring.size }

    // ── File writer ───────────────────────────────────────────────────────────

    private fun ensureWriter() {
        if (writer != null) return
        synchronized(lock) {
            if (writer != null) return
            writer = Thread(::writerLoop, "McSdkLogWriter").apply {
                isDaemon = true
                // Below normal: the file must not compete with the media threads,
                // and a line arriving in the file a moment late costs nothing.
                priority = Thread.NORM_PRIORITY - 1
                start()
            }
        }
    }

    private fun writerLoop() {
        val log = org.slf4j.LoggerFactory.getLogger("McSdkLog")
        // The JS path wrote `new Date().toISOString()` with the T and Z removed:
        // UTC, millisecond precision. Same here, so the file does not change.
        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val pending = ArrayDeque<Entry>()
        while (true) {
            val e = try {
                fileQueue.poll(500, TimeUnit.MILLISECONDS)
            } catch (ie: InterruptedException) {
                return
            }
            if (!fileAppenderAttached()) {
                if (e != null) {
                    if (pending.size >= PENDING_CAPACITY) pending.removeFirst()
                    pending.addLast(e)
                }
                continue
            }
            while (pending.isNotEmpty()) write(log, stamp, pending.removeFirst())
            if (e != null) write(log, stamp, e)
        }
    }

    /**
     * Whether react-native-file-logger has attached its appender yet. Without it
     * the root logger has nowhere to write and the line would simply vanish.
     */
    private fun fileAppenderAttached(): Boolean {
        val ctx = org.slf4j.LoggerFactory.getILoggerFactory()
            as? ch.qos.logback.classic.LoggerContext ?: return false
        return ctx.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME).getAppender(FILE_APPENDER_NAME) != null
    }

    /**
     * One line, in the format the JS path produced:
     *   [2026-11-17 12:34:56.789] [DEBUG] [APP] [SDK/VERBOSE] <msg>
     * The `[APP]` is the app logger's own prefix, which every line through it
     * carried — kept so a reader of the file sees no seam where the writer changed.
     */
    private fun write(log: org.slf4j.Logger, stamp: SimpleDateFormat, e: Entry) {
        val name = LEVEL_NAMES.getOrElse(e.level) { e.level.toString() }
        val text = "[${stamp.format(Date(e.timeMs))}] [${fileLevelLabel(e.level)}] [APP] [SDK/$name] ${e.msg}"
        try {
            when {
                e.level <= 1 -> log.debug(text)
                e.level == 2 -> log.info(text)
                e.level == 3 -> log.warn(text)
                else         -> log.error(text)
            }
        } catch (t: Throwable) {
            // A failing appender (disk full, file rolled away) must not kill the writer.
            Log.w(TAG, "SDK log file write failed: ${t.message}")
        }
    }

    private val LEVEL_NAMES = arrayOf("VERBOSE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL")

    /** The app logger's label column, padded to five as it always was. */
    private fun fileLevelLabel(level: Int): String = when {
        level <= 1 -> "DEBUG"
        level == 2 -> "INFO "
        level == 3 -> "WARN "
        else       -> "ERROR"
    }
}
