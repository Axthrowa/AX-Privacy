# AX-Privacy 🛡️

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/version-3.3.0-0284c7.svg?style=flat-square)](package.json)
[![Zero Telemetry](https://img.shields.io/badge/telemetry-0%25-emerald.svg?style=flat-square)](#gizlilik-ve-g%C3%BCvenlik-garantisi)
[![License](https://img.shields.io/badge/license-GPL--3.0-amber.svg?style=flat-square)](LICENSE)

**AX-Privacy**, Chromium tabanlı modern tarayıcılar (Google Chrome, Microsoft Edge, Brave, Opera) için geliştirilmiş; **sıfır hata**, **sıfır telemetri** ve **siteyi bozmayan** kurallarla çalışan yeni nesil bir **Manifest V3** gizlilik ve reklam engelleme eklentisidir.

Her şey tamamen tarayıcınızın içinde yerel olarak çalışır: Hesap kaydı yok, dış sunucuya veri gönderme yok, arka planda kullanıcıyı takip eden telemetri yok.

---

## 🚀 Öne Çıkan Özellikler

### 1. 25.000+ Önceliklendirilmiş DNR Reklam ve İzleyici Kalkanı
- Chrome'un yerel `declarativeNetRequest` (DNR) motorunu kullanır; sayfalar yüklenirken tarayıcıyı yormaz, pil ve bellek tüketimini minimumda tutar.
- **EasyList** ve **OISD** listelerinin kesişiminden derlenmiş, çift kontrol edilmiş 25.000 yüksek etkili kural içerir.
- **Çekirdek Garanti Listesi:** En yaygın reklam ağları (`doubleclick.net`, `googlesyndication.com`, `google-analytics.com`, `taboola.com`, `outbrain.com`, `criteo.com`, vb.) her zaman kural setinin en üstünde garanti altına alınır.

### 2. URL Takip Parametresi Temizleyici (Query Stripper)
- Tıkladığınız bağlantılardaki kullanıcı takip etiketlerini (`utm_source`, `utm_medium`, `fbclid`, `gclid`, `mc_eid`, `igshid`, vb.) hedef sayfaya ulaşmadan önce temizler.
- Bankacılık, e-ticaret sepetleri veya oturum doğrulama parametrelerine dokunmaz; web sitelerinin işlevselliğini bozmaz.

### 3. RFC 3492 Türkçe Uyumlu Punycode & Homograph Tehdit Kalkanı
- Sahte ve taklit alan adlarını (örn. Kiril alfabesiyle yazılmış `аpple.com` gibi homograph saldırılarını) yerel algoritmayla anında analiz eder ve sekmeyi uyarır (`!`).
- **Türkçe Harf Koruması:** `türkiye.gov.tr` (`xn--trkiye-3ya.gov.tr`) gibi meşru ulusal alan adlarını güvenli kabul eder; yanlış alarm (false-positive) üretmez.
- Güvenli sitelere dönüldüğünde Chrome'un yerel DNR sayaç rozetini (`#0284c7`) otomatik olarak geri yükler.

### 4. Twitch SSAI / Video-Swap Yayın Kalkanı
- Twitch'in Amazon IVS oynatıcısı içerisine yerel Web Worker kancası enjekte eder.
- **Anonim Token Alma:** Kimlik sızıntısını önlemek için oturum başlıklarını izole eder ve reklamsız yedek akış sorgular.
- **Kesin Reklam Göstergesi Eşleştirme:** Yanlış pozitifleri önler; yalnızca `twitch-stitched-ad`, `amazon-adsystem` gibi kesin reklam etiketlerini filtreler.
- **Otomatik Sessize Alma (Auto-Mute Fallback):** Twitch tüm yedek akışları engellediğinde reklam anında videoyu geçici olarak sessize alır (`🔇`), reklam bitince sesi otomatik olarak eski seviyesine döndürür.
- **Özel Playlist Proxy Desteği:** İsteğe bağlı olarak kullanıcı tanımlı harici `.m3u8` proxy şablonu desteği sunar.

### 5. YouTube Video İçi Reklam Kalkanı
- **Katman 1 (Önleyici JSON Temizleyici):** `/youtubei/v1/player` yanıtlarından `adPlacements`, `playerAds`, `adSlots` ve YouTube'un anti-adblock uyarı ekranlarını (`bkaEnforcementMessageViewModel`) oynatıcı daha işlemeden önce siler; video oynatma akışını (`streamingData`, `videoDetails`) korur.
- **Katman 2 (Hızlı Atlatıcı):** Oynatıcıya sızan reklamları anında sessize alır, video süresini sona sarar ve atla butonlarını tıklar.
- **Katman 3 (Kozmetik Filtreleme):** Arayüzü kirleten banner ve sponsorlu video kartlarını siteyi bozmadan gizler.

### 6. Özel Filtre Listesi Yöneticisi & Çoklu Format Ayrıştırıcı (v2.5.0)
- **Çoklu Format Desteği:** Adblock Plus / uBO (`||ad.com^`), Hosts dosyası (`0.0.0.0 domain`) ve düz domain listelerini (OISD / HaGeZi) hatasız ayrıştırır; istisna (`@@`), kozmetik (`##`) ve sayfa bozan (`$document`, `$popup`) kuralları temizler.
- **Ağ Dayanıklılığı ve 15 MB Sınırı:** Her liste indirmesi 15 saniye zaman aşımı ile korunur; aşırı büyük dosyalar (>15 MB) engellenir.
- **Kısmi Hata Toleransı:** Bir liste hata verse bile diğer sağlam listeler ve EasyList kesintisiz uygulanmaya devam eder.
- **Öncelikli Delta Motoru:** Statik 25.000 kuralla çakışan alan adları çıkarılır; kullanıcı listeleri dinamik DNR kotasında en yüksek önceliği alır (ID izolasyonu: 10000+).

### 7. Sıfır Gecikmeli Pre-Open, Anti-DevTools Yönlendirme, Anti-Vignette & Kırılmaz Sekme Kalkanı (v3.0.0)
- **Anti-DevTools Yönlendirme Kalkanı (`google.com`, `bing.com` vb.):** Sitelerin `F12` veya DevTools açıldığını algılayarak sayfayı zorla harici bir arama motoruna (`google.com`, `bing.com`, `about:blank`) yönlendirmesini (`Location.prototype.assign`, `replace`, `href` ve `window.open(..., '_self')`) yakalayıp engeller; kullanıcının geliştirici araçlarını özgürce kullanmasını sağlar.
- **Tıklama Tuzağı & Dinamik Href-Swap Nötralizasyonu:** Tıklama anında (`pointerdown`/`mousedown`) `<a>` etiketinin `href` adresini gizlice harici reklam alan adına değiştiren betikleri tespit eder; orijinal hedefi geri yükleyerek ve reklam URL'sini etkisiz kılarak sahte pop-up'ları önler.
- **Form Üzerinden Pop-up Engelleme:** Reklam betiklerinin görünmez veya dinamik `<form target="_blank">` oluşturup `form.submit()` veya `form.requestSubmit()` ile yeni sekmeye reklam fırlatmasını engeller.
- **Sıfır Gecikmeli Pre-Open Sert Engel (Sekmenin Hiç Açılmaması):** Reklam sekmesinin açılıp sonradan kapatılması yerine **tarayıcıda hiç açılmamasını** garanti eder:
  - **Senkron Niyet Takibi (`setTrustedIntent` / `hasTrustedIntent`):** Kullanıcı görünür, şeffaf olmayan bir bağlantıya (`target="_blank"`, orta tık veya `Ctrl/Meta+Tık`) kasten basmadıkça `sessionStorage` ve `window.name` JSON zarfında doğrulanmış niyet bulunmaz.
  - **`window.open` Sert Engel:** İzinsiz veya cross-site `window.open` çağrıları yerel tarayıcı API'sine hiç iletilmez; doğrudan zararsız sahte `Window` nesnesi döndürülerek sekme açılışı sayfa içinde durdurulur.
  - **Sentetik `<a>` Tıklama ve `dispatchEvent` Sert Engel:** Sayfa betiklerinin programatik olarak `.click()` veya `dispatchEvent` ile tetiklediği harici veya `target="_blank"` tıklamaları engellenir (`return false`).
- **`webNavigation.onBeforeNavigate` Ultra Erken Müdahale:** Arka planda `chrome.webNavigation.onBeforeNavigate` dinleyicisi ile yeni açılan sekmeler henüz HTTP yanıtı gelmeden veya DOM başlamadan ilk milisaniyede yakalanıp kapatılır.
- **Kapsamlı İstisnalar:** Aynı site içi gezintiler, manuel açılan sekmeler (`Ctrl+T`, yer imleri), arama motorları/sosyal akışlar (Google, Bing, Reddit, YouTube) ve kimlik/ödeme ağ geçitleri (Google OAuth, Apple ID, Microsoft, GitHub, Stripe, PayPal, İyzico, PayTR) asla engellenmez.
- **Anti-DevTools & Sağ Tık Engelleme Savunması:** Sitelerin `F12`, `Ctrl+Shift+I/J/C`, `Ctrl+U` kısayollarına ve sağ tık (`contextmenu`) menüsüne koyduğu `preventDefault()` engellerini yakalama (`capture`) fazında durdurarak tarayıcının yerel geliştirici araçlarının ve sağ tık menüsünün özgürce çalışmasını sağlar.
- **`about:blank` ve `srcdoc` Frame Koruması:** `all_frames: true`, `match_about_blank: true` ve `match_origin_as_fallback: true` ile dinamik oluşturulan tüm iframe'ler anında kalkan altına alınır.
- **Temiz `<iframe>` Kaçışını Engelleme:** `HTMLIFrameElement.prototype.contentWindow` ve `contentDocument` sarılarak iframe içine kaçıp `window.open` tetikleyen betikler etkisiz kılınır.
- **Kapalı Shadow DOM & Sahte Yükleme (Vignette) Temizleyici:** `attachShadow` kancası ve akıllı DOM tarayıcıyla "87% Yükleniyor... Devam etmek için dokunun / TAMAM" tarzı Monetag/PropellerAds sahte yükleme ekranları ve `z-index >= 99999` tam ekran perdeleri silinir; `body`/`html` kaydırma kilidi (`overflow`) otomatik açılır.

### 8. Evrensel Kozmetik Kural & Banner/Pageskin Temizleyici (v2.6.0)
- **İki Katmanlı Kozmetik Motor (`rules/cosmetic_rules.json`):**
  - **Evrensel Katman (`generic`):** Tüm sitelerde geçerli, site düzenini bozmayan 350+ güvenli genel reklam kapsayıcı seçicisi (`ins.adsbygoogle`, `[id^="div-gpt-ad"]`, `.ad-banner`, `.pageskin`, `.sticky-ad`, vb.).
  - **Siteye Özel Katman (`domains`):** AdGuard Turkish ve AdGuard Base filtrelerinden derlenmiş 23.900+ alan adına özel doğrulanmış CSS kuralları.
- **Akıllı DOM Tarayıcı (Debounced MutationObserver):**
  1. Sabit/kayan GIF ve WebP bahis/reklam banner'larını temizler.
  2. Standart IAB formatındaki reklam kutularını (`728x90`, `300x250`, `970x250`, `160x600`, vb.) tespit edip gizler.
  3. Yan duvar (pageskin / wallpaper) reklam kolonlarını ekrandan kaldırır.
  4. Oynatıcı üstünü kaplayan görünmez şeffaf tıklama katmanlarını (z-index >= 999) video akışına veya menülere dokunmadan temizler.
- **Boş Reklam Çerçevelerini Katlama:** Ağ kuralları ile engellenen boş `<iframe>` öğelerini otomatik olarak katlar (`height: 0 !important; min-height: 0 !important; display: none !important;`).

### 9. Modern Koyu Kontrol Paneli (`#0b1120`)
- Açık/kapalı durumlarını, aktif alan adının HTTPS protokol durumunu ve güvenlik rozetini tek bakışta gösterir.
- **Modüler Kalkan Anahtarları:** Reklam, URL temizleme, tehlike kalkanı, Twitch, YouTube ve Pop-up kalkanını bağımsız kontrol etme.
- **Açılır Özel Filtre Paneli:** URL ekleme, durum göstergeleri (+X kural yeşil / hata kırmızı), aç/kapat switch ve silme kontrolleri.
- **XSS Korumalı Mimari:** Kullanıcı girdileri yalnızca güvenli DOM API'leri (`document.createElement`, `textContent`) ile render edilir.
- **Tek Tıkla İstisna (Whitelist):** Güvenilen sitelerde korumayı tek tıkla duraklatma ve geri açma imkanı.

---

## 📦 Kurulum

### Yöntem 1: GitHub Releases ile Kurulum (Önerilen)
1. [Releases](https://github.com/Axthrowa/AX-Privacy/releases) sayfasından en son `ax-privacy-v3.2.3-chrome.zip` veya `ax-privacy-v3.2.3-firefox.zip` paketini indirin.
2. **Chrome / Brave / Edge:**
   - Eklentiler sayfasına gidin (`chrome://extensions`, `brave://extensions` veya `edge://extensions`).
   - **Geliştirici Modu (Developer mode)** anahtarını açın.
   - **Paketlenmemiş öğe yükle (Load unpacked)** butonuna tıklayın ve çıkarttığınız klasörü (veya `dist/chrome`) seçin.
3. **Mozilla Firefox:**
   - Adres çubuğuna `about:debugging#/runtime/this-firefox` yazın.
   - **Geçici Eklenti Yükle... (Load Temporary Add-on...)** butonuna tıklayın.
   - `dist/firefox/manifest.json` dosyasını (veya indirilen `.zip` dosyasını) seçin.

### Yöntem 2: Kaynak Koddan Doğrudan Kurulum
```bash
# Depoyu klonlayın
git clone https://github.com/Axthrowa/AX-Privacy.git
cd AX-Privacy

# Eklentiyi tarayıcıya ekleyin
# Chrome / Edge / Brave üzerinde "Paketlenmemiş öğe yükle" diyerek bu klasörü seçmeniz yeterlidir.
```

---

## 🔒 Gizlilik ve Güvenlik Garantisi

| Prensip | Uygulama Durumu |
| :--- | :--- |
| **Dış Ağ Bağlantısı** | **SIFIR.** Eklenti hiçbir analiz sunucusuna veya harici analitik servisine bağlanmaz. |
| **Kullanıcı Verisi** | Ziyaret edilen URL'ler, çerezler ve şifreler asla kaydedilmez ve paylaşılmaz. |
| **Minimum İzinler** | Yalnızca `declarativeNetRequest`, `storage`, `tabs`, `webNavigation` ve `<all_urls>` kullanılır. |
| **Şeffaflık** | %100 Açık Kaynak kodludur ve tüm kurallar denetlenebilir JSON dosyalarında tutulur. |

---

## 🛠️ Geliştirici ve Test Komutları

```bash
# Bağımlılıkları yükleyin
npm install

# Tüm test paketini çalıştırın (DNR doğrulama + Punycode + Twitch GQL + YouTube pruner + Filtre güncelleyici)
npm test

# EasyList ve OISD filtrelerini sıfırdan derleyin (25.000 limitli öncelikli model)
npm run build:rules

# Statik DNR kurallarının geçerliliğini test edin
npm run validate:rules

# Punycode Türkçe homograph tehdit motorunu test edin
npm run test:punycode

# Twitch GraphQL şema ve değişken geçerliliğini test edin
npm run test:twitch-gql

# YouTube JSON pruner temizleyicisini test edin
npm run test:youtube-pruner

# Çoklu format ve filtre güncelleyicisini test edin
npm run test:filter-updater

# Kozmetik kural derleyicisini ve Türkçe kuralları test edin
npm run test:cosmetic-compiler

# Pop-up, anti-vignette ve pop-under kalkanını test edin
npm run test:popup-vignette
```

---

## 📄 Lisans

Bu proje [GPL-3.0-or-later](LICENSE) lisansı altında korunmaktadır.
