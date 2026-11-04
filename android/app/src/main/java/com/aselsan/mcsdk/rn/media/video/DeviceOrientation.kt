package com.aselsan.mcsdk.rn.media.video

import android.content.Context
import android.view.OrientationEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * How the phone is being held, read from its accelerometer. The display's rotation
 * would not do: the screen may be locked to portrait while the phone films sideways.
 *
 * 0 is upright, 90 has its left side up, 180 is upside down, 270 has its right side
 * up. A phone lying flat reports nothing, so it keeps the last value, 0 to begin with.
 */
class DeviceOrientation(context: Context) {

    private companion object {
        /** A first reading usually takes under this. A phone lying flat never gives one. */
        const val FIRST_READING_WAIT_MS = 400L
    }

    @Volatile
    var angle = 0
        private set

    private var firstReading = CountDownLatch(1)

    private val listener = object : OrientationEventListener(context) {
        override fun onOrientationChanged(orientation: Int) {
            if (orientation == ORIENTATION_UNKNOWN) return
            angle = VideoRotation.snap(orientation, angle)
            firstReading.countDown()
        }
    }

    /** Begins listening, waiting briefly so the first frame's shape is right. Blocks. */
    fun start() {
        angle = 0
        firstReading = CountDownLatch(1)
        if (!listener.canDetectOrientation()) return
        listener.enable()
        firstReading.await(FIRST_READING_WAIT_MS, TimeUnit.MILLISECONDS)
    }

    fun stop() {
        listener.disable()
    }
}
