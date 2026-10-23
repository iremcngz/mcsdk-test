# SDK ile İletişim — Medya Katmanı

Bu doküman, uygulamanın medya (ses) katmanının SDK'dan **tam olarak ne beklediğini**
ve SDK'ya **tam olarak ne verdiğini** tanımlar. SDK ekibiyle yapılacak görüşmenin
referansıdır.

Tarih: 2026-10-20 · Submodule: `38389e4` · Test cihazı: SM-A205F (API 28)

---

## 1. İş Bölümü

| Katman | Kimde | Durum |
|---|---|---|
| Cihaz I/O (`AudioRecord` / `AudioTrack`) | **Uygulama** | Çalışıyor |
| Codec (PCMU, AMR-WB) | **Uygulama** | Çalışıyor |
| Thread yönetimi, gerçek zamanlı döngüler | **Uygulama** | Çalışıyor |
| Jitter buffer, sıralama, kayıp gizleme | **Uygulama** | Çalışıyor |
| Ses oturumu, yönlendirme, AEC/NS | **Uygulama** | Çalışıyor |
| **RTP paketleme / depaketleme** | **SDK** | API yok |
| **SRTP** | **SDK** | API yok |
| **SDP müzakeresi** | **SDK** | Kısmen (`Fmtp` eksik) |
| **Floor control** | **SDK** | Çalışıyor |

Kısaca: **medyayı biz üretiyoruz ve tüketiyoruz, SDK taşıyor.**

---

## 2. Sınır: Encoded Frame

### 2.0 Önce terminoloji — iki ayrı isim katmanı

Görüşmelerde en çok karışan nokta bu, o yüzden baştan netleştirelim. İki ayrı
katman var ve **aynı veriyi** taşıyorlar:

| Katman | İsim | Dil | Durum |
|---|---|---|---|
| **Uygulama arayüzü** | `onFrame(...)` | Kotlin | **Bugün var, çalışıyor** |
| **SDK API'si** | `SendEncodedFrame` / `onEncodedFrame` | C++ | **Yok — bu dokümanın talebi** |

`onFrame`, uygulamanın kendi soyutlaması (`AudioFrameSink` /
`AudioFrameSource`). Bugün dosyaya yazıyor ve dosyadan okuyor; test edilmiş
durumda.

`SendEncodedFrame` / `onEncodedFrame` isimleri bu dokümanda **öneri** olarak
geçiyor. SDK ekibi başka isim seçebilir — önemli olan isim değil, aşağıdaki veri
sözleşmesi.

Aralarındaki bağ, yazılacak iki küçük adaptör sınıfı:

```
UPLINK
  AudioCapture döngüsü  (bizde, 50 kez/s)
    └─ sink.onFrame(payload, len, ts, marker)          ← uygulama arayüzü
         └─ SdkFrameSink                                ← YAZILACAK, ~10 satır
              └─ sdk.sendEncodedFrame(callId, ...)      ← SDK API'si

DOWNLINK
  SDK'nın ağ thread'i
    └─ onEncodedFrame(callId, kind, payload, ts, pt)   ← SDK API'si
         └─ SdkFrameSource                              ← YAZILACAK, ~15 satır
              └─ listener.onFrame(payload, len, ts)    ← uygulama arayüzü
                   └─ jitterBuffer.put(...)
```

Yani SDK API'si geldiğinde yazılacak tek şey bu iki adaptör. Boru hattının geri
kalanı — capture döngüsü, codec, jitter buffer, oynatma döngüsü — değişmiyor.

### 2.1 Sınır neden PCM değil, encoded frame

```
UPLINK    mikrofon → AudioRecord → encode → [SINIR] → SDK → RTP → ağ
DOWNLINK  ağ → RTP → SDK → [SINIR] → jitter → decode → AudioTrack → hoparlör
```

Codec uygulama tarafında olduğu için **SDK ham sesi hiç görmüyor**. Gerekçe:
donanım codec'leri (`MediaCodec`), AMR-WB lisansı ve ileride video için platform
codec'inin zorunlu olması.

Bunun bir sonucu var ve 6.3'te ayrıca ele alınıyor: SDK'nın mevcut
`MediaSession::ReadPcm` tasarımı **çözülmüş PCM** vermeyi planlıyor. İkisi aynı
anda olamaz; bu bir API tasarım kararı.

### 2.2 Sürekli çalışan ne, sınırda çağrılan ne

Bir ayrım daha, çünkü bu da karışıyor: **döngüler sürekli çalışıyor, `onFrame`
onların içinde çağrılan metot.**

| | Sürekli çalışan (sonsuz döngü) | Ritmi belirleyen | Sınırda çağrılan |
|---|---|---|---|
| Uplink | `AudioCapture.captureLoop()` | `AudioRecord.read()` bloke ediyor | `onFrame` → SDK |
| Downlink | `AudioPlayback.playbackLoop()` | `AudioTrack.write()` bloke ediyor | — |

İki döngü de saniyede 50 kez dönüyor ve ritmi **donanım** belirliyor; hiçbirinde
`sleep` yok.

Kritik nokta: **oynatma döngüsü SDK'yı beklemiyor.** Paket gelmese bile dönüyor
ve o slot için sessizlik yazıyor. Aralarında jitter buffer duruyor:

```
SDK'nın ağ thread'i   →  jitterBuffer.put()     ← ağın ritmi (düzensiz)
                              │
                         JitterBuffer           ← pasif veri yapısı, thread DEĞİL
                              │
oynatma thread'imiz   →  jitterBuffer.read()    ← donanım ritmi (sabit 20 ms)
```

Bu yüzden SDK'nın paketleri düzenli göndermesi gerekmiyor. Jitter buffer'ın
varlık sebebi tam olarak bu.

### 2.3 Uplink — uygulamanın SDK'ya verdiği

Uygulama arayüzü (bugün var):

```kotlin
// AudioFrameSink.kt
fun onFrame(payload: ByteArray, len: Int, timestamp: Int, marker: Boolean)
```

İstenen SDK API'si:

```cpp
void SendEncodedFrame(const std::string& callId,
                      const uint8_t* payload, size_t len,
                      uint32_t timestamp, bool marker);
```

| Alan | Anlamı | Kritik detay |
|---|---|---|
| `payload` | Encode edilmiş frame | **Ham encoder çıktısı**, RFC 4867 payload formatı değil |
| `len` | Geçerli bayt sayısı | **Değişken** — AMR-WB mod 8'de 61, sabit varsayılamaz |
| `timestamp` | RTP timestamp, **örnek cinsinden** | Frame başına +320 (16 kHz, 20 ms) — bkz. §3 |
| `marker` | Talkspurt başlangıcı | Floor alındıktan sonraki ilk frame |
| `callId` | Hedef çağrı | **Yalnızca SDK API'sinde** — bkz. §2.5 |

**Sıklık ve hacim:** 50 frame/saniye, ~61 bayt/frame → ~3 KB/s (24 kbps).

**`payload`ın içinde tam olarak ne var** (gerçek kayıttan ölçüldü):

```
ToC = 0x44  →  FT = 8  →  mod 8 = 23.85 kbps  →  1 bayt ToC + 60 bayt ses = 61
doğrulama: 1138 frame × 61 = 69418 bayt, dosya boyutuyla bayt bayt aynı
```

**SDK'nın yapması gereken:** RTP başlığı (12 bayt), sequence numarası, SSRC,
RFC 4867 payload başlığı, SRTP, UDP gönderimi. Payload'ın içeriğine
dokunmadan taşımak.

**`marker` ne işe yarıyor:** Floor bırakılıp tekrar alındığında arada paket
gönderilmiyor ama timestamp ilerliyor. Alıcı bu boşluğu "paket kaybı" sanmasın,
"yeni talkspurt" olarak anlasın diye ilk frame marker'lı gidiyor. RFC 3550, RTP
başlığının marker biti.

### 2.4 Downlink — SDK'nın uygulamaya verdiği

İstenen SDK API'si:

```cpp
virtual void onEncodedFrame(const std::string& callId,
                            MediaKind kind,                      // Audio | Video
                            const std::vector<uint8_t>& payload,
                            uint32_t timestamp,
                            uint8_t payloadType) = 0;
```

Uygulama arayüzü (bugün var):

```kotlin
// AudioFrameSource.kt
fun onFrame(payload: ByteArray, len: Int, timestamp: Int)
```

| Alan | Niçin gerekli |
|---|---|
| `callId` | Hangi akışa ait — her çağrının kendi jitter buffer'ı var |
| `kind` | Audio/Video ayrımı; video eklenince ayrı yola gidecek |
| `payload` | Encoded frame, ham encoder çıktısı |
| `timestamp` | **Telden okunan** RTP timestamp — jitter buffer sıralamayı buna göre yapıyor |
| `payloadType` | Hangi codec'le decode edileceği; dinamik tip müzakereyle atanıyor |

**SDK'nın yapması gereken:** UDP'den okumak, SRTP çözmek, RTP başlığını
ayrıştırmak, RFC 4867 payload başlığını soymak, payload + timestamp vermek.

**SDK'nın yapmasına gerek OLMAYAN** — bu kısım önemli, çünkü fazladan iş yapmak
zarar veriyor:

| SDK yapmasın | Neden |
|---|---|
| Sıralama | Jitter buffer timestamp'e göre yerleştiriyor |
| Kopya filtreleme | `duplicate` sayacıyla yakalanıyor |
| Kayıp telafisi | Önceki frame tekrarlanarak gizleniyor (`concealed`) |
| Jitter tamponlama | **Bizde 80 ms tampon var — SDK da tamponlarsa gecikme iki katına çıkar** |

Paketler sırasız, kopya veya eksik gelebilir. Altı senaryoyla test edildi:
sırası bozuk → düzeltildi, kayıp → gizlendi, kopya → yakalandı, çok geç gelen →
atıldı, priming, underrun.

### 2.5 `callId` neden asimetrik

Dikkatli bakıldığında bir tutarsızlık var ve kasıtlı: **`callId` SDK API'sinde
var, uygulama arayüzünde yok.**

Sebep, iki tarafın kapsamının farklı olması:

```
SDK        → tek nesne, tüm çağrıları yönetiyor      → callId ZORUNLU
uygulama   → akış başına bir Sink/Source örneği      → callId GEREKSİZ
```

`MediaPipeline` her akış için ayrı bir zincir kuruyor:

```kotlin
val jb = JitterBuffer(cd)
val src = FileFrameSource(file)
src.setListener { payload, len, ts -> jb.put(payload, len, ts) }
```

Bu `src` yalnızca bu `jb`'yi besliyor — zaten o çağrıya ait olduğu için hangi
çağrı olduğunu bilmesine gerek yok. `callId` taşımak, gerçek zamanlı yolda her
frame'de gereksiz bir karşılaştırma demek olurdu.

`callId` **adaptörde tüketiliyor**:

```kotlin
class SdkFrameSource(private val callId: String) : AudioFrameSource {
    fun onSdkFrame(fromCallId: String, payload: ByteArray, len: Int, ts: Int) {
        if (fromCallId != callId) return         // bizim akışımız değil
        listener?.onFrame(payload, len, ts)      // callId'yi düşür, aşağı ilet
    }
}
```

Çoklu çağrı senaryosunda:

```
SDK'nın tek callback'i
  ├─ callId="call-1" → SdkFrameSource#1 → JitterBuffer#1 → AudioPlayback#1  (seçili, çalıyor)
  └─ callId="call-2" → SdkFrameSource#2 → JitterBuffer#2 → (seçili değil, çalmıyor)
```

Her çağrının kendi zinciri var; `callId` yalnızca en üstteki dağıtım noktasında
gerekiyor.

## 3. Timestamp Sözleşmesi

Bu maddenin ayrı başlık olmasının sebebi, yanlış yapıldığında **sessizce** bozuluyor
olması.

Timestamp saat değeri **değil**, üretilen ses örneği sayacı:

```kotlin
timestamp += 320        // her 20 ms frame için, 16 kHz'de
```

**SDK bu değeri olduğu gibi RTP başlığına koymalı, yeniden hesaplamamalı.**

### Neden saat duvarından türetilmiyor

Ses kartı saati ile sistem saati arasında ~%0.3 fark var ve bu **birikiyor**.
Ölçüm:

```
10 saniye ses sonrası:
  örnek sayarak   : 160000  (biz bunu gönderiyoruz)
  saat duvarından : 160480
  sapma           : 480 örnek = 30 ms
```

Jitter buffer 60-100 ms tutuyor; birkaç dakikada bu bütçe aşılır ve ses kesik
kesik gelir. Hata **başta görünmüyor** — ilk 30 saniye kusursuz çalışır.

### Mute davranışı

Mute sırasında timestamp **ilerliyor**, çünkü RTP zamanı medya saati. Boşluk,
karşı tarafa konuşmanın duraklamasını anlatıyor. Mute'tan çıkan ilk frame
`marker = true` taşıyor.

---

## 4. Thread Sözleşmesi

### 4.1 Uygulamanın taahhüdü

`onEncodedFrame` callback'i içinde **yalnızca jitter buffer'a kopyalama**
yapılacak — ölçülen süre ~50 µs. Bloke eden iş yapılmayacak.

### 4.2 SDK'ya sorumuz

`MCSDK/CLAUDE.md`: *"Listener callbacks are synchronous on the SDK worker
thread."*

Yani SDK callback'i çağırırken **bekliyor**. Bu, mevcut durumda bir risk
yaratıyor:

```
SDK worker thread'i
  ├─ onEncodedFrame(...)  → ~50 µs   (bizim medya kodumuz, sorun yok)
  └─ onLog(...)           → ~2 ms    (JSON + köprü geçişi)
```

Varsayılan parametrelerle (`logLevel 0`, `pjLogLevel 0`, `rxTxEnabled true`) SDK
saniyede **~450 log olayı** üretiyor. Bunlar da aynı thread'den geçerse
thread'in büyük kısmı log'a gider ve RTP paketleri okunamaz — UDP tamponu taşar,
**paket kaybı** olur.

Kritik olan şu: bu kayıp jitter buffer'da **normal ağ kaybı gibi görünür**.
Gerçek sebep log boru hattıdır ve teşhis etmesi çok zordur.

**Sorular:**

1. Medya callback'i (`onEncodedFrame`) log callback'iyle **aynı thread'de** mi
   olacak?
2. Aynı thread ise, medya callback'ini önceliklendirmek veya ayırmak mümkün mü?
3. Bir callback yavaş olursa SDK ne yapıyor — bekliyor mu, kuyruğa mı alıyor?

### 4.3 Uygulama tarafında ödenecek borç

Köprü şu an `emit`'i SDK worker thread'inde yapıyor (`McSdkModule.kt`,
`Arguments.createMap()` + `emitDeviceEvent`). `CLAUDE.md`'de "known debt" olarak
kayıtlı. Ses eklenince ödenmesi zorunlu: olay kuyruğa atılıp hemen dönülecek,
JSON oluşturma başka thread'e taşınacak.

---

## 5. SDK'dan İstenen API

### 5.1 `SendEncodedFrame` — uplink

```cpp
void SendEncodedFrame(const std::string& callId,
                      const uint8_t* payload, size_t len,
                      uint32_t timestamp, bool marker);
```

`callId` gerekli: çoklu çağrıda hangi çağrıya gittiğini bilmek zorundayız.

### 5.2 `onEncodedFrame` — downlink

```cpp
virtual void onEncodedFrame(const std::string& callId,
                            MediaKind kind,                     // Audio | Video
                            const std::vector<uint8_t>& payload,
                            uint32_t timestamp,
                            uint8_t payloadType) = 0;
```

`payloadType` gerekli: hangi codec'le decode edeceğimizi oradan anlıyoruz.

### 5.3 `onMediaNegotiated` — en kritik eksik

```cpp
virtual void onMediaNegotiated(const std::string& callId,
                               const NegotiatedMedia& media) = 0;
// payloadType, encoding ("AMR-WB"), clockRate (16000), ptime (20), fmtp
```

**Bu olmadan uygulama kör.** SDP müzakeresi SDK içinde oluyor; anlaşılan codec'i
bilmezsek varsayımla encode ederiz. Yanlışsa:

- SIP kurulur ✓
- RTP akar ✓
- Ses **hiç çıkmaz** ✗

Yani her şey "çalışıyor" görünür. Hata ayıklaması çok pahalı.

### 5.4 `SetAudioCodecs`

```cpp
void SetAudioCodecs(const std::vector<CodecDescriptor>& codecs);
```

SDP offer'a ne konacağını belirler. Olmazsa SDK kendi varsayılanlarıyla
(`MediaSdp.h`: `PCMU/8000`) offer üretir ve uygulamanın gerçekte ne decode
edebildiğinden habersiz kalır.

**Uygulamanın bildirdiği değerler:**

| | AMR-WB | PCMU |
|---|---|---|
| `encoding` | `AMR-WB` | `PCMU` |
| `payloadType` | 96 (dinamik) | 0 (statik) |
| `clockRate` | 16000 | 16000 ⚠️ |
| `ptime` | 20 | 20 |
| `bitRate` | 23850 (mod 8) | — |
| `fmtp` | `octet-align=1` | — |

⚠️ PCMU standartta 8 kHz'dir. Uygulama şu an 16 kHz kullanıyor (tek örnekleme
hızı tutmak için). Gerçek bir PCMU çağrısında resampler gerekir — bu uygulama
tarafının işi, ama müzakerede 8 kHz anlaşılırsa bilmemiz gerekiyor.

### 5.5 `SdpBuilder::Fmtp()` — somut kod eksiği

`MCSDK/core/Modules/Sdp/Sdp.h` içindeki `SdpBuilder` şunları üretebiliyor:
`Rtpmap()`, `Ptime()`, `Rtcp()`, `Direction()`, `Format()`.

**`Fmtp()` metodu yok.** Dolayısıyla `a=fmtp:` satırı üretilemiyor.

Sonucu: AMR-WB'nin `octet-align=1` parametresi SDP'ye konulamıyor. Bu parametre
olmadan karşı taraf varsayılan olan `bandwidth-efficient` (bit hizalı) bekler;
biz `octet-align` (bayt hizalı) gönderiyoruz. Sonuç: **ses çalınır ama
anlaşılmaz.** Çökme yok, hata yok.

5.4 ile birlikte anlamlı — ayrı ayrı yarım kalıyorlar.

---

## 6. SDK Tarafında Mevcut Durum

Kod okumasıyla doğrulanmış tespitler:

### 6.1 `RtpRtcpSession` yazılmış ama bağlı değil

`core/Modules/RtpRtcp/RtpRtcpSession.h` gerçek ve kullanıma hazır görünüyor:

```cpp
using RtpCallback = std::function<void(RtpPacket packet)>;
bool SendRtp(const std::vector<uint8_t>& payload, uint32_t timestamp, bool marker);
void SetTxEnabled(bool enabled);
```

Ama hiçbir yerden **instantiate edilmiyor**. `RtpRtcp/` dizini dışındaki iki
referans yalnızca yorum satırı:

- `MediaSession.h:34` — *"Forwards to RtpRtcpSession::SetTxEnabled() once the
  pipeline is wired"*
- `FloorMachine.cpp:617` — *"RtpRtcpSession must be constructed with
  Config.ssrc = this localSsrc"*

Yani istenen API'nin altyapısı zaten yazılmış; dışa açılması ve motora bağlanması
gerekiyor. Floor control tarafı SSRC beklentisini bile not etmiş durumda.

### 6.2 `MediaSession` iskelet halinde

`core/Modules/Call/Media/MediaSession.cpp` 42 satır, her metodu `(stub)`:

```cpp
void MediaSession::Start() { LOGD("... (stub)"); }
// TODO: open RTP tx/rx (UDP), apply negotiated codec, start jitter buffer
std::size_t MediaSession::ReadPcm(...) { return 0; }
```

### 6.3 `ReadPcm` tasarımı uygulamanın ihtiyacıyla çelişiyor

Mevcut plan SDK'nın **çözülmüş PCM** vermesi:

```cpp
std::size_t ReadPcm(std::int16_t* out, std::size_t frames);
```

Uygulama codec'i kendisi yaptığı için **encoded frame** istiyor. İkisi aynı anda
olamaz; bu bir API tasarım kararı ve konuşulması gerekiyor.

Uygulamanın gerekçesi: donanım codec'leri, AMR-WB lisansı ve ileride video için
`MediaCodec` zorunluluğu. Platform codec'i kullanmak uygulama tarafında daha
doğal.

### 6.4 FU-A parçalama (video için, şimdilik not)

Video eklendiğinde bir IDR frame 100 KB olabilir, MTU ~1200 bayt. H.264 FU-A
parçalaması gerekir ve bu **RTP katmanının işi**, yani SDK'da olmalı.
`SendEncodedFrame`'in frame'i parçalara bölmesi beklentisi açıkça netleştirilmeli
— yoksa IP fragmentasyonu olur ve paket kaybı patlar.

---

## 7. Uygulamanın Doğrulanmış Davranışı

SDK ekibine güven vermesi için, uygulama tarafının ölçülmüş sonuçları:

| Ölçüm | Sonuç |
|---|---|
| PCMU encode doğruluğu | Sistem encoder'ıyla **16000 baytın tamamı birebir** |
| PCMU round-trip SNR | **36.9 dB** (G.711 spec ≈ 38 dB) |
| Ring buffer (30 s, 80 ms disk takılmaları) | 1500 frame, **0 kayıp**, max yazma **46 µs** (bütçe 20000) |
| AMR-WB gerçek kayıt | 1138 frame × 61 bayt = **69418 bayt**, bayt bayt tam |
| AMR-WB dosya geçerliliği | ToC `0x44` → FT 8 (23.85 kbps), Q=1; bağımsız decoder **22.76 s** okudu |
| Jitter buffer (gerçek dosya, 2 thread) | 1138 alındı, 1138 oynatıldı, **tüm sayaçlar 0** |
| Jitter buffer (6 senaryo) | Sırası bozuk → düzeltildi; kayıp → gizlendi; kopya → yakalandı |
| Timestamp doğruluğu | Mute'lu 250 frame senaryosunda **tam**; marker doğru frame'lerde |

Yani sınırın uygulama tarafı test edilmiş durumda. SDK API'si geldiğinde
`SdkFrameSink` / `SdkFrameSource` yazılacak — tahmini **~30 satır**, geri kalan
hiçbir şey değişmeyecek.

---

## 8. Öncelik Sırası

SDK ekibinden istenenlerin iş görür hale gelme sırası:

| # | Madde | Olmadan ne olmuyor |
|---|---|---|
| 1 | `RtpRtcpSession`'ı motora bağla | Hiçbir şey |
| 2 | `SendEncodedFrame` + `onEncodedFrame` | Ses akışı |
| 3 | `onMediaNegotiated` | Doğru codec'le encode |
| 4 | `SetAudioCodecs` + `SdpBuilder::Fmtp()` | AMR-WB gerçek çağrıda |
| 5 | Thread modeli netleştirme | Güvenilir paket alımı |

1-2 olmadan hiçbir test yapılamaz. 3-4 olmadan ses akar ama karşı tarafta
anlaşılmaz olabilir.

---

## 9. Özet Cümle

> Codec'i, cihaz I/O'sunu, thread yönetimini ve jitter buffer'ı uygulama yapıyor.
> SDK'dan RTP taşıma ve SDP müzakeresi bekliyoruz. Sınır tam olarak **encoded
> frame + timestamp**: uygulama `(payload, len, timestamp, marker)` veriyor, SDK
> `(payload, len, timestamp, payloadType)` veriyor. Timestamp örnek sayarak
> hesaplanıyor — olduğu gibi kullanılmalı. Müzakere sonucu `onMediaNegotiated`
> ile bildirilmeli, yoksa hangi codec'te anlaşıldığı bilinemez.
