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

### iOS (Ready — Not Yet Active)

The TypeScript layer is identical on both platforms. Only the native bridge differs:

```
NativeMcSdk.ts  (same spec)
  └─▶ TurboModuleRegistry
        └─▶ McSdkModule.mm  (ObjC++ TurboModule)
              └─▶ McSdk.xcframework
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
fun setListener() {
    // Explicit listener binding step. Emits a verification log event to JS
    // so the caller can confirm the binding succeeded.
    sdk?.setListener(this)
    sdk?.setAlarmListener(this)
    sdk?.setLogListener(this)
    emit(EVENT_LOG, Arguments.createMap().apply {
        putInt("level", 2)
        putString("log", "Listeners bound: SdkListener + AlarmListener + LogListener")
    })
}

@ReactMethod
fun destroy() {
    // Do NOT call nativeDestroy(). The C++ singleton agents cannot be re-initialized
    // after destruction (see §7). Only reset the JS-visible guard flag.
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

### 5.5 TypeScript TurboModule Spec (`NativeMcSdk.ts`)

**Location:** `src/mcsdk/NativeMcSdk.ts`

In the New Architecture, every native module requires a **Codegen spec file**. The `@react-native/codegen` tool processes this file and generates the C++ JSI binding glue code.

```typescript
export interface Spec extends TurboModule {
    create(): void;
    setListener(): void;
    destroy(): void;

    // Parameters are primitives — Codegen cannot map nested TypeScript interfaces
    // directly to native types. The McSdk class in index.ts performs the flattening.
    setParams(
        logEnabled: boolean, logLevel: number,
        pjLogEnabled: boolean, pjLogLevel: number, rxTxEnabled: boolean,
        httpPort: number,
        sipUdpPort: number, sipTcpEnabled: boolean, sipTcpPort: number,
        sipTlsEnabled: boolean, sipTlsPort: number, sipIpv6Enabled: boolean,
        mTlsEnabled: boolean, certPath: string, privKeyPath: string, caListPath: string,
        sipRxThreads: number, sipWorkerThreads: number,
    ): void;

    init(): boolean;   // Synchronous — backed by isBlockingSynchronousMethod = true

    // Required by the RCTEventEmitter protocol (NativeEventEmitter interop)
    addListener(eventName: string): void;
    removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('McSdk');
//                                               ^^^^^^
//             Must exactly match getName() = "McSdk" in McSdkModule.kt
```

---

### 5.6 TypeScript User API (`McSdk` class)

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
        // Deep-merge caller-supplied partial config with defaults,
        // then flatten all 18 fields into primitives for the TurboModule spec.
        const p = { ...DEFAULT_PARAMS, ...params };
        const L = { ...DEFAULT_PARAMS.Logging!, ...p.Logging };
        NativeMcSdk.setParams(L.enabled!, L.level!, /* … all 18 args */);
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

### 5.7 React Native UI Layer (`App.tsx`)

**Location:** `App.tsx`

The test interface enforces the mandatory four-step initialization sequence. Each step gates the next — its button is disabled until the previous step completes successfully.

| Step | Button | Action |
|---|---|---|
| 1 | **Create** | `new McSdk()` → `create()` → `nativeCreate()` → `gSdk = make_unique<Sdk>()` |
| 2 | **Set Listener** | `sdk.setListener()` → binds all three listeners; verification log confirms binding |
| 3 | **Set Parameters** | `sdk.setParams({})` → merges defaults → `nativeSetParams(18 args)` → `gSdk->SetParams(p)` |
| 4 | **Initialize** | `sdk.init()` → `nativeInit()` → `SipAgent::Get().Init()` + `HttpAgent::Get().Init()` → `true` / `false` |

A real-time log console below the buttons displays SDK events color-coded by source and log level.

---

## 6. Data Flow Diagrams

### JS → C++ (Synchronous call — `setParams` example)

```
App.tsx
  sdk.setParams({ Sip: { udpPort: 5060 } })
    │  src/mcsdk/index.ts — merge with defaults, flatten to 18 primitives
  NativeMcSdk.setParams(true, 1, false, 1, false, 8008, 5060, …)
    │  JSI — direct C++ function pointer call (no JSON serialization)
  McSdkModule.setParams(logEnabled=true, …, sipUdpPort=5060)    [Kotlin]
    │  Construct SdkParams, resolve LogLevel.fromValue(1) → DEBUG
  sdk!!.setParams(p)                                             [Java McSdk]
    │  nativeSetParams(true, 1, …, 5060, …)
  Java_com_aselsan_mcsdk_McSdk_nativeSetParams(JNIEnv*, jobject, …)  [C++ JNI]
    │  SdkParams p; p.Sip.udpPort = 5060; …
  gSdk->SetParams(p)  →  Params::Set(params)
```

### C++ → JS (Asynchronous callback — `onLog` example)

```
Sdk::Init() (running on pjsip worker thread)
  LOGI("Sdk ready")  →  Logger::Log(level=2, "Sdk ready")
    │  Sdk::GetLogListener()->onLog(2, "Sdk ready")
  JniLogListener::onLog(2, "Sdk ready")                     [pjsip native thread]
    │  getEnv(&attached) → gJvm->AttachCurrentThread  (first call on this thread)
  env->CallVoidMethod(javaObj, midOnLog, 2, jstring("Sdk ready"))
    │  McSdkModule.onLog(level=2, log="Sdk ready")          [Kotlin — now on JVM]
  emit("McSdkLog", { level: 2, log: "Sdk ready" })
    │  DeviceEventManagerModule → JS event queue
  NativeEventEmitter.emit("McSdkLog", …)
    │  App.tsx sdk.onLog() subscription handler
  addLog("[SDK INFO] Sdk ready", 'sdk')  →  blue row in log console
```

---

## 7. Singleton Constraint & Lifecycle Management

### The Problem

`SipAgent::Get()` and `HttpAgent::Get()` inside `Sdk::Init()` are **Meyers process-level singletons**. When `nativeDestroy()` is called and `gSdk` is reset, the `Sdk` C++ object is destroyed — but the SIP and HTTP agents retain their internal `initialized` state. Creating a new `Sdk` and calling `Init()` again causes the agents to detect they are already initialized and refuse to re-bind the SIP port, silently returning `false`.

### The Solution

```kotlin
companion object {
    private var sdk: McSdk? = null      // Created once — survives module re-instantiation
    private var sdkInitialized = false  // JS-visible guard flag
}

fun create() {
    if (sdk == null) sdk = McSdk()  // nativeCreate() called only once per process
    sdk!!.setListener(this)         // Rebind on every create() — hot-reload safe
    sdk!!.setAlarmListener(this)
    sdk!!.setLogListener(this)
}

fun destroy() {
    sdkInitialized = false          // Reset the JS guard; do NOT call nativeDestroy()
}

fun init(): Boolean {
    if (sdkInitialized) return true // Short-circuit: skip redundant C++ Init()
    val result = sdk?.init() ?: false
    sdkInitialized = result
    return result
}
```

### Hot Reload Behavior

During a React Native hot reload the JS bundle is re-evaluated and a new `McSdkModule` instance is created by the framework — but the Android process remains alive. The `companion object` ensures `sdk` and the underlying C++ singletons are unaffected. The subsequent `create()` call finds `sdk != null` and only rebinds listeners.

---

## 8. Project Structure

```
testAAR/
├── App.tsx                              ← Test UI (4-step lifecycle)
├── src/
│   └── mcsdk/                          ← TypeScript bridge layer
│       ├── NativeMcSdk.ts              ← TurboModule Codegen spec
│       ├── index.ts                    ← McSdk class (user-facing API)
│       └── types.ts                    ← McSdkParams, event payload types
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
│                   ├── McSdkModule.kt  ← React Native TurboModule (adapted)
│                   └── McSdkPackage.kt ← Package registration
│
├── android/app/libs/
│   └── mc-sdk-android.aar              ← Reference archive only; not a build dependency
│
└── MCSDK/                              ← SDK source tree (not required at runtime or build time)
    ├── core/                           ← C++ core (compiled into libmcsdk.so)
    ├── platform/
    │   ├── android/                    ← Java/JNI sources (copied into this project)
    │   ├── ios/                        ← iOS ObjC++ bridge (future integration)
    │   └── react-native/               ← TS + Kotlin + ObjC++ bridge (copied & adapted)
    └── dep/                            ← pjsip, OpenSSL (statically linked into libmcsdk.so)
```

---

## 9. Build & Run

### Prerequisites

- Node.js ≥ 18, npm ≥ 9
- JDK 17
- Android Studio with NDK 27 and Build Tools 35
- Connected Android device or emulator (API 24+)

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
