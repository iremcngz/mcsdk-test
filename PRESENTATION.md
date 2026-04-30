# McSdk React Native Integration — Technical Presentation

> **Proje:** MCSDK C++ SDK'nın React Native üzerinden hem Android hem iOS'ta kullanılabilir hale getirilmesi  
> **Mimari:** React Native 0.85 New Architecture (TurboModules + JSI)  
> **SDK Dağıtımı:** Android: `.so` (JNI) — iOS: `.xcframework` (static)

---

## 1. Projenin Amacı

MCSDK, SIP ve HTTP protokollerini yöneten, C++ ile yazılmış bir SDK'dır. Bu proje:

- MCSDK'yı Android ve iOS'ta **React Native** üzerinden kullanılabilir kılmak
- Her iki platform için **yerel köprüyü (bridge) yazmak** ve entegre etmek
- **New Architecture (TurboModules + JSI)** ile sıfır-serializasyon maliyetli bağlantı sağlamak
- SDK yaşam döngüsünü (Create → Set Parameters → Initialize → Destroy) test etmek
- **Tam bir test altyapısı** kurmak (81 test, SDK mock'lama)

---

## 2. Üst Düzey Mimari

```
┌─────────────────────────────────────────────────────────────────┐
│                   React Native JavaScript katmanı                │
│                                                                 │
│   App.tsx  →  McSdk (index.ts)  →  NativeMcSdk.ts              │
│                                        │                        │
│                          TurboModuleRegistry.getEnforcing('McSdk')│
└──────────────────────────────┬──────────────────────────────────┘
                               │  JSI
              ┌────────────────┴─────────────────┐
              │                                  │
              ▼  Android                         ▼  iOS
┌─────────────────────────┐       ┌──────────────────────────────┐
│  McSdkModule.kt (Kotlin) │       │  McSdkModule.mm (ObjC++)     │
│  McSdkPackage.kt         │       │  McSdkBridge.podspec         │
│  McSdk.java (JNI stub)   │       │                              │
└───────────┬─────────────┘       └──────────────┬───────────────┘
            │  JNI                               │  direct ObjC→C++
            ▼                                    ▼
┌─────────────────────────┐       ┌──────────────────────────────┐
│  libmcsdk.so            │       │  McSdk.xcframework           │
│  (shared library)       │       │  libmcsdk-merged.a (static)  │
│  arm64-v8a              │       │  ios-arm64 / simulator slice │
│  armeabi-v7a            │       └──────────────────────────────┘
│  x86_64                 │
└─────────────────────────┘
              │ (her iki platform)
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      C++ MCSDK Çekirdeği                         │
│                                                                 │
│  Sdk  ·  SipAgent (pjsip)  ·  HttpAgent (cpp-httplib)           │
│  AlarmModule  ·  MetricModule  ·  MessageModule                 │
│  OpenSSL  ·  tinyxml2  ·  prometheus-cpp  ·  nlohmann/json      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. New Architecture — JSI ve TurboModules

### Eski Mimari (Bridge)

```
JS  →  JSON serialize  →  MessageQueue  →  deserialize  →  Native
```

Her çağrı JSON'a seri hale getirilip async mesaj kuyruğuna atılırdı. Bu, özellikle SIP/RTP gibi yüksek frekanslı senaryolarda ciddi gecikme ve CPU yükü yaratıyordu.

### Yeni Mimari (JSI + TurboModules)

```
JS  →  JSI function pointer  →  Native (synchronous, no serialization)
```

- **JSI (JavaScript Interface):** C++ fonksiyonlarına doğrudan JS'den çağrı imkânı
- **TurboModules:** Codegen ile üretilen type-safe C++ bağlantı katmanı
- **Sonuç:** Sıfır serializasyon, senkron çağrı, lazy modül yükleme

**Codegen Spec (`NativeMcSdk.ts`):**
```typescript
export interface Spec extends TurboModule {
    create(): void;
    destroy(): void;
    setParams(paramsJson: string): void;
    init(): Promise<boolean>;
    // ...
}
export default TurboModuleRegistry.getEnforcing<Spec>('McSdk');
```

Bu dosya `@react-native/codegen` tarafından işlenerek her iki platform için C++ JSI glue kodu üretir.

---

## 4. JavaScript Katmanı — `McSdk` Sınıfı

**`src/mcsdk/index.ts`** — Uygulamanın kullandığı asıl API:

```typescript
const DEFAULT_PARAMS: McSdkParams = {
    Logging:   { enabled: true, level: 1, pjEnabled: false, pjLevel: 1, rxTxEnabled: false },
    Http:      { port: 8008 },
    Sip:       { udpPort: 5060, tcpEnabled: false, tcpPort: 5060, ... },
    Tls:       { mTlsEnabled: false, certPath: 'cert/client.crt', ... },
    Threading: { sipRxThreadCount: 1, sipWorkerThreadCount: 1 },
};

export class McSdk {
    constructor() { NativeMcSdk.create(); }

    setParams(params: McSdkParams = {}): void {
        // Kısmi config'i defaults ile birleştir, JSON'a seri hale getir
        const flat = { logEnabled: 1, sipUdpPort: 5060, sipRxThreads: 2, ... };
        NativeMcSdk.setParams(JSON.stringify(flat));
    }

    async init(): Promise<boolean> { return NativeMcSdk.init(); }

    onLog(handler: (e: LogEvent) => void) {
        return emitter().addListener(McSdkEvents.Log, handler);
    }
}
```

**Tasarım kararları:**
- `DEFAULT_PARAMS` ile kısmi override → her zaman geçerli bir yapılandırma
- `JSON.stringify` → iOS New Arch interop sorununun çözümü (aşağıda açıklanıyor)
- `NativeEventEmitter` wrapper → event aboneliği temiz `unsubscribe` handle'ı ile

---

## 5. Android Bridge

### 5.1 C++ → Android Veri Akışı

```
libmcsdk.so yüklenir (System.loadLibrary("mcsdk"))
       ↓
JNI_OnLoad(JavaVM* vm) — JVM referansı saklanır, pjsip'e verilir
       ↓
nativeCreate() — C++ Sdk objesi oluşturulur
       ↓
nativeSetParams(18 primitive) — SdkParams doldurulur
       ↓
nativeInit() — SipAgent::Get().Init() + HttpAgent::Get().Init()
```

### 5.2 JNI Listener Adapter Modeli

pjsip callback'leri C++ thread'lerinden gelir; JVM'ye geçmeden önce thread attach edilmesi gerekir:

```cpp
class JniLogListener : public LogListener {
    void onLog(int level, const std::string& text) override {
        bool attached;
        JNIEnv* env = getEnv(&attached);   // pjsip thread'ini JVM'ye bağla
        env->CallVoidMethod(javaObj, midOnLog, (jint)level, jstring(text));
        releaseEnv(attached);              // Gerekirse detach
    }
};
```

`JniSdkListener`, `JniAlarmListener`, `JniLogListener` — üç ayrı adapter sınıfı.

### 5.3 Kotlin TurboModule (`McSdkModule.kt`)

```kotlin
@ReactModule(name = McSdkModule.NAME)
class McSdkModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    
    companion object {    // Hot reload sonrası sdk referansını canlı tutar
        var sdk: McSdk? = null
    }

    override fun getName() = "McSdk"  // TurboModuleRegistry key

    @ReactMethod fun create(promise: Promise) {
        if (sdk == null) sdk = McSdk()
        sdk!!.setListener(this)
        sdk!!.setLogListener(this)
        // ...
    }

    // SdkListener, LogListener, AlarmListener interface'lerini implement eder
    override fun onLog(level: Int, log: String) {
        emit("McSdkLog", Arguments.createMap().apply {
            putInt("level", level); putString("log", log)
        })
    }
}
```

**Hot reload guard:** `companion object` içindeki `sdk` referansı, JS bundle yeniden yüklendiğinde process canlı kaldığı için `McSdkModule` örneği yeniden oluşturulur ancak `sdk` hayatta kalır. `nativeCreate()` tekrar çağrılmaz.

---

## 6. iOS Bridge

### 6.1 XCFramework Yapısı

```
McSdk.xcframework/
├── ios-arm64/                  ← Fiziksel cihaz
│   ├── libmcsdk-merged.a       ← C++ core + pjsip + OpenSSL (statik, ~21 MB)
│   └── Headers/                ← ObjC wrapper header'ları
│       ├── McSdk.h
│       ├── McSdkParams.h
│       ├── McSdkListener.h
│       ├── McSdkLogListener.h
│       └── McSdkAlarmListener.h
└── ios-arm64_x86_64-simulator/ ← Simulator (arm64 + Intel)
    ├── libmcsdk-merged.a
    └── Headers/
```

Android'den farklı olarak: JNI yoktur. ObjC++ doğrudan C++'ı çağırır.

### 6.2 CocoaPods Entegrasyonu (`McSdkBridge.podspec`)

```ruby
Pod::Spec.new do |s|
  s.source_files     = 'ios/McSdkBridge/**/*.{h,m,mm}'
  s.vendored_frameworks = 'ios/McSdk.xcframework'
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"$(PODS_ROOT)/../ios/McSdk.xcframework/ios-arm64/Headers" ...'
  }
  s.dependency 'React-Core'
end
```

### 6.3 ObjC++ Bridge (`McSdkModule.mm`)

```objc
@interface McSdkModule () <McSdkListener, McSdkLogListener, McSdkAlarmListener>
@end

@implementation McSdkModule
RCT_EXPORT_MODULE(McSdk)  // TurboModuleRegistry'ye "McSdk" adıyla kaydeder

// Process-level globals
static McSdk *gSdk            = nil;
static BOOL   gSdkInitialized  = NO;
static BOOL   gSdkInitializing = NO;
```

**Listener modeli:** Android'de 3 ayrı adapter sınıfı varken, iOS'ta `McSdkModule`'ün kendisi 3 protocol'ü conform eder. `self` pointer'ı 3 listener olarak da geçilir.

### 6.4 Async `init`

```objc
RCT_EXPORT_METHOD(init:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
    if (gSdkInitializing) {
        reject(@"INIT_IN_PROGRESS", @"Already initializing", nil);
        return;
    }
    gSdkInitializing = YES;
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        BOOL result = [gSdk initSdk];        // SipAgent + HttpAgent başlatılır
        if (result) gSdkInitialized = YES;
        gSdkInitializing = NO;
        resolve(@(result));
    });
}
```

### 6.5 Event Emission

SDK callback'leri pjsip thread'lerinden gelir; `sendEventWithName:body:` main thread'de çağrılmalıdır:

```objc
- (void)onLog:(NSInteger)level log:(NSString *)log {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventWithName:@"McSdkLog" body:@{@"level": @(level), @"log": log}];
    });
}
```

---

## 7. Kritik Keşif: New Architecture iOS Parametre Sorunu

### Sorun

iOS New Architecture'da `RCT_EXPORT_METHOD` ile çok sayıda karışık tipli parametre (`NSString*` + `double`) gönderildiğinde ObjC-JS interop katmanı hatalı davranır:

```objc
// HATALI — 18 parametre, karışık NSString* ve double
RCT_EXPORT_METHOD(setParams:(double)logEnabled
                          ...(double)mTlsEnabled
                          :(NSString*)certPath       // ← bu ve sonrası bozulur
                          :(NSString*)privKeyPath
                          :(NSString*)caListPath
                          :(double)sipRxThreads      // ← 0.0 gelir
                          :(double)sipWorkerThreads) // ← 0.0 gelir
```

**Teşhis logu:**
```
[McSdk][1-13]  logEnabled=1.0 ... ✅  (double'lar doğru geldi)
[McSdk][14-16] certPath=(null)  ✅→❌  (NSString* null geldi)
[McSdk][17-18] sipRxThreads=0.0 ❌    (NSString* sonrası double sıfırlandı)
```

### Kök Neden

React Native New Architecture'ın JSI → ObjC++ interop katmanı, 13'ten fazla parametreli ve karışık `NSString*` / `double` içeren metodlarda:
1. `NSString*` parametrelerini `null` olarak iletir
2. `NSString*` parametrelerinden sonra gelen tüm `double` değerlerini sıfırlar

### Çözüm: JSON Tek String Parametresi

```typescript
// JavaScript katmanı — 18 alan tek JSON string'e sıkıştırılır
NativeMcSdk.setParams(JSON.stringify({
    logEnabled: 1, logLevel: 1, ..., certPath: 'cert/client.crt',
    sipRxThreads: 2, sipWorkerThreads: 1
}));
```

```objc
// ObjC++ — tek NSString*, NSJSONSerialization ile ayrıştırılır
RCT_EXPORT_METHOD(setParams:(NSString *)paramsJson) {
    NSDictionary *d = [NSJSONSerialization JSONObjectWithData:...];
    threading.sipRxThreadCount = MAX(1, [d[@"sipRxThreads"] integerValue]);
    // MAX(1,...): pjsip debug assertion: async_cnt > 0
}
```

**Ek keşif:** pjsip'in debug build'ı `async_cnt == 0` durumunda `___assert_rtn` ile crash atar. `MAX(1, ...)` guard bu crash'ı da önler.

---

## 8. Android vs iOS Karşılaştırması

| Özellik | Android | iOS |
|---|---|---|
| C++ dağıtımı | `libmcsdk.so` (shared, JNI) | `libmcsdk-merged.a` (static, XCFramework) |
| Bridge dili | Kotlin | ObjC++ |
| C++ çağrı mekanizması | JNI (`Java_com_aselsan_*` semboller) | Doğrudan ObjC → C++ |
| Listener pattern | 3 ayrı `Jni*Listener` adapter sınıfı | `McSdkModule` 3 protocol'ü conform eder |
| Thread yönetimi | `gJvm->AttachCurrentThread` gerekli | ObjC runtime halleder |
| `init` asenkroni | `Executors.newSingleThreadExecutor()` | `dispatch_async(global queue)` |
| Event gönderimi | `emit(name, params)` | `sendEventWithName:body:` (main queue) |
| Hot reload guard | `companion object` | `static` globals |
| Build entegrasyonu | `build.gradle` + `jniLibs/` | `McSdkBridge.podspec` + XCFramework |
| `setParams` | JSON string (New Arch fix) | JSON string (New Arch fix) |

---

## 9. SDK Yaşam Döngüsü ve Singleton Kısıtı

### Zorunlu Başlatma Sırası

```
1. Create      → new McSdk()      → gSdk oluşturulur
2. Set Params  → setParams({})    → SdkParams doldurulur
3. Initialize  → init()           → SipAgent + HttpAgent başlatılır  →  true/false
4. (Kullanım)
5. Destroy     → destroy()        → gSdk serbest bırakılır
```

Her adım bir öncekinin tamamlanmış olmasına bağlıdır. UI, bu sıralamayı zorlar — her buton bir önceki adım tamamlanmadan disabled kalır.

### Process-Level Singleton Kısıtı

`SipAgent::Get()` ve `HttpAgent::Get()` **Meyers singleton**'larıdır — process ömrü boyunca yaşarlar. `destroy()` çağrıldığında C++ `Sdk` nesnesi silinir, ancak bu agent'lar başlatılmış durumda kalır. Aynı process içinde `init()` tekrar çağrılırsa agent'lar zaten başlatılmış olduklarını görerek `false` döner.

**Çözüm:** Gerçek bir yeniden başlatma için uygulamanın process'i kapatıp yeniden açması gerekir. Geliştirme sırasında hot reload (JS bundle yenileme) process'i kapatmaz; `companion object` / `static globals` pattern'i bu durumu yönetir.

---

## 10. Test Altyapısı

### Neden Mock?

TurboModule, gerçek native runtime gerektirir. Jest, Node.js üzerinde çalışır — native bridge mevcut değildir. `McSdk` sınıfı mock'lanarak:
- Test ortamımda native çağrıların yokluğu sorununun üstesinden gelinir
- Davranış doğrulaması native uygulama detaylarından bağımsız hale gelir

### Mock Pattern'i

```typescript
// Her test için izole mock instance
function makeSdkInstance() {
    return {
        create:    mockCreate,
        destroy:   mockDestroy,
        setParams: mockSetParams,
        init:      mockInit.mockResolvedValue(true),
        onLog:     jest.fn().mockReturnValue({ remove: jest.fn() }),
        // ...
    };
}

jest.mock('../src/mcsdk', () => ({
    McSdk: jest.fn(),
    McSdkEvents: { Log: 'McSdkLog', Alarm: 'McSdkAlarm' },
}));

beforeEach(() => {
    jest.clearAllMocks();
    MockMcSdk.mockImplementation(() => makeSdkInstance() as any);
});
```

### Test İstatistikleri

```
Test Suites: 2 passed, 2 total
Tests:       81 passed, 81 total
```

| Dosya | Test Sayısı | Kapsam |
|---|---|---|
| `parsePrometheus.test.ts` | 24 | Pure unit — saf fonksiyon testi |
| `App.test.tsx` | 57 | Integration — component + SDK mock |

### Test Grupları (`App.test.tsx`)

| Grup | # | Neyi test eder |
|---|---|---|
| Initial render | 6 | İlk yüklenme; sadece Create butonu aktif |
| `handleCreate` | 5 | Constructor çağrısı, başarı/hata senaryoları |
| `handleSetParams` | 8 | JSON encode, erken çağrı engeli, hata yönetimi |
| `handleInit` | 5 | async Promise, true/false dönüşü, init guard |
| `handleDestroy` | 6 | State sıfırlama, yeniden Create akışı |
| Log console | 3 | Event görüntüleme, renk kodlaması |
| Tab navigation | 5 | Home ↔ Metrics tab geçişi |
| MetricsScreen | 11 | Prometheus parse, boş/hata durumu, refresh |

### `parsePrometheus.test.ts` — Pure Unit Tests

```typescript
describe('parsePrometheus', () => {
    it('returns [] for empty input', () => {
        expect(parsePrometheus('')).toEqual([]);
    });

    it('parses a COUNTER metric', () => {
        const raw = `# HELP http_requests Total requests
# TYPE http_requests counter
http_requests{method="GET"} 42`;
        const result = parsePrometheus(raw);
        expect(result[0].name).toBe('http_requests');
        expect(result[0].samples[0].value).toBe(42);
    });
});
```

---

## 11. Kalıcı Ayarlar — MMKV

**Kütüphane:** `react-native-mmkv` v3 — JSI tabanlı, senkron okuma  
**Kaynak:** `src/core/settings.ts`

### Neden MMKV?

| Seçenek | Okuma tipi | Hız | Not |
|---|---|---|---|
| `AsyncStorage` | async | Orta | `await` gerektirir; ilk render'da flash |
| `react-native-mmkv` | **senkron** | ~10× hızlı | JSI, doğrudan C++ MMKV |

SDK parametreleri `useState` initializer'da okunur — ilk render'dan önce hazır:

```typescript
const [sipUdpPort, setSipUdpPort] = useState(
  () => SdkSettings.load().sipUdpPort   // senkron, "await" yok
);
```

### Dosya Konumları

```
Android: /data/data/<package>/files/mmkv/app-settings
iOS:     <sandbox>/Library/Application Support/<bundle_id>/mmkv/app-settings
```

### Üç Ayar Grubu

| Grup | Ne saklar | Ne zaman yazılır |
|---|---|---|
| `AppSettings` | Tema (dark/light), dil (tr/en) | Settings tab'da anında |
| `SdkSettings` | 18 SDK parametresi | "② Set Parameters" başarıyla tamamlandığında |
| `LogRotationSettings` | Max dosya boyutu, max dosya sayısı | Settings tab'da anında |

### Settings Tab (UI)

- **Theme:** Dark / Light seçici — değer anında MMKV'ye yazılır, uygulama yeniden açıldığında geri yüklenir
- **Language:** TR / EN seçici — aynı yaklaşım; tam i18n wiring gelecek feature
- **Log Rotation:** 1 MB / 2 MB / 5 MB ve 2 / 3 / 5 dosya seçicileri
- **Log Files:** Dosya path'lerini görüntüleme + tümünü silme (onay dialogu ile)

---

## 12. Dosya Logları — react-native-file-logger

**Kütüphane:** `react-native-file-logger` v0.7  
**Kaynak:** `src/core/logger.ts`

### İki Log Akışı

```
addLog("init() returned: true")
  │
  ├─ UI log console (Home tab — in-memory)
  └─ AppLogger.info("[APP] init() returned: true")  →  app_0.log

McSdkLog native event received (SDK C++ → JS)
  │
  ├─ UI log console (Home tab — "sdk" level, mavi)
  ├─ UI SDK Logs tab (ayrı sayfa, canlı)
  └─ SdkLogger.write(level, msg)  →  "[SDK/INFO] Sdk ready"  →  app_0.log
```

### Log Dosyası Formatı

```
[2026-04-27 14:32:05.123] [INFO ] [APP] McSdk() → nativeCreate() OK
[2026-04-27 14:32:06.441] [INFO ] [APP] init() returned: true
[2026-04-27 14:32:06.450] [INFO ] [SDK/INFO] Sdk ready
[2026-04-27 14:32:06.512] [DEBUG] [SDK/DEBUG] transport_udp created port=5060
```

### Dosya Konumları

| Platform | Konum |
|---|---|
| **Android** | `/data/data/<package>/files/logs/app_0.log` |
| **iOS** | `<sandbox>/Documents/logs/app_0.log` |

iOS'ta `Documents/` klasörü, `UIFileSharingEnabled = YES` ile Files App'ten erişilebilir hale getirilebilir.

### Rotation Ayarları (Konfigürasyonlu)

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `maximumFileSize` | 2 MB | Bu boyutu geçince yeni dosya açılır |
| `maximumNumberOfFiles` | 3 | Bu sayıyı geçince en eski dosya silinir |

Ayarlar MMKV'de saklanır ve startup'ta `configureLogger()` tarafından okunur. UI'dan değiştirilebilir; bir sonraki uygulama açılışında devreye girer.

### SDK Logs Tab

`McSdkLog` event'i hem uygulama log dosyasına yazılır hem de ayrı bir SDK Logs tab'ına aktarılır. Seviye renk kodlaması:

| Seviye | Renk |
|---|---|
| VERBOSE / DEBUG | Gri |
| INFO | Mavi |
| WARN | Sarı |
| ERROR / FATAL | Kırmızı |

### Jest Mock'ları

Native modüller Node.js ortamında çalışmaz; two manuel mock:

```javascript
// __mocks__/react-native-mmkv.js
class MMKVMock {
  _store = new Map();
  set(k, v)        { this._store.set(k, v); }
  getString(k)     { return this._store.get(k); }
  getBoolean(k)    { return this._store.get(k); }
  getNumber(k)     { return this._store.get(k); }
}
module.exports = { MMKV: MMKVMock };

// __mocks__/react-native-file-logger.js
const FileLogger = {
  configure: jest.fn().mockResolvedValue(undefined),
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
  getLogFilePaths: jest.fn().mockResolvedValue([]),
  deleteLogFiles: jest.fn().mockResolvedValue(undefined),
};
```

**Sonuç:** Tüm 81 test değişmeden geçiyor.

---

## 13. Veri Akışı — Uçtan Uca

### JS → C++ (setParams, her iki platform)

```
App.tsx: sdk.setParams({ Sip: { udpPort: 5060 } })
  │
  ▼ src/mcsdk/index.ts
  defaults ile merge, 18 alanı düzleştir
  JSON.stringify({ sipUdpPort: 5060, sipRxThreads: 2, ... })
  │
  ▼ JSI (senkron, serializasyon yok)
  NativeMcSdk.setParams('{"sipUdpPort":5060,...}')
  │
  ├─ Android: McSdkModule.kt → JSON.parse → SdkParams → nativeSetParams → C++
  └─ iOS:     McSdkModule.mm → NSJSONSerialization → McSdkParams → [gSdk setParams:]
                                                                          │
                                                          C++ Sdk::SetParams(p)
```

### C++ → JS (onLog callback, her iki platform)

```
pjsip worker thread: Logger::Log(level=2, "Sdk ready")
  │
  ├─ Android:
  │    JniLogListener::onLog (C++ thread)
  │    gJvm->AttachCurrentThread
  │    env->CallVoidMethod(javaObj, midOnLog, 2, "Sdk ready")
  │    McSdkModule.onLog (JVM) → emit("McSdkLog", {...})
  │
  └─ iOS:
       [McSdkModule onLog:2 log:@"Sdk ready"] (pjsip thread)
       dispatch_async(main_queue, ^{ sendEventWithName:@"McSdkLog" body:{...} })
  │
  ▼ (her iki platform)
  NativeEventEmitter  →  JS event queue
  App.tsx: onLog handler  →  addLog(...)  →  log konsolu güncellenir
```

---

## 14. Proje Yapısı (Özet)

```
testAAR/
├── App.tsx                    ← Test UI (4 adımlı yaşam döngüsü)
├── src/mcsdk/
│   ├── NativeMcSdk.ts         ← Codegen spec (platform-agnostic)
│   ├── index.ts               ← McSdk sınıfı
│   └── types.ts               ← TypeScript tipleri
├── src/utils/
│   └── parsePrometheus.ts     ← Prometheus metin format ayrıştırıcı
├── __tests__/
│   ├── App.test.tsx           ← 57 integration test
│   └── parsePrometheus.test.ts ← 24 unit test
├── android/app/src/main/
│   ├── jniLibs/               ← libmcsdk.so (arm64, armeabi-v7a, x86_64)
│   └── java/com/aselsan/mcsdk/
│       ├── McSdk.java         ← JNI wrapper
│       └── rn/McSdkModule.kt  ← Kotlin TurboModule
├── ios/
│   ├── McSdkBridge/McSdkModule.mm  ← ObjC++ bridge
│   └── McSdk.xcframework/          ← Pre-built XCFramework
└── McSdkBridge.podspec             ← CocoaPods spec
```

---

## 15. Build & Run

### Android

```bash
npm install
npx react-native run-android
```

### iOS

```bash
npm install
cd ios && pod install && cd ..
npx react-native run-ios
```

### Test

```bash
npx jest                  # 81 test çalıştır
npx jest --coverage       # Coverage raporu
```

---

## 16. Öne Çıkan Teknik Kararlar

| Karar | Neden |
|---|---|
| `setParams` → JSON string | New Architecture ObjC interop, 13+ karışık tipli parametrelerde bozuluyor |
| `MAX(1, sipRxThreads)` | pjsip debug build `assert(async_cnt > 0)` ile crash atıyor |
| `dispatch_async` (main queue) for events | `sendEventWithName:body:` main thread'de çağrılmalı |
| `companion object` / `static` process globals | Hot reload'da SDK state'ini korur, çift init'i önler |
| `gSdkInitializing` flag | Async `init` çağrısının çift tetiklenmesini önler |
| `react-native-mmkv` v3 (JSI senkron) | Senkron okuma — ilk render flash/flicker yok; AsyncStorage'dan 10× hızlı |
| `react-native-file-logger` | Size-based rotation, dual transport (file + console), minimal setup |
| `AppLogger` + `SdkLogger` aynı dosyada | Log korelasyonu: uygulama ve SDK olayları tek zaman ekseninde |
| SDK Logs ayrı tab | SDK C++ log'ları UI'da filtrelenmiş görünüm; Home console'unu boğmaz |
| `__mocks__/react-native-mmkv.js` | Native modül — Node.js ortamında çalışmaz; Map mock test izolasyonu sağlar |
| `jest.fn()` stubs for FileLogger | Test akışını etkilemeden log çağrılarını doğrulayabilme imkânı |
| `jest.fn().mockImplementation(() => makeSdkInstance())` in `beforeEach` | Test izolasyonu; her test için temiz mock call sayacı |
| `parsePrometheus` ayrı utility | Pure function → saf unit test, App bileşeninden bağımsız |
| XCFramework (static) vs `.so` (shared) | iOS App Store'un statik bağlantı gereksinimine uygun |

---

## 17. Bilinen Kısıtlamalar

| Kısıtlama | Açıklama |
|---|---|
| **Process-level singleton** | `destroy()` sonrası aynı process'te `init()` çalışmaz; tam yeniden başlatma için app kapatılmalı |
| **pjsip debug build** | XCFramework'teki pjsip debug build'dır; `async_cnt > 0` gibi assertion'lar aktiftir |
| **iOS `init` async** | Android senkron dönerken iOS Promise döner; UI buna uygun şekilde `async/await` kullanır |
| **setListener ayrı adım** | Android original API'sında listener ayrı set edilmeli; iOS'ta `create()` içinde otomatik set edilir |
| **Metrics Prometheus ayrıştırma** | `listMetrics()` SDK'nın Prometheus text formatında döndürdüğünü varsayar; format değişirse parser güncellenmeli |
