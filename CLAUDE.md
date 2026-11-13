# MCX Test — MCX SDK demo app

React Native 0.85 app (package `com.mcxtest`) that exercises the ASELSAN MCX SDK through a
TurboModule bridge. 

```
src/mcsdk/        TurboModule spec + friendly McSdk wrapper + shared types
src/contexts/     SdkContext (lifecycle/params/logs), TalkContext (groups/affiliation),
                  CallContext (calls/floor), AppContext, NavigationContext
src/features/     talk, calls, contacts, home, metrics, logs (the app log console),
                  sdklogs, settings, auth, tools, audio (capture diagnostics)
android/app/src/main/java/com/aselsan/mcsdk/rn/McSdkModule.kt   the Kotlin bridge
android/.../rn/media/   the JS bridge and foreground service; subpackages below
  rtp/                  the RTP header, shared by the planes
  audio/                pipeline, capture, playback, routing, jitter buffer
  audio/codec/          AMR-WB, PCMU, the RTP payload framing
  audio/transport/      sinks and sources (file, UDP, SDK), CallAudioRouter
  video/                sender and receiver pipelines, camera, GL rotation
  video/codec/          MediaCodec H.264 encoder and decoder, key frames, playout delay
  video/transport/      VideoFrameSink/Source (the seam the SDK plugs into), UDP + RTP
  video/view/           the native view the decoder draws into
MCSDK/            git submodule: the C++ SDK source
```

## Commands

```bash
npx jest                 # all tests
npx tsc --noEmit         # typecheck (src/ must stay clean; __tests__ has pre-existing errors)
npx eslint src/…         # lint
cd android && ./gradlew :app:assembleRelease   # APK with the JS bundle embedded
```

`assembleRelease` is signed with the debug keystore, so it installs directly. Prefer it over
`assembleDebug`: the bundle is baked in, so the app runs **without Metro and without a USB
cable**. The trade-off is no hot reload — re-run the build after JS changes.

## The MCSDK submodule

**Never modify anything under `MCSDK/`.** It is a separate repository owned by the SDK team
and this app is only a consumer of it. Read it freely — to check an API, a threading rule or
why the server rejected a request — but do not edit its sources, and do not commit inside it.
Changing the submodule pointer is also off-limits unless explicitly asked.

If a fix belongs in the SDK, say so and describe the change; do not make it here. If a
workaround is possible on the app side, put it in the app (`src/` or the Kotlin bridge).
The one sanctioned write is rebuilding the AAR from an unmodified checkout, below.

### Read this before concluding "the SDK doesn't have X"

`MCSDK/` is a submodule, and the commit checked out in the worktree can lag `origin/main`.
A fetched-but-not-checked-out commit is invisible to `git log` without `--all`. If an API
looks missing:

```bash
cd MCSDK && git fetch --all && git log --oneline --all | head
```

Equally important: **the prebuilt `.aar` in `android/app/libs/` may predate the submodule
commit.** Check what the binary actually contains rather than trusting the source:

```bash
unzip -p android/app/libs/mc-sdk-android.aar classes.jar > /tmp/c.jar
unzip -l /tmp/c.jar | grep -i '<ClassName>'
cd /tmp && unzip -q c.jar && javap -classpath . com.aselsan.mcsdk.McSdk
```

### Rebuilding the AAR

```bash
cd MCSDK/platform/android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew :mc-sdk-android:assembleRelease      # needs local.properties with sdk.dir
```

Output: `build/outputs/aar/mc-sdk-android-universal-release.aar`. Requires NDK
`28.2.13676358` (declared in `mc-sdk-android/build.gradle`); the prebuilt OpenSSL/pjsip
archives are already committed under `MCSDK/extern/lib/`.

Copy the AAR to `android/app/libs/mc-sdk-android.aar` **and** extract its three `.so` files
to `android/app/src/main/jniLibs/<abi>/libmcsdk.so`. Both locations ship the same library;
keep them from the same build.

## SDK behaviour that bites

**The native SDK outlives the JS bridge.** `McSdkModule` keeps one `McSdk` for the whole
process ("C++ Sdk owns process-level singletons that cannot be re-initialised"). On a JS
reload the app restarts with empty state while the SDK keeps its own — so anything the SDK
emits *only on change* will never arrive. This is why the affiliated-group list can come up
empty even though the SDK holds a non-empty set (`Session::SetServiceAffiliations` returns
early when the projected view is unchanged).

**Listener callbacks are synchronous on the SDK worker thread** (see `MCSDK/CLAUDE.md`).
The C++ side blocks on the call until the listener returns, so whatever a callback does is
time the SDK cannot spend on its own work.

On Android that work is now handed off: `emit()` only puts the event on a bounded queue
(`ArrayBlockingQueue(4096)`) and returns, and a dedicated `McSdkEventPump` thread does the
`emitDeviceEvent` crossing. Measured ~1.3 ms per event before versus ~0.0006 ms after. The
`WritableMap` is still built on the SDK thread on purpose — moving it into the pump was
measured and made no difference, so the 18 call sites stay untouched.

The queue is bounded and `offer()` is used rather than `put()`: a full queue must never block
the SDK, so events are dropped and counted in `droppedEvents` (warned once per 100). Silently
swallowing them would read as "the SDK stopped emitting".

The pump also logs every event it hands to JS as one `McSdkBridge` line,
`event=<name> key=value …` (capped at 1000 chars), so logcat shows what the SDK actually told
the app — e.g. a termination's `mode`/`reason`, which the SDK's own lines do not print. It is
logged on the pump, never in `emit()`, to keep the cost off the SDK thread, and `McSdkLog` is
skipped (it is the ~450/s stream, and its text is already in logcat under the `SDK` tag).

The app logs the same events: `SdkContext` subscribes once through `McSdk.onAnyEvent`, and each
one goes to the Log Console and the file log with its whole payload (`src/mcsdk/listenerLog.ts`).
A new event only has to be added to `McSdkEvents` to be logged. They also have their own buffer,
behind **Listener only** on the console: at ~450 SDK lines/s the shared 5000-entry buffer
evicts an event in about 11 s. Three things stay out on purpose: `IdentityInfo.token` is a
credential (`hasToken` says whether there is one), document content goes to the file log only,
and `onAudioFrame` is never logged (~50/s on the media thread).

This mattered because RTP frames will share that thread once media lands — starving the
socket read loses packets, and in the jitter buffer that loss is indistinguishable from
network loss.

**iOS already behaves this way, but without the bound.** `McSdkModule.mm` wraps every emit in
`dispatch_async(dispatch_get_main_queue(), …)`, which was done because `sendEventWithName:` has
to run on the main thread — the side effect is that the SDK thread was never blocked there.
GCD's queue is unbounded, though, so a stalled JS side grows memory with no counter and no way
to notice. Worth mirroring the bound when the iOS media layer is written.

**The log pipeline loaded the UI thread — now batched, one part still open.**
Separate problem from the event pump above: the pump freed the *SDK* thread, this was the
*JS* thread. With the default params (`logLevel 0`, `pjLogLevel 0`, `rxTxEnabled true`) the
SDK emits ~450 events per second, and each one used to run two `setState` calls in
`SdkContext` (`logs` and `sdkLogs`), each copying the whole array — cost growing with length,
so O(n²) over a session — with no cap on either array. Measured on device:
`Choreographer: Skipped 57 frames` and `Davey! duration=1735ms`, repeatedly.

Entries now accumulate in a ref and move into state once per 250 ms (~900 state updates a
second become 8), and both arrays are capped at 5000 entries. Nothing is dropped: the console
trails real time by at most the flush interval. Teardown flushes before clearing the timer so
a batch queued in the last interval is not lost, and `clearLogs`/`clearSdkLogs` drop the
queue too — otherwise the next flush would refill a console that was just cleared.

**The file log is deliberately still per-event and uncapped.** `cache/logs/app-latest.log` is
where the full, untruncated SIP bodies are read from, and anything sitting in a batch would
be lost if the process died.

That remaining `FlatList` work is done. The full console is its own screen under
**Tools → Log Console** (`src/features/logs/`), with the **Listener only** filter beside an
**All logs** one; its `FlatList` follows the tail on `onContentSizeChange` rather than on
`sdk.logs`, which is a new array reference every flush.

**Home carries a small console of its own again**, under the registration progress bar, with
a **Clear**, the same **All logs** / **Listener only** filter as the Tools screen, and a row
linking to that screen. It shows the last 40 entries only (`HOME_LOG_TAIL` in
`HomeScreen.tsx`) and is a plain mapped `ScrollView` — which is exactly why it is capped:
mounting a `<Text>` per entry over the whole 5000-entry buffer is what drove the console off
Home in the first place. The tail is taken *after* the filter, so **Listener only** yields 40
events rather than however few survive in the last 40 entries of the mixed stream. Both
screens read the one `sdk.logs` buffer, so Home's **Clear** empties the Tools screen too.
Home answers "is anything happening" next to the progress bar; read a SIP body on the Tools
screen.

Its box is a `ScrollView` inside the page's own `ScrollView`, on the same axis, so two props
are load-bearing and neither is a default: `nestedScrollEnabled` (without it Android gives
the drag to the outer view and the box reads as frozen) and `onStartShouldSetResponder`
(which keeps a touch that began in the box from being handed up to the page). Following the
tail is also conditional — `logAtBottom`, a ref, is set from `onScroll` and gates the
`scrollToEnd` in `onContentSizeChange`. Unconditional following and reading back through the
history are exclusive: at ~450 lines/s a scroll up is undone within the next flush.

**The two log screens hold different streams, and no longer overlap.** The SDK's own `onLog`
stream goes to **SDK Logs** (`sdkLogs`, with its VERBOSE..FATAL levels) and to the file; the
Log Console holds what the *app* and the *listener* said (`logs`). `onLog` used to write into
both, which put each line in two places and — at ~450 events/s — buried the app's own lines
and the listener events under the SDK stream. `onAnyEvent` already excludes `McSdkEvents.Log`,
so the listener view was never affected.

While diagnosing the audio path, note that UI jank is still NOT evidence that the capture
threads are blocking — use the `droppedFrames` counter on the Audio tab, which measures the
real-time path directly.

**Contacts' group rows are the SDK's groups**, read off `TalkContext.groups`
(`onGroupsUpdated`) — the seven hardcoded `group1`..`group7` placeholders are gone. So that
list is empty until registration completes, which its empty state says. The screen opens on
**People**, people and groups are both sorted by name, and the logged-in user
(`AuthSettings.getLastUsername()`) is dropped from their own list — matched on the MC ID in
the stored URI and on the row's name, since a seed row is named after the user.

**Closing the app tears everything down, and `terminate()` aborts the process doing it.**
`McSdkModule.onHostDestroy()` runs when the Activity finishes (back button and a swipe from
recents; the home key only STOPs it, so the process stays cached and
`maybeReplayRegistration()` covers the way back). It terminates any active calls, calls
`Sdk::Terminate`, and ends the process — the C++ SDK owns process-level singletons that
cannot be re-initialised, so a clean slate means a real new process.

`terminate()` reliably raises `SIGABRT` on `os_core_unix.c:974 pj_thread_this()` —
*"Calling pjlib from unknown/external thread"* — because `nativeTerminate()` in
`McSdkJni.cpp` calls `gSdk->Terminate()` with no `pj_thread_register`. **This is an SDK-side
fix**, in that JNI entry; the app cannot do it, since `pj_thread_register` is not exposed
through the AAR. `RegistrationMachine::Terminate` is reached but the abort beats the REGISTER
Expires:0 out of the socket, so the registration is still left for the server to expire.

Two things make the abort survivable, and both are load-bearing:
- `endProcess()` is scheduled on a timer **before** `terminate()` is called, so the close
  finishes on its own schedule whether terminate aborts, hangs or returns.
- `MediaForegroundService.stop()` runs **before** `terminate()`, not only in `endProcess()`.
  The service is `START_STICKY`; dying while it is still started reads as a crashed service
  and the system restarts the process ~1 s later — leaving an Activity-less process with no
  SDK behind an ongoing notification. The abort lands ~2 ms in, well before the timer, so
  stopping it inside `endProcess()` alone is too late. Verified on both handsets: the process
  ends and stays ended.

**A doubled `onSdkError` during registration is usually two real failures.**
`BmsClient::Fetch` makes two independent HTTP requests — `ueinit` and `useradditions` — and
each reports its own `SdkError`, so an unreachable BMS raises `HTTP_UNREACHABLE` twice, a few
ms apart on the SDK worker thread. The bridge emits each one once (`McSdkBridge` logs both),
so the pair in the Log Console is the SDK being faithful, not the app double-logging. Check
the `HttpClient::Fetch … -> no response` lines before suspecting the event pump.

**`Sdk::Affiliate` is state-replacing, not a delta.** Pass the complete desired set on every
call; omitting an already-affiliated group de-affiliates it. Empty set → use `deaffiliate()`.

**`setIdentity` needs a non-empty client id** in `urn:uuid:<uuid>` form. An empty one makes
the server reject the registration PUBLISH with `400 … "Invalid Info XML"`, which surfaces
as a registration failure at ~75%. Handled by `DeviceIdentity.getMcClientId()`.

**`GroupInfo` flags mean two different things.** In `onGroupsUpdated` they mean "this service
supports the group"; in `onAffiliationsUpdated` they mean "the affiliation covers this
service". Same type, opposite reading — do not blur them.

## Tests

Any test that mounts `TalkContext` or `CallContext` reaches `SdkContext` → `NativeMcSdk` →
`TurboModuleRegistry.getEnforcing`, which throws under Jest. Two working patterns:

- Stub the context: `jest.mock('../src/contexts/SdkContext', () => ({ useSdkContext: () => ({ sdkRef: { current: mockSdk }, created: true }) }))` — see `talk.test.tsx`, `call-sdk-wiring.test.tsx`, `contacts.test.tsx`.
- Stub the module: `jest.mock('../src/mcsdk', …)` — see `App.test.tsx`, which also keeps a
  `makeSdkInstance()` factory that must gain any new SDK method the contexts subscribe to.

`__tests__/` has pre-existing typecheck errors unrelated to the app; only `src/` needs to
stay clean under `tsc`.

## What is still mock

Do not assume a screen is wired just because it renders convincingly.

- **Private-call audio is wired, but not yet verified on a call.** An active SDK call runs
  `MediaSession.startCallAudio` (CallContext): capture → AMR-WB → `SdkFrameSink` →
  `sendAudioFrame`, and `onAudioFrame` → `SdkFrameSource` → jitter buffer → playback, with
  `CallAudioRouter` joining McSdkModule and the pipeline natively — frames never touch JS.
  The uplink gate follows the floor and mute. Calls go out and are answered as
  `AMR_WB_OCTET_ALIGNED`, which `AmrWbRtpPayload` produces from MediaCodec's frames; if the
  server offers another framing the call is silent and `AUDIO_CODEC_UNSUPPORTED` is shown.
- **Group-call audio is wired the same way, also unverified.** Both contexts run it through
  `useCallAudio`; there is one pipeline, so one call is heard at a time: a private call
  with audio always wins, otherwise the group on the Talk screen if its call is up, else the
  latest group call to come up (`TalkContext.audioGroupId`). Group audio plays on the
  loudspeaker, the uplink opens only while PTT is held *and* the floor is granted, and the
  menu's mute silences that group's received audio (`setPlaybackMuted`) without leaving the
  call. A stop always names its call (`stopCallAudio(callId)`), so a late stop from a call
  that lost the pipeline cannot end the audio of the one that took it.
- `TalkScreen` group calls are the SDK's (`TalkContext.sdkGroupCalls`): Start/PTT place
  the call, PTT requests and releases the floor, End leaves, and the screen follows the
  callbacks. The mock panel (⚙️) only drives a simulated call on a
  group with no SDK call — an SDK call always takes precedence over it.
- **Sending a group's video is wired, not yet verified on a call.** Talk's Transmit opens
  `BroadcastScreen` with only the camera on; nothing reaches the server until its 🔴 button.
  That places an MCVideo call beside the group's MCPTT one (the SDK's calls carry one media
  plane each), then `requestTransmission`, and frames go out once it is `GRANTED`: capture →
  H.264 → `SdkVideoFrameSink` → `sendVideoFrame`. REC and its timer show `GRANTED`, not the
  press. The server's limit (30 s here) arrives as `REVOKED` with `MEDIA_BURST_TOO_LONG`: the
  view says so and goes back to STANDBY, the call staying up for the next press until the
  view closes or the server closes it. These calls stay out of `sdkGroupCalls`, which holds
  one call per group. The view's picture is drawn by `VideoRotator`, since an app can open a
  camera only once; so `BroadcastScreen` no longer uses VisionCamera. Still mock on that
  screen: its PTT button and the camera flip button.
- **An incoming group call is placed by a guess, until the SDK reports its group.** Its
  `groupId` is who started it (`sip:mcptt.<user>@…`, `CallMachine::OnInviteReceived`), so
  `incomingCallGroup` puts a call naming none of the user's groups under the group on the Talk
  screen, or else the first free affiliated one. Right with one group; with several, a call can
  show under the wrong one. Remove it when the SDK is fixed.
- **Receiving a group's video is wired, not yet verified on a call.** Talk's Receive opens
  `ReceiveScreen`; `useGroupVideoReceive` runs `VideoReceiver` on `SdkVideoFrameSource` for the
  group's MCVideo call while it is open, and when the server says the last transmitter finished
  (`TRANSMISSION_ENDED`) shows that briefly and goes back to Talk. One transmitter at a time (one decoder). Every phone
  asks for a transmitter as soon as it is AVAILABLE, whether watching or not, so frames arrive
  regardless (`McSdkBridge` `video received:`). The SDK has no video RTCP and reports no loss:
  `requestKeyFrame` does nothing, and after a loss the picture is damaged until the next
  periodic key frame.
- **Private video calls are wired, not yet verified on a call.** Contacts' **Video MC** /
  **Video AC** place an MCVideo private call (`startVideoPrivateCall`, MC rings, AC is
  answered by the far phone). It is **video only**: the SDK's MCVideo calls carry no audio.
  It has no transmission control (TS 24.281 §10.2.3), so `usePrivateVideoCall` (run by
  CallContext) sends the camera with `setCallTarget` as soon as the call is `ACTIVE`, with no
  `requestTransmission`, and shows the far end's frames with no `receiveMedia`. The caller's
  camera starts on; the called party's starts **off** until they turn it on. The call opens
  `VideoCallScreen` (also for an AC call the phone answered by itself). One camera and one
  decoder: while it is live, TalkContext closes the group's Transmit/Receive views and
  disables them. The local view is a media-overlay SurfaceView so its corner picture stays
  above the remote one.
- The `VoiceMeter` shows the *local* microphone level, not anything on the wire.
- The active-call **mute** and **speaker** buttons are real: mute closes the uplink gate,
  the speaker calls `MediaSession.setRoute` and is put back on the earpiece when the call
  ends.
- The `VoiceMeter` cannot get the microphone during a call (the pipeline outranks it), so it
  shows nothing there; it should read the capture's own level instead.
- `CallContext.simulate*` helpers create purely local calls (no `sdkCallId`) for testing the
  UI offline. Real SDK calls carry `sdkCallId`; that field is what tells them apart. The panel
  that drives them (`MockCallsPanel`) is a Tools screen — **Tools → Mock Calls**
  (`MockCallsScreen`) — not the bottom of the Calls tab, which shows call history alone.

## UI conventions

Colours come from `ThemePalette` (`src/core/theme.ts`) — never hardcode. Both light and dark
must work. All user-facing strings live in `src/core/i18n.ts` with `tr` and `en` entries.

## Running on a device

```bash
npm run device                      # build + install + launch on the phone
SKIP_BUILD=1 npm run device         # reinstall the last APK
DEVICE=<serial> npm run device      # force a specific device
```

`scripts/run-device.sh` discovers the handset itself (no hardcoded serial) and **skips
emulators on purpose** — the MCX server is only reachable from the real device's network.
Do not use `npx react-native run-android` here: it picks the first attached target, which
is usually the emulator, and it needs Metro over a USB tunnel.

Getting to a registered state: log in (`mcuser-111` / `12345678`) → **Home → Create** →
wait ~35 s for registration → Talk. Groups only arrive once registration completes.

## Logs

`adb logcat` carries the bridge's own lines (`McSdkBridge`) and SDK lines (`SDK`), but PJSIP
message bodies are truncated there. **The full SIP bodies appear in the app's own Log
Console (Home tab) and SDK Logs tab** — go there when diagnosing a malformed request.

Useful filters:

```bash
adb -s R58M66SC33Z logcat -s SDK:V McSdkBridge:V ReactNativeJS:V
adb -s R58M66SC33Z logcat -d | grep -oE "RegistrationMachine::[A-Za-z]+|registration failed|code: [0-9]+, ok: [a-z]+"
adb -s R58M66SC33Z logcat -d | grep -oE "event=McSdk[A-Za-z]+" | sort | uniq -c
adb -s R58M66SC33Z logcat -d -b crash | tail -40
```

