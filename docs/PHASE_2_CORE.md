# Phase 2 — Core Extension

## Ne çalışıyor

| Parça                       | Dosya                                     | Davranış                                                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest                    | `public/manifest.json`                    | MV3. İzinler: `declarativeNetRequest`, `storage`, `scripting`, `tabs`; host: http/https. `externally_connectable` yok. CSP: `script-src 'self'`                                                                                                    |
| Build                       | `scripts/build.ts`, `scripts/manifest.ts` | `dist/chrome` ve `dist/firefox` (gecko id, Firefox ≥ 140). Content script'ler bağımsız IIFE olarak derleniyor                                                                                                                                      |
| Service worker              | `src/background/index.ts`                 | Kurulumda ayarları tarayıcıya uygular. Sekme rozeti: duraklatılmış veya kapalı sitede `OFF`                                                                                                                                                        |
| Mesaj yönlendirici          | `src/background/router.ts`                | Yazma işlemleri sırayla çalışır (eşzamanlı güncellemede kayıp olmaz). Content script'ler yalnızca `cosmetic/get` gönderebilir                                                                                                                      |
| Mesaj sözleşmesi            | `src/shared/messages.ts`                  | Tip güvenli `send()`. Gelen her mesaj `parseMessage` ile doğrulanır, fazla alanlar atılır. Gönderen sınıflandırması: eklenti sayfası / content script / reddet                                                                                     |
| Site anahtarı               | `src/shared/url.ts`, `src/shared/site.ts` | eTLD+1 (`tldts`, private suffix dahil). Content script paketine `tldts` girmez                                                                                                                                                                     |
| Duraklatma / global kapatma | `src/engines/core/control.ts`             | DNR dinamik `allowAllRequests` kuralları (ID 1 ve 2, öncelik 1.000.000; Phase 3'te 2³⁰'un Chromium'da sessizce etkisiz kaldığı ölçüldü ve düzeltildi). Content script `excludeMatches` güncellenir. Cloudflare challenge sayfaları her zaman hariç |
| Content script altyapısı    | `src/content/cosmetic.ts`                 | `scripting.registerContentScripts` ile dinamik kayıt, `document_start`, tüm frame'ler. Arka plandan siteye özel CSS alır                                                                                                                           |
| Özel gizleme kuralları      | `src/engines/adblock/cosmetic.ts`         | `domain##seçici`, `##seçici`, `domain#@#seçici`. CSS enjeksiyonu (`{` `}`), negatif alan adı ve genişletilmiş sözdizimi gerekçesiyle reddedilir. Her seçici ayrı CSS kuralı olarak yazılır                                                         |
| Ayarlar                     | `src/storage/settings.ts`                 | `storage.local`. Bozuk veya eksik alanlar varsayılana döner                                                                                                                                                                                        |
| IndexedDB                   | `src/storage/db.ts`                       | `engines` (ikili motor blob'ları) ve `stats` (gün × kategori sayaçları, budama). İlk kullanıcıları Phase 3 (cosmetic motor) ve Phase 7 (istatistik)                                                                                                |
| Popup                       | `src/dashboard/popup.tsx`                 | Site adı, "Bu sitede koruma", "Tüm koruma", kontrol paneli bağlantısı. Değişiklikten sonra sekme yenilenir                                                                                                                                         |
| Kontrol paneli              | `src/dashboard/dashboard.tsx`             | Genel koruma, duraklatılan siteler (geri açma), özel gizleme kuralları (reddedilen satırlar gerekçeleriyle), tarayıcı tespiti                                                                                                                      |
| Brave tespiti               | `src/dashboard/brave.ts`                  | `navigator.brave.isBrave()` ile eklenti sayfasından                                                                                                                                                                                                |

## Komutlar

```
npm run build       dist/chrome + dist/firefox
npm run check       tsc + eslint + prettier + vitest
npm run e2e         Brave'de geçici profille uçtan uca test (önce build)
node e2e/baseline.ts  Phase 0 çalışma zamanı ölçümü
```

Brave'e yükleme: `brave://extensions` → Geliştirici modu → "Paketlenmemiş öğe yükle" → `dist/chrome`.

## Doğrulama (2026-11-01)

- `tsc --noEmit`: 0 hata.
- ESLint: 0 hata.
- Prettier: temiz.
- Vitest: 8 dosya, 38 test geçti.
- Playwright + Brave 1.98.63 (headless, geçici profil): 5/5 geçti.
  - Service worker açılıyor ve content script kaydediliyor.
  - Panelden eklenen kural öğeyi gizliyor; geçersiz satır gerekçesiyle gösteriliyor.
  - Duraklatma; DNR kuralını, `excludeMatches` değerini ve `OFF` rozetini doğru kuruyor; kural kaldırılınca gizleme geri geliyor.
  - Popup'taki global anahtar kuralları ve kayıtları kapatıp geri açıyor.
  - Brave tespiti çalışıyor.
  - Web sayfası eklentiye mesaj gönderemiyor.
- `web-ext lint` (Firefox): 0 hata, 2 uyarı. Uyarıların ikisi de React DOM'un kendi `innerHTML` kullanımından geliyor (Vite paylaşılan React parçasını `Toggle-*.js` olarak adlandırıyor). Firefox'ta çalışma zamanı testi yapılmadı.
- `npm audit`: 0 açık (ESLint'in `minimatch` bağımlılığı `overrides` ile ≥ 11.0.1'e sabitlendi).

## Bilinen sınırlar

- Duraklatma ve global kapatma açık sekmelere ancak yenilemeyle uygulanır (DNR `allowAllRequests` gezinme anında değerlendirilir). Popup bu yüzden sekmeyi yeniliyor.
- Özel kurallarda henüz negatif alan adı (`~`) ve prosedürel seçiciler yok. Bunlar Phase 3'teki cosmetic motorla gelecek.
- Arka plan paketi 272 KB. Bunun büyük kısmı `tldts`'in public suffix listesi.
