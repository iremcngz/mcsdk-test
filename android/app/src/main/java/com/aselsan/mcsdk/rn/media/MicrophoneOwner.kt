package com.aselsan.mcsdk.rn.media

import android.util.Log

/**
 * MicrophoneOwner — single arbiter for the one physical microphone.
 *
 * Two things want to capture: react-native-sound-level, which drives the
 * VoiceMeter bars, and (from the media phase on) AudioRecord feeding the
 * encoder. They cannot both hold the mic — whichever loses fails in a
 * device-dependent way, so the choice must not be left to timing.
 *
 * Ownership is therefore explicit and priority-ordered: MEDIA outranks METER.
 * A MEDIA claim evicts a METER holder; a METER claim while MEDIA holds is
 * refused. Callers react to the refusal rather than capturing anyway.
 *
 * Once the media pipeline is in place the VoiceMeter should read its level from
 * the PCM the encoder already captured (an RMS of the outgoing frames) instead
 * of opening a second capture path. That is both collision-free and a truer
 * meter: it shows what is actually going on the wire rather than what the local
 * mic hears. Until then METER keeps using sound-level, and this gate is what
 * makes the switch a one-line change instead of a rewrite of two screens.
 *
 * All methods are synchronized: claims arrive from the JS thread (screen
 * lifecycles) and from the media threads.
 */
object MicrophoneOwner {

    /** Who is asking. Declared in increasing priority. */
    enum class Claimant { METER, MEDIA }

    private const val TAG = "McSdkMic"

    private var holder: Claimant? = null

    /** Called when a claimant is evicted so it can tear its capture down. */
    private val onEvicted = mutableMapOf<Claimant, () -> Unit>()

    /**
     * Registers what to run if [claimant] is evicted. Set once per claimant;
     * the callback runs on the evicting caller's thread, so keep it to
     * stopping capture and flipping a flag.
     */
    @Synchronized
    fun setEvictionHandler(claimant: Claimant, handler: () -> Unit) {
        onEvicted[claimant] = handler
    }

    /**
     * Attempts to take the microphone. Returns false when a higher-priority
     * claimant holds it, in which case the caller must not open a capture.
     * Re-claiming while already holding it succeeds and changes nothing.
     */
    @Synchronized
    fun claim(claimant: Claimant): Boolean {
        val current = holder
        if (current == claimant) return true

        if (current != null && current.ordinal > claimant.ordinal) {
            Log.d(TAG, "claim refused: $claimant wanted the mic, $current holds it")
            return false
        }

        if (current != null) {
            Log.d(TAG, "evicting $current for $claimant")
            // Drop the lock expectation for the callback's own bookkeeping:
            // it only stops capture, it must not call back into claim().
            onEvicted[current]?.invoke()
        }

        holder = claimant
        Log.d(TAG, "mic held by $claimant")
        return true
    }

    /** Releases the microphone if [claimant] holds it. A no-op otherwise, so a
     *  claimant that was already evicted can still call this on teardown. */
    @Synchronized
    fun release(claimant: Claimant) {
        if (holder != claimant) return
        holder = null
        Log.d(TAG, "mic released by $claimant")
    }

    @Synchronized
    fun heldBy(): Claimant? = holder

    /** True when [claimant] may capture right now. */
    @Synchronized
    fun holds(claimant: Claimant): Boolean = holder == claimant
}
