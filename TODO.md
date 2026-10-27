# TODO

## Calls

- [ ] **Caller-side "Join" banner in manual mode may be redundant.**
  `CallContext` still sets `needsManualJoin` on the *caller* when an outgoing
  manual-commencement call goes ACTIVE, and holds the user at a local Join banner.
  That logic predates sending the mode to the SDK. Now `startPrivateCall` passes
  `autoCommence = false` for manual mode, so the *callee's* phone really rings
  (Answer-Mode: Manual) and the caller already waits for that answer. Decide
  whether the caller-side banner should go (`onCallUpdated` → `next === 'active'`
  branch in `src/contexts/CallContext.tsx`).

- [ ] **Hardcoded English and colours left in `ActiveCallFullScreen`.** The floor
  part now comes from `i18n.ts` and `ThemePalette`; these were out of that scope:
  - the timer's `'Closed'` (`isClosing ? 'Closed' : …`) — needs `tr`/`en` entries
    (the `End Call` label now uses `tr.btnEndCall`);
  - the voice meter's `inactiveColor` (`rgba(255,255,255,0.1)` / `rgba(0,0,0,0.1)`),
    and the `isDark ? 'rgba(…)' : 'rgba(…)'` values throughout
    `features/calls/styles.ts` — these want palette tokens (a translucent
    border/overlay pair) rather than one-off literals.

## Bridge

- [ ] **`onLog` writes every SDK log line to logcat a second time, on the SDK thread.**
  `McSdkModule.onLog` does `Log.d("McSdkBridge", "onLog: level=… log=…")` before
  enqueuing the event. It runs on the SDK worker thread, ~450 times a second with
  the default params — the very cost the event pump exists to keep off that
  thread — and the same text is already in logcat under the `SDK` tag, so every
  line appears twice. Removing the `Log.d` (keeping the `emit`) halves logcat and
  frees the SDK thread. Measure the per-event time before and after, as was done
  for the pump.
