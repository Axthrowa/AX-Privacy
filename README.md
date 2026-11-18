# AX Privacy

Chromium (Brave, Chrome, Edge) ve Firefox için Manifest V3 reklam ve izleyici engelleyici. Her şey tarayıcıda çalışır: hesap yok, telemetri yok, AX'in kendi sunucusu yok.

Sürüm 1.0.0. Mağazada yayımlanmıyor; kişisel kullanım için paketsiz kurulur.

## Neler yapar

**Reklam ve izleyiciler**

- Ağ filtreleri tarayıcının kendi `declarativeNetRequest` motoruyla çalışır; sayfa yüklenirken AX'in service worker'ı uyanmaz.
- Varsayılan listeler: EasyList, EasyPrivacy, uBlock filtreleri (Unbreak, Quick fixes, Privacy, Badware dahil), Brave Unbreak, Peter Lowe, AdGuard Türkçe, AdGuard URL Tracking ve URLhaus. Çerez bildirimi ve açılır pencere listeleri isteğe bağlı.
- Kozmetik filtreler ve scriptlet'ler, engellenen reklam betiklerinin yerine sahte (surrogate) betikler, açılır reklam sekmelerinin durdurulması.
- Öğe seçici, kendi kurallarınız ve https adresinden en fazla 20 ek liste.
- Paketle gelen listeler 12 saatte bir güncellenir (kapatılabilir).

**Video**

- YouTube reklamlarını kaldırma, otomatik "Geç", sponsorlu kartları işaretleme veya gizleme; engelleyici uyarısı çıkarsa geri çekilme.
- Twitch reklamları.
- İsteğe bağlı: kaldırılamayan reklamları sessize alma veya 16 kat hızlı oynatma, genel oynatıcılarda (JW Player, HLS/DASH) reklam katmanı, SponsorBlock (kategori başına kapalı, yalnızca göster, sorarak veya otomatik atla; yanlış atlamayı geri alma; kanal istisnası).

**Gizlilik**

- Çerez bildirimlerini otomatik reddetme (autoconsent; asla kabul etmez).
- Parmak izi gürültüsü (Standart veya Sıkı), Global Privacy Control, Client Hints kısıtlama.
- Bağlantılardaki izleme parametrelerini (`utm_*`, `fbclid`, `gclid`...) temizleme, `<a ping>` kapatma.
- Tarayıcının reklam API'lerini (Topics, Protected Audience, Attribution) kapatma, WebRTC'de yerel IP gizleme.
- Hazır profiller: Dengeli, Sıkı, Özel.
- İsteğe bağlı: üçüncü taraf çerezleri engelleme, Facebook/X/Disqus gömülerini tıklayınca yükleme, sekme kapanınca açık olmayan sitelerin verisini silme (Firefox'ta yok).

**Güvenlik**

- Kötü amaçlı adres listelerindeki sayfalarda uyarı sayfası; "yine de devam et" tarayıcı oturumu boyunca geçerli.
- Düz http üzerinden parola alanı uyarısı.

**Panel**

- Site başına modül açma/kapama ve süreli duraklatma.
- Bozulan site için adım adım gevşetme sihirbazı.
- 30 günlük sayaçlar, ayrıntılı sekme raporu (isteğe bağlı), ayar yedeği.
- Türkçe ve İngilizce arayüz, açık ve koyu tema.

Bozulma riski taşıyan her özellik varsayılan olarak kapalıdır.

## Kurulum

Aşağıdaki gibi derleyin; `dist/chrome` veya `dist/firefox` klasörünü ya da `npm run pack` ile çıkan zip'in açılmış halini yükleyin. Klasörün en üstünde `manifest.json` olmalı.

**Brave, Chrome, Edge** (Chromium 121 ve üstü)

1. `brave://extensions`, `chrome://extensions` veya `edge://extensions` sayfasını açın.
2. Geliştirici modunu açın.
3. "Paketlenmemiş öğe yükle" deyip klasörü seçin.

Güncellemek için klasörü yenisiyle değiştirip eklentiler sayfasında yenile düğmesine basın.

**Firefox** (140 ve üstü)

1. `about:debugging#/runtime/this-firefox` sayfasını açın.
2. "Geçici eklenti yükle" deyip klasördeki `manifest.json` dosyasını seçin.

Paket imzalı olmadığı için geçici yükleme Firefox kapanınca kalkar.

## Derleme

Node.js 24 veya üstü gerekir.

```bash
npm ci
```

```bash
npm run build
```

`dist/chrome` ve `dist/firefox` klasörleri oluşur. Zip için:

```bash
npm run pack
```

Filtre listelerini kaynaklarından indirip yeniden derlemek için:

```bash
npm run filters
```

## Testler

| Komut                    | Ne yapar                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `npm run check`          | Typecheck, lint, biçim kontrolü ve birim testleri                   |
| `npm run e2e`            | Brave'de uçtan uca testler (yerel sayfalarla)                       |
| `npm run e2e:firefox`    | Firefox'ta temel akış testleri                                      |
| `npm run sites`          | Gerçek sitelerde bozulma kontrolü (ekran görüntüsü karşılaştırmalı) |
| `npm run live-check`     | Canlı YouTube ve Twitch kontrolü                                    |
| `npm run resource-check` | Gezinirken service worker'ın ne kadar uyanık kaldığı                |

Ölçüm sonuçları `docs/` altındaki JSON dosyalarında durur. Son ölçümde 120 saniyelik gezinmede worker zamanın %41'inde açıktı.

## Gizlilik

AX gezinme sırasında hiçbir sunucuya istek atmaz. Dışarı giden istekler yalnızca şunlardır:

- Filtre listesi güncellemeleri: listenin kendi sunucusuna, çerez ve referrer olmadan.
- Eklediğiniz listeler: o adrese.
- SponsorBlock (açarsanız): video kimliğinin SHA-256 özetinin yalnızca ilk 4 karakteri.

Ayarlar, sayaçlar ve raporlar tarayıcıda kalır. Gizli pencerelerdeki sayfalar kaydedilmez.

## İzinler

| İzin                                 | Neden                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| `declarativeNetRequest`              | Ağ filtreleri                                                  |
| `scripting`, tüm siteler             | Kozmetik filtreler, scriptlet'ler, video ve gizlilik betikleri |
| `storage`                            | Ayarlar, önbellek, sayaçlar                                    |
| `tabs`, `webNavigation`, `activeTab` | Site başına durum, açılır pencere ve uyarı sayfası             |
| `webRequest`                         | Yalnızca ayrıntılı sekme raporu açıkken                        |
| `privacy`                            | WebRTC ve tarayıcı reklam API'leri                             |
| `browsingData`                       | Yalnızca site verisi silme açıkken                             |
| `alarms`                             | Liste güncellemesi ve süreli duraklatma                        |

## Lisans

GPL-3.0-or-later. Kullanılan kütüphaneler ve filtre listeleri kendi lisanslarıyla gelir (`@ghostery/adblocker` ve `@duckduckgo/autoconsent` MPL-2.0; listeler kaynaklarındaki lisanslarla).
