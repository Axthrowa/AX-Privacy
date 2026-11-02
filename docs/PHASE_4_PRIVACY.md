# Phase 4: Gizlilik

Sürüm 0.4.0. Bu aşamada izleyici, çerez ve parmak izi koruması ile gizlilik ayarları eklendi. Siteyi bozabilecek her özellik varsayılan olarak kapalı.

## Modüller

| Modül                        | Nasıl çalışıyor                                                                                                                                                                                                                                                                               | Varsayılan |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Takip parametresi temizleme  | `$removeparam=ad` filtreleri DNR `redirect.transform.queryTransform.removeParams` kuralına derlenir (`network.ts`). Kaynak AdGuard URL Tracking listesi (2.515 kural) ve uBO listesindeki uygun satırlar. Varsayılan türler: belge, çerçeve, XHR                                              | Açık       |
| `$removeparam` istisnaları   | `@@...$removeparam=x` istisnası, o parametreyi kaldıran kurallara `excludedRequestDomains` olarak eklenir. İstisna dar bir URL için yazılmışsa bile tüm alan adına uygulanır; böylece hata, siteyi bozmamak yönünde olur                                                                      | —          |
| Üçüncü taraf çerez engeli    | Kontrol kuralı 3: `domainType: thirdParty` isteklerde `Cookie` ve `Set-Cookie` başlıkları silinir (`modifyHeaders`). Öncelik 100: liste istisnalarının üstünde, duraklatmanın (1.000.000) altında                                                                                             | Kapalı     |
| Çerez bildirimi listesi      | EasyList Cookie List statik kural kümesi ve gizleme motoru (1.788 DNR kuralı, 26.066 gizleme kuralı)                                                                                                                                                                                          | Kapalı     |
| Çerez bildirimi otomatik red | `@duckduckgo/autoconsent` 17.2.0 yalnızca `optOut` moduyla çalışır. Kurallar `consent-rules.json` dosyasından gelir ve çerçeve URL'sine göre süzülür. `eval` isteklerinde sayfanın gönderdiği kod yok sayılır; yalnızca kütüphanedeki adlandırılmış kod parçaları `executeScript` ile çalışır | Kapalı     |
| Parmak izi: Standart         | MAIN world, `document_start`, `matchOriginAsFallback`. Canvas `getImageData` / `toDataURL` / `toBlob`, WebGL `readPixels`, `AudioBuffer.getChannelData` / `copyFromChannel` ve `AnalyserNode.getFloatFrequencyData` çıktılarına site başına sabit gürültü ekler                               | Kapalı     |
| Parmak izi: Sıkı             | Standart seviyeye ek olarak `UNMASKED_VENDOR/RENDERER_WEBGL` genel değeri döndürür ve `hardwareConcurrency` en fazla 4 olur                                                                                                                                                                   | Kapalı     |
| Sayfa raporu (popup)         | `webRequest.onCompleted` ve `onErrorOccurred` yalnızca gözlem için kullanılır (engelleme yapmaz). Sekme başına alan adı, birinci/üçüncü taraf ayrımı, yüklenen ve `ERR_BLOCKED_BY_CLIENT` sayıları tutulur. Veri `storage.session`'da kalır, sekme kapanınca silinir                          | Açık       |

## Ölçülen gerçekler

- **Yönlendirme döngüsü yok:** `fbclid=` kalıbı `xfbclid=` ile de eşleşiyor. Brave 156, hiçbir şey değiştirmeyen dönüşümde yönlendirme yapmıyor (e2e testinde doğrulandı).
- **`about:blank` çerçeveleri korunuyor:** `matchOriginAsFallback` sayesinde gürültü, sonradan eklenen boş çerçevede de geçerli (e2e testinde doğrulandı).
- **Ses gürültüsü:** Göreli büyüklüğü 2e-6. float32 çözünürlüğü (~1,2e-7) bu farkı taşıyor, duyulabilir düzeyin ise çok altında. Testte toplam değerdeki sapma 1e-5'in altında kaldı.
- **Performans (`docs/runtime-baseline.json`):** AX 0.4.0 ile 6/6 reklam ve 7/7 izleyici engellendi. Ortanca yükleme süresi 34 ms, bellek 569 MB. 0.3.0'da bu değerler 39 ms ve 554 MB'tı.

## Desteklenmeyen veya eksik olanlar

| Konu                                                     | Neden                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regex `$removeparam` ve "tümünü sil" (`$removeparam`)    | DNR yalnızca tam parametre adıyla kaldırma yapabiliyor. AdGuard listesinden 96, uBO listesinden 42 kural raporlanıyor                                                                                                                           |
| `utm_source` / `utm_medium` / `utm_campaign`             | AdGuard URL Tracking listesi bunları bilerek kaldırmıyor; AX kendi kuralını eklemedi                                                                                                                                                            |
| Üçüncü taraf çerez engelinin gerçek başlık testi         | Yerel test sunucusu HTTP. `SameSite=None` için Secure (HTTPS) gerekiyor. Kural, Chromium'un kendi eşleştiricisiyle (`testMatchOutcome`) doğrulandı                                                                                              |
| İzleyici şirket/kategori bilgisi                         | Tracker Radar, Disconnect ve WhoTracks.me verileri ticari olmayan (NC) lisanslı; uygunluk doğrulanmadan kullanılmadı                                                                                                                            |
| Privacy Badger benzeri öğrenme                           | Bu aşamada yapılmadı                                                                                                                                                                                                                            |
| Çerez analizi ve kategorilendirme                        | `cookies` izni gerekiyor; şimdilik eklenmedi                                                                                                                                                                                                    |
| Yazı tipi, ekran, saat dilimi, WebRTC                    | Uygulanmadı. WebRTC için `privacy` API'si tarayıcı ayarını değiştirir; proje kuralı gereği ayrıca onay gerekir                                                                                                                                  |
| Parmak izi: Worker'lar, gizli anahtar, `toString` izleri | MAIN world betikleri Worker'larda çalışmıyor. Sayfaya eşzamanlı olarak gizli bir anahtar iletilemiyor; gürültü sitenin herkese açık bir fonksiyonu ve AX'e özel yazılmış bir betik onu geri alabilir. Sarmalanan fonksiyonlar tespit edilebilir |
| Balanced / Custom seviyeleri                             | Yalnızca Kapalı, Standart ve Sıkı var                                                                                                                                                                                                           |
| Sayfa raporundaki "engellendi" sayısı                    | `ERR_BLOCKED_BY_CLIENT` başka eklentilerden veya Brave Shields'ten de gelebiliyor; arayüz bunu açıkça belirtiyor                                                                                                                                |

## Lisanslar

| Bileşen                 | Kaynak                                                       | Lisans                          |
| ----------------------- | ------------------------------------------------------------ | ------------------------------- |
| AdGuard URL Tracking    | `https://filters.adtidy.org/extension/ublock/filters/17.txt` | GPL-3.0                         |
| EasyList Cookie List    | `https://secure.fanboy.co.nz/fanboy-cookiemonster.txt`       | GPL-3.0-or-later / CC BY-SA 3.0 |
| @duckduckgo/autoconsent | npm 17.2.0 (`compact-rules.json` dahil)                      | MPL-2.0, değiştirilmedi         |

## Testler

- **Birim (Vitest), 15 dosya, 94 test:** `$removeparam` derleyicisi ve istisnaları, kota (4.900 yönlendirme kuralı), çerez kontrol kuralı, içerik betiği kaydı, gizlilik ayarlarının normalleştirilmesi ve mesaj doğrulaması. `autoconsent` köprüsü test ediliyor: gerçek kurallarla `init`, kod parçası beyaz listesi, asla `optIn` yapılmaması. `TabReports` için sayım, servis çalışanı yeniden başlatma ve gezinmede sıfırlama da test ediliyor.
- **E2E (Playwright + Brave 156), 19 test:** Bunların 6'sı yeni (`e2e/privacy.spec.ts`):
  - Parametre temizleme, döngü olmaması ve XHR.
  - Çerez kuralının aç/kapat davranışı.
  - `123inkt` banner'ında "Reddet"e basılması ve sonucun raporlanması.
  - Sayfa raporu.
  - Gürültünün sitede kararlı, siteler arasında farklı olması ve `about:blank` çerçevesi.
  - Sıkı seviye.
- `web-ext lint`: 0 hata. 3 uyarı öncekiyle aynı (React `innerHTML` ×2, EasyPrivacy coinminer yanlış pozitifi). `npm audit`: 0 açık.
