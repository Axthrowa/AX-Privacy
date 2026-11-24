# AX Privacy

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Version](https://img.shields.io/badge/version-5.0.0-0284c7.svg?style=flat-square)](package.json)
[![Zero Telemetry](https://img.shields.io/badge/telemetry-0%25-emerald.svg?style=flat-square)](#gizlilik)
[![License](https://img.shields.io/badge/license-GPL--3.0-amber.svg?style=flat-square)](LICENSE)

Chromium tabanlı tarayıcılar (Brave, Chrome, Edge) ve Firefox için Manifest V3 reklam, izleyici ve pop-up engelleyici. Her şey tarayıcının içinde çalışır: hesap yok, telemetri yok, sunucu yok.

5.0'daki değişikliklerin tamamı: [CHANGELOG.md](CHANGELOG.md).

## Özellikler

### Engelleme

- Tarayıcının kendi `declarativeNetRequest` motoru: EasyList, EasyPrivacy, uBlock (filters, unbreak, quick fixes, privacy, badware, resource abuse), Peter Lowe, AdGuard Türkçe, AdGuard URL izleme ve URLhaus listelerinden derlenmiş statik kural setleri. Çerez bildirimi ve pop-up listeleri isteğe bağlı.
- Varsayılan listeler tarayıcının garanti ettiği 30.000 statik kural sınırına sığdırılır; sığmazsa en az görülen kurallar atılır.
- Kozmetik filtreleme, scriptlet'ler (`trusted-*`, `json-edit-*` ailesi dahil) ve yerel surrogate dosyaları. Liste güncellemeleri uzaktan kod getirmez, yalnız veri.
- Pop-up ve pop-under kalkanı: yalnız bilinen reklam ağlarına veya pop-under imzalarına giden sekmeler kapanır. Orta tık ve Ctrl/Cmd+tık serbesttir.
- Gelişmiş mod: site × üçüncü taraf × tür dinamik kural matrisi.
- Öğe seçici (aynı kaynaklı iframe'ler dahil) ve satır satır hata gösteren kural editörü.

### AX-Brain (yerel öğrenen katman)

- 48 özellikli öğe puanlama ve paketle gelen küçük bir MLP (48 → 32 → 1, saf TypeScript, ağ isteği yok).
- Ağırlıklar çevrimdışı eğitilir ve yalnız siteye göre ayrılmış test setinde kalite kapısını geçerse pakete girer: kesinlik ≥ %98, yanlış gizleme ≤ %0,5. 5.0 ağırlıkları: kesinlik %98,8, yanlış gizleme %0,036, duyarlılık %49.
- Kullanıcının kendi işaretlemeleri yalnız kişisel bir başlığı eğitir; paketteki ağırlıklar değişmez.
- Ağ davranışından izleyici öğrenimi (isteğe bağlı `webRequest` izniyle) ve isteğe bağlı cihaz içi Gemini Nano hakemi.
- Her gizleme açıklanabilir ve tek tek geri alınabilir; bozulma bekçisi sayfayı bozan gizlemeyi geri çeker.

### Gizlilik

- URL takip parametresi temizleme, üçüncü taraf çerez silme, çerez bildirimi reddi, WebRTC IP sızıntısı koruması, parmak izi gürültüsü.
- Profiller: Dengeli, Sıkı ve Paranoyak (üçüncü taraf betikler engellenir, site başına izin popup'tan).
- Homograph (taklit alan adı) uyarısı.

### Video

- YouTube: oynatıcı yanıtlarından reklam alanlarını siler, sızan reklamı atlar; isteğe bağlı SponsorBlock.
- Twitch reklam akışı kalkanı.
- Türk yayın sitelerinde video reklam isteklerinin canlı denetimi: `e2e/tr-video-check.ts` (son sonuç [docs/tr-video-check.json](docs/tr-video-check.json)).

### Arayüz

- Popup: site duraklatma, genel kalkan anahtarları, sayfa raporu ve adım adım "siteyi düzelt" sihirbazı.
- Panel: genel bakış (engellenen istek, tasarruf edilen veri ve süre tahmini), listeler (bölge ve son güncelleme), gizlilik, gelişmiş, AX-Brain ve filtre günlüğü (isteğe bağlı izinle).
- Türkçe ve İngilizce.

## Kurulum

Zip'leri [Releases](https://github.com/Axthrowa/AX-Privacy/releases) sayfasından indirin: `ax-privacy-5.0.0-chrome.zip` veya `ax-privacy-5.0.0-firefox.zip`. Zip'i açın; `manifest.json` klasörün kökünde olmalı.

**Brave / Chrome / Edge** (Chromium 121+):

1. `brave://extensions`, `chrome://extensions` veya `edge://extensions` açın.
2. Geliştirici modunu açın.
3. "Paketlenmemiş öğe yükle" ile açtığınız klasörü seçin.

**Firefox** (140+, Android 142+):

1. `about:debugging#/runtime/this-firefox` açın.
2. "Geçici eklenti yükle" ile klasördeki `manifest.json` dosyasını seçin. Geçici yükleme Firefox kapanınca kalkar; kalıcı kurulum Mozilla imzası ister.

Ayrıntı: [docs/KURULUM.md](docs/KURULUM.md).

## Gizlilik

| İlke | Durum |
| :--- | :--- |
| Telemetri | Yok. E2E testi, gezinme, popup ve panel boyunca eklentinin hiçbir dış adrese istek atmadığını doğrular. |
| Dış bağlantı | Yalnız ayarlarda açık olan filtre listelerinin güncellemesi. |
| Veri | Ziyaret edilen adresler ve çerezler dışarı gönderilmez; AX-Brain verisi yerel depoda kalır. |
| İzinler | `activeTab`, `alarms`, `browsingData`, `declarativeNetRequest`, `offscreen`, `privacy`, `storage`, `scripting`, `tabs`, `webNavigation` ve tüm siteler. `webRequest` ve `declarativeNetRequestFeedback` isteğe bağlı; yalnız kullanıcı açınca istenir. |

Ayrıntı: [docs/PRIVACY.md](docs/PRIVACY.md).

## Geliştirme

```bash
npm install
npm run filters:offline   # filters-cache/ içinden kural setlerini derler (npm run filters: listeleri indirir)
npm run build             # dist/chrome ve dist/firefox
npm run check             # tsc + eslint + prettier + vitest
npm run e2e               # Playwright uçtan uca testleri (Brave)
npm run pack              # dist/ax-privacy-<sürüm>-{chrome,firefox}.zip
npm run release           # listeleri indir, derle, denetle, paketle
```

Mimari: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). v4 JavaScript hattı `legacy/` klasöründe arşivlidir; derlenmez ve test edilmez.

## Lisans

[GPL-3.0-or-later](LICENSE).
