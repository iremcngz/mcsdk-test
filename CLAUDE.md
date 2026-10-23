# testAAR — MCX SDK demo app

React Native 0.85 app (package `com.testaar`) that exercises the ASELSAN MCX SDK through a
TurboModule bridge. 

```
src/mcsdk/        TurboModule spec + friendly McSdk wrapper + shared types
src/contexts/     SdkContext (lifecycle/params/logs), TalkContext (groups/affiliation),
                  CallContext (calls/floor), AppContext, NavigationContext
src/features/     talk, calls, contacts, home, metrics, sdklogs, settings, auth,
                  audio (capture diagnostics)
android/app/src/main/java/com/aselsan/mcsdk/rn/McSdkModule.kt   the Kotlin bridge
android/.../rn/media/   the audio layer: capture, codec, ring buffer, sinks, session
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

Still open: `HomeScreen`'s log console maps every entry to its own `<Text>` inside a plain
`ScrollView` (no virtualisation), and the auto-scroll effect retriggers on every flush since
`sdk.logs` is a new array reference. Moving it to a `FlatList` is the remaining work.

While diagnosing the audio path, note that UI jank is still NOT evidence that the capture
threads are blocking — use the `droppedFrames` counter on the Audio tab, which measures the
real-time path directly.

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

- **Audio is not connected at all.** `selectCall`, `requestFloor`, `releaseFloor` and
  `muteMicrophone` exist in the SDK and the bridge but are called from nowhere in `src/`.
  Calls set up and tear down over SIP, but no media flows.
- `TalkScreen` push-to-talk is driven by fixed timeouts (`MOCK_CALL_SETUP_MS`,
  `MOCK_FLOOR_GRANT_MS`, `MOCK_AUTO_ACCEPT_MS`), not by real floor callbacks.
- The `VoiceMeter` shows the *local* microphone level, not anything on the wire.
- `CallContext.simulate*` helpers create purely local calls (no `sdkCallId`) for testing the
  UI offline. Real SDK calls carry `sdkCallId`; that field is what tells them apart.

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

