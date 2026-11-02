# Phase 3: Reklam engelleme

Sürüm 0.3.0. Bu belgedeki tüm sayılar `npm run filters` çıktısı, `npm run check`, Playwright ve `e2e/baseline.ts` ölçümlerinden alınmıştır.

## Ne çalışıyor

| Bileşen                   | Dosya                                                           | Mekanizma                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kural derleyici           | `src/engines/adblock/network.ts`                                | ABP/uBO/AdGuard ağ filtresi → DNR kuralı. `$badfilter`, `$important`, istisnalar, tür/yöntem/taraf/alan seçenekleri, `\|\|alan^` kurallarını `requestDomains` altında birleştirme. Çeviremediğini nedeniyle sayar |
| Ön işleyici               | `src/filters/preprocess.ts`                                     | `!#if/!#else/!#endif` (Chromium MV3 ortamı) ve aynı kaynaktan `!#include`                                                                                                                                         |
| Derleme betiği            | `scripts/filters.ts`                                            | Listeleri indirir (3 deneme), `public/rulesets/<id>.json` (DNR), `<id>.popup.json`, `public/engines/<id>.bin` (cosmetic motor) ve `meta.json` üretir                                                              |
| Filter engine (ağ)        | `public/manifest.json` → `declarative_net_request`              | 4 statik ruleset, varsayılan açık                                                                                                                                                                                 |
| Filter engine (gizleme)   | `src/background/filters.ts`, `src/background/cosmetic.ts`       | Açık listelerin motorları birleştirilip önbelleğe alınır. Sayfa açılışında genel + site kuralları, sonra sayfadaki class/id/href'lere göre kurallar `insertCSS` (USER origin) ile enjekte edilir                  |
| Element hiding (gelişmiş) | `src/content/cosmetic.ts`                                       | `:has-text`, `:upward`, `:remove` gibi seçiciler sayfada değerlendirilir; DOM değiştikçe yeniden uygulanır                                                                                                        |
| Popup koruması            | `src/engines/popup/matcher.ts`, `src/background/popup-guard.ts` | `$popup` filtreleri DNR'de yok. Yeni sekmenin adresi açan çerçeveye göre eşleşirse sekme kapanır. Orta tık, Ctrl/⌘ tık ve sağ tık → "yeni sekmede aç" ile açılanlara dokunulmaz                                   |
| Filter list manager       | `src/background/filters.ts`, `src/dashboard/Lists.tsx`          | Liste aç/kapat (`updateEnabledRulesets`), kalan statik kota, kullanıcı listesi ekle/kaldır/aç-kapat/güncelle                                                                                                      |
| Custom filters            | `src/filters/custom.ts`, `src/filters/dynamic.ts`               | Tek kutuda ağ + gizleme kuralları. Ağ kuralları dinamik DNR'ye (ID ≥ 1000, en fazla 29.000, regex ≤ 1.000 ve `isRegexSupported` ile doğrulanır), gizleme kuralları cosmetic motora                                |
| Ayar göçü                 | `src/storage/settings.ts`                                       | Ayar sürümü 2. Sürüm 1'deki `customCosmetic` → `customRules`                                                                                                                                                      |
| IndexedDB                 | `src/storage/db.ts`                                             | Sürüm 2: `lists` deposu (kullanıcı listesi metni, hata, istatistik), `engines` deposunda kullanıcı listesi motorları                                                                                              |

### Kullanıcı listesi güvenliği

- Yalnızca `https://` kabul edilir; test için `http://localhost` ve `http://127.0.0.1` da kabul edilir. Yönlendirme sonrası adres de aynı kurala tabidir.
- En fazla 10 MB ve 20 liste. 30 saniye zaman aşımı. Çerez gönderilmez (`credentials: 'omit'`).
- HTML dönen yanıt reddedilir.
- Listeden gelen `+js(...)` betikleri, HTML filtreleri ve `{ }` içeren (keyfî CSS enjekte edebilecek) kurallar atılır. Uzaktan kod çalıştırılmaz.

## Derleme sonuçları (1 Kasım 2026)

| Liste          | Sürüm                    | Ağ filtresi dönüştürülen | DNR kuralı | Popup | Gizleme | Başlıca desteklenmeyenler                                                   |
| -------------- | ------------------------ | ------------------------ | ---------- | ----- | ------- | --------------------------------------------------------------------------- |
| EasyList       | 202611011110             | 51.192 / 51.802 (%98,8)  | 3.715      | 2.961 | 24.900  | document-block 576, regex 22, rewrite 7                                     |
| EasyPrivacy    | 202611011110             | 56.397 / 56.413 (%99,97) | 9.117      | 0     | 37      | regex 7, domain 3                                                           |
| uBlock filters | 26 Eki 2026 (+9 include) | 4.413 / 5.547 (%79,6)    | 3.598      | 53    | 17.792  | redirect-rule 371, domain 255, regex 201, document-block 66, removeparam 42 |
| AdGuard Türkçe | 2.0.69.40                | 1.616 / 1.675 (%96,5)    | 1.396      | 4     | 5.087   | domain 26, regex 21                                                         |

Toplam 17.826 statik DNR kuralı. Bu, uzantı başına garanti edilen 30.000 kuralın altında kalıyor. Cosmetic motor dosyaları: 1.084 KB, 10 KB, 1.429 KB ve 401 KB.

## Test sonuçları

- `npm run check` (TypeScript, ESLint, Prettier, Vitest): 13 dosyada 77 test geçti.
  - Derleyici, ön işleyici, özel kural ayrıştırma, dinamik kota, popup eşleştirici, gerçek EasyList motoru, ayar göçü, mesaj doğrulama, router ve manifest testleri.
- Playwright (Brave 156, geçici profil, Shields kapalı, sahte alan adları yerel sunucuya yönlendirilmiş): 13/13 geçti.
  - Gerçek tracker adresi (googletagmanager) statik listeyle engelleniyor.
  - Liste kapatılınca istek geçiyor, açılınca yine engelleniyor.
  - EasyList genel gizleme kuralı sayfadaki class'a göre uygulanıyor.
  - Özel ağ, `$redirect`, genel ve `:has-text` kuralları etkili; `+js` reddediliyor.
  - Kullanıcı listesi ekleniyor, engelliyor, kaldırılınca etkisi bitiyor.
  - Popup: düz tıkla açılan `$popup` hedefi kapanıyor; başka adres, Ctrl+tık ve orta tık ile açılanlar açık kalıyor.
  - Global kapatma ve site duraklatma ağ engellemesini gerçekten kaldırıyor.
- `web-ext lint` (Firefox çıktısı): 0 hata, 3 uyarı.
  - 2 uyarı React DOM içindeki `innerHTML` kullanımından geliyor.
  - 1 uyarı "coin miner" yanlış pozitifi: EasyPrivacy madenci alan adlarını engellemek için listeliyor.

### Çalışma zamanı ölçümü (`docs/runtime-baseline.json`, 5 tekrar, medyan)

| Yapılandırma             | Reklam | Tracker | 1. taraf bozulan | Gizlenen öğe | Yükleme | Bellek   |
| ------------------------ | ------ | ------- | ---------------- | ------------ | ------- | -------- |
| Hiçbiri (Shields kapalı) | 0/6    | 0/7     | 0                | 0/4          | 43 ms   | 400 MB   |
| **AX 0.3.0**             | 6/6    | 7/7     | 0                | 1/4          | 39 ms   | 554 MB   |
| uBO Lite                 | 6/6    | 7/7     | 0                | 0/4          | 43 ms   | 544 MB   |
| AdGuard                  | 3/6    | 0/7     | 0                | 1/4          | 56 ms   | 1.089 MB |
| Beş engelleyici birlikte | 6/6    | 7/7     | 0                | 1/4          | 113 ms  | 2.358 MB |

Gizleme ölçümünde 4 öğeden 3'ü (`.ad-banner`, `.sponsored-content`, veri özniteliksiz `ins.adsbygoogle`) için listelerde kural yok. Örneğin EasyList yalnızca `ins.adsbygoogle[data-ad-client]` gibi daha dar seçiciler içeriyor. Sonuç bu yüzden 1/4. Bu, ölçüm için kural eklenerek yükseltilmedi.

## Bu aşamada bulunan ve düzeltilen hatalar

1. **Kontrol kuralı önceliği (Phase 2 hatası):**
   - Chromium DNR önceliğini 8 bit kaydırıp 32 bitlik bir anahtarda saklıyor. 2²⁴ ve üzeri öncelikler sessizce etkisiz kalıyor; bu, beş öncelik değeriyle ölçüldü.
   - Duraklatma ve global kapatma kuralları 2³⁰ kullandığı için ağ engellemesini aslında kaldırmıyordu. Phase 2 testleri yalnızca kuralın varlığını kontrol ediyordu.
   - Öncelik 1.000.000'a indirildi. Hem sınır için birim testi hem etki için E2E testi eklendi.
2. **`$elemhide` / `$generichide` istisnaları:** Cosmetic motor ağ filtrelerini yüklemediği için bu istisnalar düşüyordu. Artık motor yalnızca gizleme satırlarını ve bu istisnaları alıyor.
3. **Uzantı dosyasına yönlendirme (`$redirect=noopjs` vb.):**
   - Brave 156'da `extensionPath` yönlendirmesi kural eşleşmesine rağmen uygulanmadı. Denenenler: http ve https sayfa, headless ve görünür pencere, dinamik URL açık ve kapalı, glob ve açık dosya listesi. URL yönlendirmesi ise çalıştı.
   - Doğrulanamayan özellik bırakılmadı. uBO'nun yönlendiremediğinde yaptığı gibi `$redirect` filtreleri düz engelleme kuralına çevriliyor. `redirects/` dosyaları ve `web_accessible_resources` kaldırıldı; bunun bir yan etkisi, sayfaların uzantıyı bu dosyalarla tespit edememesi.

## Eksikler ve MV3 sınırları

| Özellik                                                         | Durum                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+js(...)` scriptlet'ler                                        | Phase 6 (paket içi kütüphaneyle). Şu an reddediliyor ve nedeni gösteriliyor                                                                         |
| `$document` ile sayfayı tamamen engelleme (strict block)        | Phase 5 (uyarı sayfasıyla)                                                                                                                          |
| `$redirect-rule`, `$removeparam`, `$csp`, `$header`, `$rewrite` | DNR ile birebir ifade edilemiyor; çevrilmiyor, sayılıyor                                                                                            |
| Statik listelerde regex                                         | Statik rulesetlerde derleme zamanında doğrulanamadığı için alınmıyor; özel kurallarda ve kullanıcı listelerinde `isRegexSupported` ile alınıyor     |
| Joker/regex alan adları (`domain=*.x`, `domain=/re/`)           | DNR karşılığı yok                                                                                                                                   |
| Paket içi listelerin güncellenmesi                              | MV3 statik rulesetleri yalnızca eklenti güncellemesiyle değişir. Kullanıcı listeleri "Tümünü güncelle" ile elle güncellenir; otomatik zamanlama yok |
| AdGuard `#?#` / `#$#` söz dizimi                                | Ghostery motoru desteklemiyor; uBO karşılığı `##...:has()` kullanılmalı                                                                             |
| Engellenen istek sayıları                                       | Phase 7 (`getMatchedRules` / feedback izni). Şu an sahte sayaç yok                                                                                  |

## Üçüncü taraf listeler ve atıf

Listeler değiştirilmeden derlenir. Kaynak ve lisans bilgisi dashboard'da her listenin altında da gösterilir.

| Liste                     | Kaynak                                                     | Lisans                          | Not                                                                       |
| ------------------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------- |
| EasyList                  | https://easylist.to/easylist/easylist.txt                  | GPL-3.0-or-later / CC BY-SA 3.0 | © The EasyList authors                                                    |
| EasyPrivacy               | https://easylist.to/easylist/easyprivacy.txt               | GPL-3.0-or-later / CC BY-SA 3.0 | © The EasyList authors                                                    |
| uBlock filters            | https://ublockorigin.github.io/uAssets/filters/filters.txt | GPL-3.0                         | © Raymond Hill ve uAssets katkıcıları; `!#include` dosyaları aynı depodan |
| AdGuard Türkçe filtresi   | https://filters.adtidy.org/extension/ublock/filters/13.txt | GPL-3.0                         | © AdGuard Software Ltd. ve katkıcılar                                     |
| Ghostery adblocker motoru | npm `@ghostery/adblocker*` 2.20.3                          | MPL-2.0                         | Kütüphane olarak kullanılıyor, değiştirilmedi                             |

AX GPL-3.0-or-later olduğu için GPL listelerin paketlenmesi uyumlu. CC BY-SA 3.0 seçeneği için atıf bu tablo ve dashboard ile sağlanıyor.

## Komutlar

```
npm run filters            # listeleri indir ve derle (--offline: filters-cache/ kullan)
npm run build              # dist/chrome ve dist/firefox
npm run check              # tsc + eslint + prettier + vitest
npx playwright test        # Brave ile uçtan uca testler
node e2e/baseline.ts       # çalışma zamanı karşılaştırması
```
