# testAAR — MCSDK React Native Integration

> A React Native application demonstrating the full-stack integration of the **MCSDK** C++ core library into iOS and Android via the New Architecture (TurboModule) using shared native libraries (`.so` / `.xcframework`).

---

## Table of Contents

1. [Overview](#1-overview)
2. [AAR → .so Extraction](#2-aar--so-extraction)
3. [Is the MCSDK Source Folder Required?](#3-is-the-mcsdk-source-folder-required)
4. [Architecture](#4-architecture)
5. [Layer-by-Layer Technical Analysis](#5-layer-by-layer-technical-analysis)
   - [5.1 C++ Core (libmcsdk.so)](#51-c-core-libmcsdkso)
   - [5.2 JNI Bridge](#52-jni-bridge)
   - [5.3 Java JNI Wrapper (McSdk.java)](#53-java-jni-wrapper-mcsdkjava)
   - [5.4 Kotlin TurboModule (McSdkModule.kt)](#54-kotlin-turbomodule-mcsdkmodulekt)
   - [5.5 TypeScript TurboModule Spec (NativeMcSdk.ts)](#55-typescript-turbomodule-spec-nativemcsdkts)
   - [5.6 TypeScript User API (McSdk class)](#56-typescript-user-api-mcsdk-class)
   - [5.7 React Native UI Layer (App.tsx)](#57-react-native-ui-layer-apptsx)
6. [Data Flow Diagrams](#6-data-flow-diagrams)
7. [Singleton Constraint & Lifecycle Management](#7-singleton-constraint--lifecycle-management)
8. [Project Structure](#8-project-structure)
9. [Build & Run](#9-build--run)

---

## 1. Overview

| Property | Value |
|---|---|
| React Native | 0.85.0 |
| React | 19.2.3 |
| Architecture | New Architecture (TurboModule, JSI) |
| JS Engine | Hermes |
| Android ABI targets | `arm64-v8a`, `armeabi-v7a`, `x86_64` |
| Native core | `libmcsdk.so` — statically linked C++ (pjsip, OpenSSL, cpp-httplib) |

The integration avoids the AAR as a Gradle dependency. Instead, the pre-built `.so` shared libraries are extracted from the AAR and placed in `jniLibs/`, while the Java JNI wrapper sources are copied directly into the project. This approach enables full source-level control over the bridge layer and eliminates transitive AAR dependency issues.

---

## 2. AAR → .so Extraction

An Android Archive (`.aar`) is a ZIP archive. The following commands extract the native libraries and place them where the Android Gradle Plugin will auto-package them into the APK.

```bash
# Step 1 — Copy the AAR as a ZIP archive
mkdir -p /tmp/aar-extract
cp android/app/libs/mc-sdk-android.aar /tmp/aar-extract/mc-sdk-android.zip

# Step 2 — Extract the archive
cd /tmp/aar-extract
unzip -o mc-sdk-android.zip -d aar-contents
# Resulting layout:
#   aar-contents/
#     classes.jar                        ← Java sources (provided separately in this project)
#     jni/arm64-v8a/libmcsdk.so
#     jni/armeabi-v7a/libmcsdk.so
#     jni/x86_64/libmcsdk.so
#     AndroidManifest.xml
#     proguard.txt

# Step 3 — Create jniLibs target directories
cd /path/to/testAAR
mkdir -p android/app/src/main/jniLibs/arm64-v8a
mkdir -p android/app/src/main/jniLibs/armeabi-v7a
mkdir -p android/app/src/main/jniLibs/x86_64

# Step 4 — Copy the shared libraries
cp /tmp/aar-extract/aar-contents/jni/arm64-v8a/libmcsdk.so   android/app/src/main/jniLibs/arm64-v8a/
cp /tmp/aar-extract/aar-contents/jni/armeabi-v7a/libmcsdk.so android/app/src/main/jniLibs/armeabi-v7a/
cp /tmp/aar-extract/aar-contents/jni/x86_64/libmcsdk.so      android/app/src/main/jniLibs/x86_64/
```

The Android Gradle Plugin automatically packages every `.so` file found under `jniLibs/` into the APK — no CMake or `ndk-build` configuration is required.

> **Why remove the AAR from `build.gradle`?**
> Once the `.so` files are in `jniLibs/` and the Java sources are added directly to the project,
> the AAR provides no additional value and would cause duplicate class errors.
> The `implementation files('libs/mc-sdk-android.aar')` line and the corresponding `flatDir`
> block have been removed from `android/app/build.gradle`.

---

## 3. Is the MCSDK Source Folder Required?

**Short answer: No — neither at runtime nor at build time.**

The `MCSDK/` directory contains the SDK's full source tree (C++ core, platform bridges, example apps). This project neither compiles from that source nor references it as a build input.

| Source | Usage in this project | Status |
|---|---|---|
| `MCSDK/core/*.cpp/.h` | C++ core source | **Not required** — compiled into `libmcsdk.so` |
| `MCSDK/platform/android/.../java/` | Java JNI wrapper | **Copied** to `android/app/src/main/java/com/aselsan/mcsdk/` |
| `MCSDK/platform/react-native/android/` | Kotlin TurboModule | **Copied & adapted** to `…/mcsdk/rn/` |
| `MCSDK/platform/react-native/src/` | TypeScript bridge | **Copied** to `src/mcsdk/` |
| `MCSDK/platform/react-native/ios/` | iOS ObjC++ bridge | Ready for future iOS integration |
| `MCSDK/dep/`, `MCSDK/extern/` | pjsip, OpenSSL, etc. | **Not required** — statically linked into `libmcsdk.so` |

`libmcsdk.so` is a single self-contained shared library that statically embeds:

- C++ core (`Sdk`, `SipAgent`, `HttpAgent`, all modules)
- **pjsip** — SIP stack
- **OpenSSL** — TLS / cryptography
- **cpp-httplib** — HTTP server
- **tinyxml2**, **prometheus-cpp-core**, **nlohmann/json**, **fmt**

The `MCSDK/` folder is retained solely as a source reference and to support the future iOS integration (ObjC++ bridge + XCFramework).

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        React Native (JavaScript)                      │
│                                                                      │
│  App.tsx                                                             │
│    └─▶ McSdk class          src/mcsdk/index.ts   ← User-facing API  │
│          └─▶ NativeMcSdk    src/mcsdk/NativeMcSdk.ts  ← Codegen spec│
│                └─▶ TurboModuleRegistry.getEnforcing('McSdk')         │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  JSI  (synchronous, no bridge serialization)
                              │  React Native New Architecture
┌─────────────────────────────▼────────────────────────────────────────┐
│                     Android Native  (Kotlin / Java)                   │
│                                                                      │
│  McSdkPackage.kt                                                     │
│    └─▶ McSdkModule.kt    ReactContextBaseJavaModule                  │
│          └─▶ McSdk.java  Java JNI wrapper                            │
│                │  System.loadLibrary("mcsdk")                        │
│                └─▶ JNI symbols: Java_com_aselsan_mcsdk_McSdk_*       │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  JNI  (Java Native Interface)
┌─────────────────────────────▼────────────────────────────────────────┐
│                       libmcsdk.so  (C++)                              │
│                                                                      │
│  McSdkJni.cpp  ← JNI export functions                                │
│    ├─ gSdk          : unique_ptr<Sdk>        process-level instance  │
│    ├─ JniSdkListener    : SdkListener    ──┐                         │
│    ├─ JniAlarmListener  : AlarmListener  ──┼─ C++ → Java callbacks  │
│    └─ JniLogListener    : LogListener    ──┘                         │
│                                                                      │
│  Sdk.cpp  ← Core orchestrator                                        │
│    ├─ SipAgent::Get()    Meyers singleton  (pjsip SIP stack)         │
│    ├─ HttpAgent::Get()   Meyers singleton  (cpp-httplib HTTP server) │
│    ├─ AlarmModule::Get()                                             │
│    ├─ MetricModule::Get()                                            │
│    ├─ MessageModule::Get()                                           │
│    └─ Dao::Get()                                                     │
│                                                                      │
│  Static dependencies (embedded):                                     │
│    pjsip · OpenSSL · tinyxml2 · prometheus-cpp · nlohmann/json · fmt │
└──────────────────────────────────────────────────────────────────────┘
```

### iOS (Active)

The TypeScript layer is identical on both platforms. The native bridge uses an XCFramework (pre-built static library) instead of a `.so` shared library:

```
┌──────────────────────────────────────────────────────────────────────┐
│                        React Native (JavaScript)                      │
│  (identical to Android — same NativeMcSdk.ts Codegen spec)           │
│                                                                      │
│  App.tsx → McSdk (index.ts) → NativeMcSdk.ts                        │
│              └─▶ TurboModuleRegistry.getEnforcing('McSdk')           │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  JSI (synchronous, no bridge serialization)
┌─────────────────────────────▼────────────────────────────────────────┐
│                     iOS Native  (ObjC++)                              │
│                                                                      │
│  McSdkBridge.podspec                                                 │
│    └─▶ McSdkModule.mm  RCTEventEmitter <RCTBridgeModule>             │
│          ├─ RCT_EXPORT_MODULE(McSdk)                                 │
│          ├─ RCT_EXPORT_METHOD(setParams:(NSString*)paramsJson)       │
│          ├─ RCT_EXPORT_METHOD(init:resolve:reject:)  ← async        │
│          ├─ <McSdkListener>  protocol conformance                    │
│          ├─ <McSdkLogListener>  protocol conformance                 │
│          └─ <McSdkAlarmListener>  protocol conformance               │
│                                                                      │
│  Static globals (process-level):                                     │
│    gSdk            : McSdk*    (ObjC wrapper around C++ Sdk)         │
│    gSdkInitialized : BOOL                                            │
│    gSdkInitializing: BOOL      (concurrent init guard)               │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  ObjC → C++ (direct call, no JNI layer)
┌─────────────────────────────▼────────────────────────────────────────┐
│                    McSdk.xcframework  (C++ + ObjC)                    │
│                                                                      │
│  ios-arm64/libmcsdk-merged.a          (physical device)              │
│  ios-arm64_x86_64-simulator/libmcsdk-merged.a  (simulator)           │
│                                                                      │
│  Statically merged:                                                  │
│    McSdk (ObjC wrapper) · C++ Sdk core · SipAgent · HttpAgent        │
│    pjsip · OpenSSL · tinyxml2 · prometheus-cpp · nlohmann/json       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Layer-by-Layer Technical Analysis

### 5.1 C++ Core (`libmcsdk.so`)

**Source (reference):** `MCSDK/core/Sdk.h`, `MCSDK/core/Sdk.cpp`
**Distribution:** Pre-compiled and statically linked into `libmcsdk.so`

```cpp
class Sdk {
    bool Init();
    void SetParams(const SdkParams&);
    void SetListener(SdkListener*);    // Required — must be called before Init()
    void SetLogListener(LogListener*);
    void SetAlarmListener(AlarmListener*);
private:
    bool running{false};
};
```

**`Sdk::Init()` internals:**

```cpp
bool Sdk::Init() {
    if (running)              return true;   // Guard: already initialized
    if (!GetListener())       return false;  // Guard: listener is mandatory
    if (!SipAgent::Get().Init())  return false;
    if (!HttpAgent::Get().Init()) return false;
    running = true;
    return true;
}
```

**Critical constraint:** `SipAgent::Get()` and `HttpAgent::Get()` are Meyers singletons with process lifetime. Calling `nativeDestroy()` destroys the `Sdk` wrapper object but leaves those agents in their initialized state. A subsequent `Sdk::Init()` attempt will fail because the agents detect they are already initialized and refuse to bind the SIP port again. This constraint is resolved in the Kotlin layer — see [§7](#7-singleton-constraint--lifecycle-management).

---

### 5.2 JNI Bridge

**Source (reference):** `MCSDK/platform/android/mc-sdk-android/src/main/cpp/McSdkJni.cpp`
**Distribution:** Compiled into `libmcsdk.so`

JNI (Java Native Interface) is the ABI between the JVM and native C++ code. Method names follow a strict naming convention derived from the fully qualified Java class name:

```
Java_<package_dots_replaced_with_underscores>_<ClassName>_<methodName>

Examples:
  Java_com_aselsan_mcsdk_McSdk_nativeCreate
  Java_com_aselsan_mcsdk_McSdk_nativeInit
  Java_com_aselsan_mcsdk_McSdk_nativeSetParams
```

**`JNI_OnLoad`** — Called automatically by the Android runtime when the `.so` is loaded:

```cpp
JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void* reserved) {
    gJvm = vm;           // Store JavaVM for later use in callbacks
    pj_jni_set_jvm(vm);  // Provide JVM reference to pjsip threads
    return JNI_VERSION_1_6;
}
```

**Process-level state:**

```cpp
static std::unique_ptr<Sdk>              gSdk;
static std::unique_ptr<JniSdkListener>   gSdkListener;
static std::unique_ptr<JniAlarmListener> gAlarmListener;
static std::unique_ptr<JniLogListener>   gLogListener;
```

**Listener adapter pattern** — Bridges C++ virtual callbacks to Java method invocations:

```cpp
class JniLogListener : public LogListener {
    // Constructor caches jmethodID references for performance.
    void onLog(int level, const std::string& text) override {
        bool attached;
        JNIEnv* env = getEnv(&attached);   // Attach thread to JVM if needed
        jstring jtext = stringToJstring(env, text);
        env->CallVoidMethod(javaObj, midOnLog, (jint)level, jtext);
        env->DeleteLocalRef(jtext);
        releaseEnv(attached);              // Detach if this call attached the thread
    }
};
```

**Thread safety:** pjsip and HTTP callbacks originate from non-Java native threads. The `getEnv()` / `releaseEnv()` helpers attach the current thread to the JVM before calling Java code and detach it afterward. Without this, calling into the JVM from a foreign thread causes an immediate crash.

---

### 5.3 Java JNI Wrapper (`McSdk.java`)

**Location:** `android/app/src/main/java/com/aselsan/mcsdk/McSdk.java`
**Origin:** Copied verbatim from `MCSDK/platform/android/mc-sdk-android/src/main/java/com/aselsan/mcsdk/`

```java
public class McSdk {
    static {
        System.loadLibrary("mcsdk"); // Loads libmcsdk.so from jniLibs/
    }

    // Strong references to listener objects are held by the Java layer.
    // The native layer stores raw C++ pointers to the JNI adapter objects.
    // If Java GC collected these objects, the C++ pointers would dangle.
    private SdkListener   sdkListener;
    private LogListener   logListener;
    private AlarmListener alarmListener;

    public void setParams(SdkParams p) {
        // SdkParams is flattened into primitives before crossing the JNI boundary.
        // Passing a Java object through JNI is possible but requires verbose
        // GetFieldID / GetObjectField calls on the native side, which are slow.
        // Passing primitives is faster and type-safe.
        nativeSetParams(
            p.Logging.enabled, p.Logging.level.value,
            p.Logging.pjEnabled, p.Logging.pjLevel.value, p.Logging.rxTxEnabled,
            p.Http.port,
            p.Sip.udpPort, p.Sip.tcpEnabled, p.Sip.tcpPort,
            p.Sip.tlsEnabled, p.Sip.tlsPort, p.Sip.ipv6Enabled,
            p.Tls.mTlsEnabled, p.Tls.certPath, p.Tls.privKeyPath, p.Tls.caListPath,
            p.Threading.sipRxThreadCount, p.Threading.sipWorkerThreadCount
        );
    }

    private native void    nativeCreate();
    private native void    nativeDestroy();
    private native void    nativeSetParams(boolean logEnabled, int logLevel, ...);
    private native void    nativeSetListener(SdkListener listener);
    private native boolean nativeInit();
}
```

**Copied supporting classes:**

| File | Contents |
|---|---|
| `McSdk.java` | Main JNI wrapper — all `native` method declarations |
| `SdkParams.java` | Configuration struct with nested `LoggingParams`, `HttpParams`, `SipParams`, `TlsParams`, `ThreadingParams` |
| `SdkListener.java` | `onFetchDocument`, `onSdsSent`, `onSdsReceived`, `onSdsError` interface |
| `AlarmListener.java` | `onAlarm(String alarmJson)` interface |
| `LogListener.java` | `onLog(int level, String log)` interface |
| `SdkError.java` | `NOT_INITIALIZED`, `BUILD_REQUEST_FAILED`, `ATTACH_BODY_FAILED`, `SEND_FAILED` |
| `Alarm.java` | Value class — `name`, `info`, `severity` |
| `AlarmSeverity.java` | `UNKNOWN(0)` … `CRITICAL(5)` with `fromValue(int)` factory |
| `LogLevel.java` | `VERBOSE(0)` … `FATAL(5)` with `fromValue(int)` factory |

---

### 5.4 Kotlin TurboModule (`McSdkModule.kt`)

**Location:** `android/app/src/main/java/com/aselsan/mcsdk/rn/McSdkModule.kt`

This is the React Native bridge for Android. It extends `ReactContextBaseJavaModule` and directly implements `SdkListener`, `AlarmListener`, and `LogListener`, so C++ callbacks arrive as Kotlin method calls.

> **Note:** This file was **not a direct copy** of `MCSDK/platform/react-native/android/McSdkModule.kt`.
> The original referenced class names `McSdkAlarm`, `McSdkParams`, and `McSdkLogLevel`, which do not
> exist — the actual Java class names are `Alarm`, `SdkParams`, and `LogLevel`. The module was
> rewritten from scratch with the correct imports.

```kotlin
class McSdkModule(context: ReactApplicationContext)
    : ReactContextBaseJavaModule(context),
      SdkListener, AlarmListener, LogListener {

    companion object {
        private var sdk: McSdk? = null      // One instance per process — never destroyed
        private var sdkInitialized = false  // Guards against duplicate C++ Init() calls
    }

    override fun getName() = "McSdk"       // Must match TurboModuleRegistry.getEnforcing('McSdk')
}
```

**Key methods:**

```kotlin
@ReactMethod
fun create() {
    // nativeCreate() is called only once per process.
    // On hot-reload, the module instance is recreated but 'sdk' survives.
    // Rebinding listeners ensures the new module instance receives callbacks.
    if (sdk == null) sdk = McSdk()
    sdk!!.setListener(this)
    sdk!!.setAlarmListener(this)
    sdk!!.setLogListener(this)
}

@ReactMethod
fun destroy() {
    sdk?.destroy()           // Calls nativeDestroy() → gSdk.reset() in C++
    sdk = null               // Release the Java wrapper
    sdkInitialized = false
}

@ReactMethod(isBlockingSynchronousMethod = true)
fun init(): Boolean {
    // isBlockingSynchronousMethod = true: JSI delivers a synchronous return value
    // to JavaScript without requiring a Promise or callback.
    if (sdkInitialized) return true   // Guard: do not call C++ Init() twice
    val result = sdk?.init() ?: false
    sdkInitialized = result
    return result
}
```

**Event emission** (C++ → JavaScript):

```kotlin
private fun emit(event: String, body: WritableMap) {
    reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, body)
}

override fun onLog(level: Int, log: String) {
    emit(EVENT_LOG, Arguments.createMap().apply {
        putInt("level", level)
        putString("log", log)
    })
}
```

**Package registration:**

```kotlin
// McSdkPackage.kt
class McSdkPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) =
        listOf(McSdkModule(context))
    override fun createViewManagers(context: ReactApplicationContext) = emptyList<ViewManager<*, *>>()
}

// MainApplication.kt
PackageList(this).packages.apply {
    add(McSdkPackage())  // Registers the 'McSdk' TurboModule with the registry
}
```

---

### 5.5 iOS Platform Bridge (`McSdkModule.mm`)

**Location:** `ios/McSdkBridge/McSdkModule.mm`  
**Build scope:** `McSdkBridge.podspec` — `s.source_files = 'ios/McSdkBridge/**/*.{h,m,mm}'` + `s.vendored_frameworks = 'ios/McSdk.xcframework'`

Unlike Android, which loads C++ via JNI from a `.so` shared library, iOS links the XCFramework statically at compile time. There is no JNI layer; ObjC++ calls directly into C++ with zero overhead.

#### 5.5.1 XCFramework Structure

```
ios/McSdk.xcframework/
├── Info.plist
├── ios-arm64/                          ← physical device slice
│   ├── libmcsdk-merged.a               (C++ core + pjsip + OpenSSL, ~21 MB)
│   └── Headers/                        ← ObjC wrapper headers
│       ├── McSdk.h                     ← Main facade
│       ├── McSdkParams.h               ← McSdkParams + sub-param structs
│       ├── McSdkListener.h             ← @protocol McSdkListener
│       ├── McSdkLogListener.h          ← @protocol McSdkLogListener
│       └── McSdkAlarmListener.h        ← @protocol McSdkAlarmListener
└── ios-arm64_x86_64-simulator/         ← simulator slice (device + Intel)
    ├── libmcsdk-merged.a
    └── Headers/
```

`libmcsdk-merged.a` is a fat static archive that contains the compiled ObjC wrapper (`McSdk`) and the full C++ core (`Sdk`, `SipAgent`, `HttpAgent`, all modules, pjsip, OpenSSL) merged into a single `.a` file via `libtool -static`. Xcode selects the correct slice automatically based on the build target.

#### 5.5.2 ObjC++ Bridge (`McSdkModule.mm`)

`McSdkModule` is an `RCTEventEmitter` subclass that also conforms to all three listener protocols:

```objc
@interface McSdkModule () <McSdkListener, McSdkLogListener, McSdkAlarmListener>
@end

@implementation McSdkModule
RCT_EXPORT_MODULE(McSdk)  // Registers as "McSdk" in TurboModuleRegistry
```

Because `McSdkModule` itself implements the listener protocols, it passes `self` as all three listener targets. No separate adapter objects are needed (compare to Android's `JniSdkListener` / `JniLogListener` / `JniAlarmListener` adapter classes).

**Process-level state:**

```objc
static McSdk *gSdk           = nil;
static BOOL   gSdkInitialized  = NO;
static BOOL   gSdkInitializing = NO;  // concurrent init guard
```

These are `static` file-scope variables — iOS has the same process-level singleton constraint as Android. Once `SipAgent` is initialized (inside the XCFramework's C++ core), it cannot be re-initialized within the same process.

#### 5.5.3 The `setParams` JSON Fix

**Problem.** In the React Native New Architecture (`TurboModules` + JSI), interop between JS and ObjC through `RCT_EXPORT_METHOD` with a large number of mixed-type arguments is broken. A method with >13 parameters where `NSString*` and `double` parameters are interleaved causes the New Arch interop layer to:

1. Drop all `NSString*` parameters silently (arrive as `null`)
2. Zero out all `double` parameters that follow an `NSString*` parameter

Diagnostic evidence: an 18-argument `setParams` method — params 1–13 (`double`) arrived correctly, params 14–16 (`NSString*`) arrived as `null`, params 17–18 (`double` after `NSString*`) arrived as `0.0`.

**Solution.** All 18 configuration fields are encoded as a single JSON string in JavaScript and decoded with `NSJSONSerialization` in ObjC:

```objc
RCT_EXPORT_METHOD(setParams:(NSString *)paramsJson) {
  NSData *data = [paramsJson dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *d = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];

  McSdkThreadingParams *threading = [[McSdkThreadingParams alloc] init];
  // Clamp to ≥1: pjsip debug build assertion requires async_cnt > 0
  threading.sipRxThreadCount    = MAX(1, [d[@"sipRxThreads"] integerValue]);
  threading.sipWorkerThreadCount= MAX(1, [d[@"sipWorkerThreads"] integerValue]);
  // … all other params extracted similarly
  [gSdk setParams:params];
}
```

The `MAX(1, ...)` guard also prevents a `___assert_rtn` crash in pjsip's debug build: `assert(pool_factory->factory.create_pool != NULL)` is reached when `async_cnt == 0` is passed to the PJSUA transport creation.

#### 5.5.4 Async `init` and Concurrency Guard

`initSdk` is a blocking call (starts pjsip and the HTTP server). It runs on a background GCD queue so it does not freeze the JS thread:

```objc
RCT_EXPORT_METHOD(init:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  if (gSdkInitializing) {
    reject(@"INIT_IN_PROGRESS", @"SDK initialisation is already in progress", nil);
    return;
  }
  gSdkInitializing = YES;
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    BOOL result = [gSdk initSdk];
    if (result) gSdkInitialized = YES;
    gSdkInitializing = NO;
    resolve(@(result));
  });
}
```

The `gSdkInitializing` flag prevents a second `init()` call from starting while the first is still running — a real risk when the UI is tapped quickly.

#### 5.5.5 Event Emission

SDK listener callbacks originate from native (pjsip / HTTP) threads. They are dispatched to the main queue before being sent to JavaScript to comply with `RCTEventEmitter`'s main-thread requirement:

```objc
- (void)emitEvent:(NSString *)name body:(NSDictionary *)body {
  if (!self.hasListeners) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.hasListeners) {
      [self sendEventWithName:name body:body];
    }
  });
}

#pragma mark - McSdkLogListener
- (void)onLog:(NSInteger)level log:(NSString *)log {
  [self emitEvent:@"McSdkLog" body:@{@"level": @(level), @"log": log}];
}
```

**Events emitted:** `McSdkLog`, `McSdkAlarm`, `McSdkFetchDocument`, `McSdkSdsSent`, `McSdkSdsReceived`, `McSdkSdsError`.

#### 5.5.6 iOS vs Android Bridge Comparison

| Aspect | Android | iOS |
|---|---|---|
| C++ distribution | `libmcsdk.so` (shared, JNI) | `libmcsdk-merged.a` in XCFramework (static) |
| Bridge language | Kotlin TurboModule | ObjC++ `RCTEventEmitter` |
| SDK wrapper | `McSdk.java` (JNI stub class) | `McSdk` ObjC class (inside XCFramework) |
| C++ call mechanism | JNI (`Java_com_aselsan_*` symbols) | Direct ObjC → C++ call (no JNI) |
| Listener pattern | Separate `JniSdkListener`, `JniLogListener`, `JniAlarmListener` adapter classes | Single `McSdkModule` conforms to all three protocols |
| Thread attachment | `gJvm->AttachCurrentThread` needed for each callback thread | Not needed — ObjC runtime handles thread context |
| `init` execution | Background coroutine via `Executors.newSingleThreadExecutor()` | Background GCD queue `dispatch_async` |
| Event emission | `emit(name, params)` via React DeviceEventManagerModule | `sendEventWithName:body:` via main queue `dispatch_async` |
| Hot-reload guard | `companion object` — `sdk` survives module re-instantiation | `static` globals — survive React module recreation |
| Build integration | `build.gradle`: `jniLibs/`, Java sources in `src/main/java/` | `McSdkBridge.podspec`: `source_files` + `vendored_frameworks` |

---

### 5.6 TypeScript TurboModule Spec (`NativeMcSdk.ts`)

**Location:** `src/mcsdk/NativeMcSdk.ts`

In the New Architecture, every native module requires a **Codegen spec file**. The `@react-native/codegen` tool processes this file and generates the C++ JSI binding glue code.

```typescript
export interface Spec extends TurboModule {
    create(): void;
    destroy(): void;

    // All SDK configuration is encoded as a single JSON string.
    // This bypasses a New Architecture (iOS) interop limitation where
    // RCT_EXPORT_METHOD with mixed NSString*/double parameters silently
    // drops strings and zeros subsequent numeric values.
    setParams(paramsJson: string): void;

    init(): Promise<boolean>;   // Async — returns a JS Promise

    raiseAlarm(name: string, info: string, severity: number): void;
    resolveAlarm(name: string): void;
    listAlarms(): string;

    listMetrics(): string;

    // Required by the RCTEventEmitter protocol (NativeEventEmitter interop)
    addListener(eventName: string): void;
    removeListeners(count: number): void;

    // … DAO, messaging methods omitted for brevity
}

export default TurboModuleRegistry.getEnforcing<Spec>('McSdk');
//                                               ^^^^^^
//   Must exactly match getName() = "McSdk" in McSdkModule.kt (Android)
//   and RCT_EXPORT_MODULE(McSdk) in McSdkModule.mm (iOS)
```

---

### 5.7 TypeScript User API (`McSdk` class)

**Location:** `src/mcsdk/index.ts`

Application code interacts exclusively with this class. It hides raw TurboModule primitives behind a clean, typed interface and merges partial configuration with defaults.

```typescript
const DEFAULT_PARAMS: McSdkParams = {
    Logging:   { enabled: true, level: 1, pjEnabled: false, pjLevel: 1, rxTxEnabled: false },
    Http:      { port: 8008 },
    Sip:       { udpPort: 5060, tcpEnabled: false, tcpPort: 5060,
                 tlsEnabled: false, tlsPort: 5061, ipv6Enabled: false },
    Tls:       { mTlsEnabled: false, certPath: 'cert/client.crt',
                 privKeyPath: 'cert/client.key', caListPath: 'cert/ca.pem' },
    Threading: { sipRxThreadCount: 1, sipWorkerThreadCount: 1 },
};

export class McSdk {
    constructor()  { NativeMcSdk.create(); }

    setListener(): void { NativeMcSdk.setListener(); }

    setParams(params: McSdkParams = {}): void {
        // 1. Deep-merge caller-supplied partial config with defaults.
        // 2. Flatten all 18 fields into a plain object.
        // 3. Serialize to JSON — avoids New Architecture iOS interop bug with
        //    mixed NSString*/double argument lists in RCT_EXPORT_METHOD.
        const p = { ...DEFAULT_PARAMS, ...params };
        const flat = {
            logEnabled: L.enabled ? 1 : 0,
            logLevel: L.level,
            /* … all 18 fields … */
            sipRxThreads: Th.sipRxThreadCount,
            sipWorkerThreads: Th.sipWorkerThreadCount,
        };
        NativeMcSdk.setParams(JSON.stringify(flat));
    }

    init(): boolean { return NativeMcSdk.init(); }

    // Event subscription — returns an unsubscribe handle
    onLog(handler: (e: LogEvent) => void) {
        return emitter().addListener(McSdkEvents.Log, handler);
    }
    onAlarm(handler: (e: AlarmEvent) => void) { /* … */ }
}
```

---

### 5.8 React Native UI Layer (`App.tsx`)

**Location:** `App.tsx`

The test interface enforces the mandatory four-step initialization sequence. Each step gates the next — its button is disabled until the previous step completes successfully.

| Step | Button | Action |
|---|---|---|
| 1 | **Create** | `new McSdk()` → `create()` → Android: `nativeCreate()` → `gSdk = make_unique<Sdk>()` / iOS: `[[McSdk alloc] init]` |
| 2 | **Set Listener** | `sdk.setListener()` → binds all three listeners; verification log confirms binding |
| 3 | **Set Parameters** | `sdk.setParams({})` → merges defaults → `JSON.stringify(flat)` → `setParams(paramsJson)` → `gSdk->SetParams(p)` |
| 4 | **Initialize** | `sdk.init()` → async → `SipAgent::Get().Init()` + `HttpAgent::Get().Init()` → `true` / `false` |

A real-time log console below the buttons displays SDK events color-coded by source and log level.

---

## 6. Data Flow Diagrams

### JS → C++ (Android — `setParams` example)

```
App.tsx
  sdk.setParams({ Sip: { udpPort: 5060 } })
    │  src/mcsdk/index.ts — merge with defaults, flatten to 18 fields, JSON.stringify
  NativeMcSdk.setParams('{"sipUdpPort":5060,…}')
    │  JSI — direct C++ function pointer call (no Bridge serialization)
  McSdkModule.setParams(paramsJson: String)             [Kotlin]
    │  JSON.parse, construct SdkParams, resolve LogLevel.fromValue(1) → DEBUG
  sdk!!.setParams(p)                                    [Java McSdk]
    │  nativeSetParams(true, 1, …, 5060, …)
  Java_com_aselsan_mcsdk_McSdk_nativeSetParams(…)       [C++ JNI]
    │  SdkParams p; p.Sip.udpPort = 5060; …
  gSdk->SetParams(p)  →  Params::Set(params)
```

### JS → C++ (iOS — `setParams` example)

```
App.tsx
  sdk.setParams({ Sip: { udpPort: 5060 } })
    │  src/mcsdk/index.ts — merge with defaults, flatten to 18 fields, JSON.stringify
  NativeMcSdk.setParams('{"sipUdpPort":5060,…}')
    │  JSI — direct ObjC function call (no Bridge, no JNI)
  McSdkModule.setParams:(NSString*)paramsJson            [ObjC++]
    │  NSJSONSerialization parse → NSDictionary
    │  McSdkSipParams.udpPort = 5060; …
    │  MAX(1, [d[@"sipRxThreads"] integerValue]) ← pjsip guard
  [gSdk setParams:params]                               [ObjC McSdk in XCFramework]
    │  direct C++ call (no JNI layer)
  Sdk::SetParams(p)  →  Params::Set(params)             [C++ inside libmcsdk-merged.a]
```

### C++ → JS (Android — `onLog` callback)

```
Sdk::Init() (running on pjsip worker thread)
  LOGI("Sdk ready")  →  Logger::Log(level=2, "Sdk ready")
    │  Sdk::GetLogListener()->onLog(2, "Sdk ready")
  JniLogListener::onLog(2, "Sdk ready")                 [pjsip native thread]
    │  getEnv(&attached) → gJvm->AttachCurrentThread
  env->CallVoidMethod(javaObj, midOnLog, 2, jstring("Sdk ready"))
    │  McSdkModule.onLog(level=2, log="Sdk ready")      [Kotlin — JVM thread]
  emit("McSdkLog", { level: 2, log: "Sdk ready" })
    │  DeviceEventManagerModule → JS event queue
  NativeEventEmitter.emit("McSdkLog", …)
    │  App.tsx sdk.onLog() subscription handler
  addLog("[SDK INFO] Sdk ready", 'sdk')  →  blue row in log console
```

### C++ → JS (iOS — `onLog` callback)

```
Sdk::Init() (running on pjsip worker thread / GCD background queue)
  Logger::Log(level=2, "Sdk ready")
    │  [McSdkModule onLog:2 log:@"Sdk ready"]            [pjsip / GCD thread]
      (McSdkModule conforms to <McSdkLogListener> directly — no adapter object)
    │  dispatch_async(dispatch_get_main_queue(), ^{ sendEventWithName:body: })
  RCTEventEmitter → JS event queue                       [main thread]
  NativeEventEmitter.emit("McSdkLog", …)
    │  App.tsx sdk.onLog() subscription handler
  addLog("[SDK INFO] Sdk ready", 'sdk')  →  blue row in log console
```

---

## 7. Singleton Constraint & Lifecycle Management

### The Problem

`SipAgent::Get()` and `HttpAgent::Get()` inside `Sdk::Init()` are **Meyers process-level singletons**. They are alive for the entire process lifetime. Calling `nativeDestroy()` resets `gSdk` (the C++ `Sdk` instance), but those agents retain their internal initialized state. If a new `Sdk` is created and `Init()` is called again within the same process, the agents refuse to re-bind the SIP port and return `false` silently.

### Current Behavior

`destroy()` performs a **full, real destroy** of the SDK:

```kotlin
fun destroy() {
    sdk?.destroy()    // → nativeDestroy() → gSdk.reset() — C++ Sdk instance is released
    sdk = null        // Java wrapper released; GC-eligible
    sdkInitialized = false
}
```

The `companion object` exists only to survive **hot reload** (JS bundle reload without a process restart). On hot reload, Android keeps the process alive and creates a new `McSdkModule` instance — the `companion object` lets `sdk` persist across that module re-instantiation so that a hot-reload-triggered re-create does not needlessly repeat `nativeCreate()`.

```kotlin
fun create() {
    if (sdk == null) sdk = McSdk()  // nativeCreate() skipped if still alive (hot reload)
    sdk!!.setListener(this)         // Always rebind to the current module instance
    sdk!!.setAlarmListener(this)
    sdk!!.setLogListener(this)
}
```

### Re-initialization After Destroy

After a real `destroy()`, pressing **Create → Set Parameters → Initialize** again within the **same process** will likely result in `init()` returning `false` because the Meyers singleton agents already consumed their one-time initialization window. A **full app restart** (process kill) is required to reinitialize the SDK after it has been destroyed.

---

## 8. Project Structure

```
testAAR/
├── App.tsx                              ← Test UI (4-step lifecycle)
├── src/
│   ├── mcsdk/                          ← TypeScript bridge layer
│   │   ├── NativeMcSdk.ts              ← TurboModule Codegen spec
│   │   ├── index.ts                    ← McSdk class (user-facing API)
│   │   └── types.ts                    ← McSdkParams, event payload types
│   ├── core/
│   │   ├── settings.ts                 ← MMKV-backed persistent settings
│   │   └── logger.ts                   ← react-native-file-logger wrapper
│   └── utils/
│       └── parsePrometheus.ts          ← Prometheus text format parser (extracted utility)
│
├── __tests__/
│   ├── App.test.tsx                    ← 57 integration tests (RNTL)
│   └── parsePrometheus.test.ts         ← 24 pure unit tests
│
├── __mocks__/
│   ├── react-native-mmkv.js            ← In-memory MMKV mock for Jest
│   └── react-native-file-logger.js     ← No-op FileLogger mock for Jest
│
├── android/
│   └── app/
│       ├── build.gradle                ← AAR dependency removed
│       └── src/main/
│           ├── jniLibs/                ← .so files extracted from AAR
│           │   ├── arm64-v8a/libmcsdk.so    (9.3 MB)
│           │   ├── armeabi-v7a/libmcsdk.so  (6.7 MB)
│           │   └── x86_64/libmcsdk.so       (9.6 MB)
│           ├── java/com/testaar/
│           │   ├── MainApplication.kt  ← McSdkPackage registration added
│           │   └── MainActivity.kt
│           └── java/com/aselsan/mcsdk/
│               ├── McSdk.java          ← JNI wrapper (copied from AAR sources)
│               ├── SdkParams.java
│               ├── SdkListener.java
│               ├── AlarmListener.java
│               ├── LogListener.java
│               ├── SdkError.java
│               ├── Alarm.java
│               ├── AlarmSeverity.java
│               ├── LogLevel.java
│               └── rn/
│                   ├── McSdkModule.kt  ← React Native TurboModule
│                   └── McSdkPackage.kt ← Package registration
│
├── android/app/libs/
│   └── mc-sdk-android.aar              ← Reference archive only; not a build dependency
│
├── ios/
│   ├── McSdkBridge/
│   │   ├── McSdkModule.h               ← @interface McSdkModule : RCTEventEmitter
│   │   └── McSdkModule.mm              ← ObjC++ bridge implementation
│   └── McSdk.xcframework/              ← Pre-built XCFramework
│       ├── ios-arm64/
│       │   ├── libmcsdk-merged.a       ← device slice (~21 MB)
│       │   └── Headers/                ← McSdk.h, McSdkParams.h, listener protocols
│       └── ios-arm64_x86_64-simulator/
│           ├── libmcsdk-merged.a       ← simulator slice (arm64 + x86_64)
│           └── Headers/
│
├── McSdkBridge.podspec                 ← CocoaPods spec (source_files + vendored_frameworks)
│
└── MCSDK/                              ← SDK source tree (reference only, not compiled)
    ├── core/                           ← C++ core (compiled into libmcsdk.so / libmcsdk-merged.a)
    ├── platform/
    │   ├── android/                    ← Java/JNI sources (copied into this project)
    │   ├── ios/                        ← iOS ObjC++ bridge source reference
    │   └── react-native/               ← TS + Kotlin + ObjC++ bridge reference
    └── dep/                            ← pjsip, OpenSSL (statically linked)
```

---

## 9. Build & Run

### Prerequisites

- Node.js ≥ 18, npm ≥ 9
- JDK 17
- Android Studio with NDK 27 and Build Tools 35
- Connected Android device or emulator (API 24+)
- **iOS:** Xcode 15+, CocoaPods, macOS (Ventura or later recommended)
- **iOS:** Physical device or Simulator (iOS 13+)

### Commands

```bash
# Install JavaScript dependencies
npm install

# Android — debug build
cd android && ./gradlew assembleDebug

# Android — run on device / emulator (starts Metro automatically)
cd .. && npx react-native run-android

# iOS — install CocoaPods dependencies
cd ios && pod install

# iOS — run on simulator
cd .. && npx react-native run-ios
```

### Verification

After launch, step through the UI in order:

1. **Create** — Log panel should show `McSdk created`
2. **Set Listener** — A C++ log event confirms listener binding: `Listeners bound: SdkListener + AlarmListener + LogListener`
3. **Set Parameters** — Log shows parameter summary
4. **Initialize** — `init() returned: true` and the step badge turns green

### Filtering Logs

```bash
# All MCSDK-related logcat output
adb logcat | grep -i mcsdk

# Native library loading errors
adb logcat | grep -E "UnsatisfiedLink|dlopen|libmcsdk"

# Metro bundler logs
npx react-native log-android
```

### Troubleshooting

| Symptom | Root Cause | Resolution |
|---|---|---|
| `UnsatisfiedLinkError: no mcsdk in java.library.path` | `.so` files missing from `jniLibs/` or ABI mismatch | Verify files in `jniLibs/arm64-v8a/`, `jniLibs/armeabi-v7a/`, `jniLibs/x86_64/` |
| `TurboModuleRegistry: 'McSdk' could not be found` | `McSdkPackage` not registered | Confirm `add(McSdkPackage())` is present in `MainApplication.kt` |
| `init()` returns `false` consistently | Listener or params not set before `init()` | Follow the mandatory sequence: Create → Set Listener → Set Parameters → Initialize |
| `init()` returns `false` after Destroy → Create | C++ process-level singletons cannot re-initialize | Expected behavior is mitigated by the `companion object` pattern; `destroy()` only resets the JS flag, not the C++ state. If the process is restarted the issue disappears. |
| Duplicate class errors at compile time | Both AAR and Java sources in the build | Remove `implementation files('libs/mc-sdk-android.aar')` from `build.gradle` |
| iOS: `TurboModuleRegistry: 'McSdk' could not be found` | `McSdkBridge` pod not installed | Run `cd ios && pod install`, then rebuild in Xcode |
| iOS: `SIGABRT — assertion failed: async_cnt > 0` | pjsip debug assertion; zero passed for `sipRxThreadCount` | JSON parsing correct; `MAX(1, ...)` guard in `setParams:` prevents this |
| iOS: `SIGABRT — pool_factory null` | `initSdk` called before `setParams` | Follow the mandatory sequence; call `Set Parameters` before `Initialize` |
| iOS: params arrive as defaults after `setParams` | Old JS bundle cached; Metro not running | Start Metro (`npx react-native start`) and reload the app |
| iOS: build fails with `duplicate symbol` in XCFramework | Multiple copies of McSdkBridge pod linked | Clean build folder in Xcode (`Product → Clean Build Folder`) |

---

## 10. Persistent Settings & File Logging

### 10.1 Settings — `react-native-mmkv`

**Library:** `react-native-mmkv` v3 (JSI-based, synchronous reads)  
**Source:** `src/core/settings.ts`

All reads are synchronous — no `await` required. Values survive app restarts on both platforms.

```
Android: /data/data/<package>/files/mmkv/app-settings
iOS:     <sandbox>/Library/Application Support/<bundle_id>/mmkv/app-settings
```

**Three setting groups:**

| Group | Keys | Persistence trigger |
|---|---|---|
| `AppSettings` | `app.theme`, `app.language` | Immediate — written on every change in the Settings tab |
| `SdkSettings` | `sdk.*` (18 fields) | Written when "② Set Parameters" is tapped successfully |
| `LogRotationSettings` | `log.maxFileSize`, `log.maxFiles` | Immediate — written on every change in the Settings tab |

**Load on startup:**  
SDK parameter state is initialised directly from `SdkSettings.load()` in the `useState` initialisers — the fields are populated before the first render, so no flash or re-render occurs.

**Theme and language** are stored and reloaded on next launch. The Settings tab provides Dark / Light and TR / EN toggles. (Full i18n/theming wiring is left for future feature work; the stored values are ready to consume.)

### 10.2 File Logging — `react-native-file-logger`

**Library:** `react-native-file-logger` v0.7  
**Source:** `src/core/logger.ts`

`configureLogger()` is called once inside a `useEffect` at app startup. It reads `LogRotationSettings` from MMKV and configures the logger accordingly.

**Log file locations:**

```
Android: /data/data/<package>/files/logs/app_0.log
iOS:     <sandbox>/Library/Caches/Logs/app_0.log
```

> **iOS — Dosyaya ulaşmak:** Xcode → Window → Devices and Simulators → cihazı seçin → testAAR → Download Container. Açılan `.xcappdata` paketinde `AppData/Library/Caches/Logs/app_0.log` yoluna bakın.
> **Kesin path:** Uygulama → Ayarlar sekmesi → Log Files bölümü tam yolu otomatik gösterir. Metro console'da da uygulama açılışında basılır.

**Rotation behaviour:**

| Setting | Default | Description |
|---|---|---|
| `maximumFileSize` | 2 MB | New file started when current file exceeds this size |
| `maximumNumberOfFiles` | 3 | Oldest file deleted when limit is reached |

Both values are configurable at runtime from the **Settings → Log Rotation** section. Changes take effect after the next app restart (FileLogger is configured once during startup).

**Two log streams:**

| Stream | Trigger | File tag | Log level mapping |
|---|---|---|---|
| `AppLogger` | Every `addLog()` call in `App.tsx` | `[APP]` | `info/warn/error` → `FileLogger.info/warn/error` |
| `SdkLogger` | Every `McSdkLog` native event | `[SDK/<LEVEL>]` | pjsip level 0–1 → debug, 2 → info, 3 → warn, 4–5 → error |

Example log file content:
```
[2026-04-27 14:32:05.123] [INFO ] [APP] McSdk() → nativeCreate() OK
[2026-04-27 14:32:06.441] [INFO ] [APP] init() returned: true
[2026-04-27 14:32:06.450] [INFO ] [SDK/INFO] Sdk ready
[2026-04-27 14:32:06.512] [DEBUG] [SDK/DEBUG] transport_udp created port=5060
```

**SDK Logs tab:**  
In addition to file writing, every `McSdkLog` event is also appended to the `sdkLogs` in-memory list, which is displayed live in the **SDK Logs** tab. The tab shows the SDK level (VERBOSE / DEBUG / INFO / WARN / ERROR / FATAL) colour-coded, with timestamps.

**Log file management (Settings tab):**  
- **Show paths** — calls `FileLogger.getLogFilePaths()` and displays the absolute paths
- **Delete all** — calls `FileLogger.deleteLogFiles()` after a confirmation dialog

### 10.3 Jest Mocks

`react-native-mmkv` and `react-native-file-logger` are native modules; they do not run in the Node.js test environment. Two manual mocks are registered via `moduleNameMapper` in `jest.config.js`:

| File | What it does |
|---|---|
| `__mocks__/react-native-mmkv.js` | In-memory `Map`-backed `MMKV` class — full API, zero native calls |
| `__mocks__/react-native-file-logger.js` | `jest.fn()` stubs for all `FileLogger` methods |

All 81 existing tests continue to pass unchanged.

---

## 11. Testing

### Test Infrastructure

The project uses `@testing-library/react-native` (RNTL) on top of the Jest runner that ships with `@react-native/jest-preset`.

```bash
# Run all tests
npx jest

# Run with coverage report
npx jest --coverage

# Run a single test file
npx jest __tests__/parsePrometheus.test.ts
```

**Configuration (`jest.config.js`):**

```js
module.exports = {
    preset: '@react-native/jest-preset',
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@testing-library/react-native)/)',
    ],
};
```

The `transformIgnorePatterns` override is required because RNTL and React Native ship ES module source that Jest (which runs in CommonJS) cannot parse without Babel transformation.

### Test Files

| File | Tests | Type | Scope |
|---|---|---|---|
| `__tests__/parsePrometheus.test.ts` | 24 | Pure unit | `parsePrometheus()` utility function |
| `__tests__/App.test.tsx` | 57 | Integration | Full `App` component via RNTL |
| **Total** | **81** | | |

### SDK Mock Pattern

The `McSdk` TurboModule is not available in the Node.js test environment (no native runtime). All tests mock it at the module boundary:

```typescript
// __tests__/App.test.tsx

const mockCreate    = jest.fn();
const mockDestroy   = jest.fn();
const mockSetParams = jest.fn();
const mockInit      = jest.fn();
// … other mocks

// Factory creates an isolated mock instance per test
function makeSdkInstance() {
    return {
        create:    mockCreate,
        destroy:   mockDestroy,
        setParams: mockSetParams,
        init:      mockInit,
        onLog:     jest.fn().mockReturnValue({ remove: jest.fn() }),
        onAlarm:   jest.fn().mockReturnValue({ remove: jest.fn() }),
        // … other methods
    };
}

jest.mock('../src/mcsdk', () => ({
    McSdk: jest.fn(),
    McSdkEvents: { Log: 'McSdkLog', Alarm: 'McSdkAlarm' },
}));

const MockMcSdk = McSdk as jest.MockedClass<typeof McSdk>;

beforeEach(() => {
    jest.clearAllMocks();
    MockMcSdk.mockImplementation(() => makeSdkInstance() as any);
});
```

This pattern has two key properties:
1. **Isolation** — `mockImplementation` in `beforeEach` gives each test a fresh mock with call counts reset to zero.
2. **Verify behavior, not implementation** — tests assert on `mockInit.mock.calls.length`, rendered text, and disabled/enabled button state rather than on internal state variables.

### Test Categories

**`parsePrometheus.test.ts` — Pure Unit Tests**

These tests have zero dependencies on React or the SDK. They verify the Prometheus text format parser in complete isolation:

- Empty and trivial input
- Single metric family (COUNTER, GAUGE, HISTOGRAM, UNTYPED)
- Labels (quoted strings, escaped characters, multiple labels)
- Multiple families in one response
- Histogram `_sum` / `_count` / `_bucket` grouping
- Malformed lines (robustness)

**`App.test.tsx` — Integration Tests (8 groups)**

| Group | Focus | Key assertions |
|---|---|---|
| Initial render | First paint | Create button enabled, others disabled, no SDK called |
| `handleCreate` | Step 1 | `MockMcSdk` constructor called; success resets state; error logs |
| `handleSetParams` | Step 3 | `mockSetParams` called; button disabled before Create; error path |
| `handleInit` | Step 4 | `mockInit` resolves `true`/`false`; disabled until setParams done |
| `handleDestroy` | Destroy | `mockDestroy` called; state reset to pre-Create; re-Create works |
| Log console | Events | Log entries appear with correct colors; auto-scroll fires |
| Tab navigation | Metrics tab | Tab renders MetricsScreen before/after init |
| MetricsScreen | Metrics page | Prometheus parsing, empty state, error state, refresh button |
