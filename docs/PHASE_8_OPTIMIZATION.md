# Phase 8: Optimizasyon

Sürüm 0.8.0. Amaç sahte hız iddiası değil: service worker’ın aynı işi tekrar yazmasını kesmek ve ölçülen sayıları belgelemek.

## Yapılanlar

| Konu                     | Ne değişti                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kontrol DNR              | `apply()` kural JSON’u `storage.session` parmak iziyle aynıysa `updateDynamicRules` çağırmaz                                                     |
| İçerik betikleri         | Kayıt imzası değişmediyse `unregister`/`register` yok. Parmak izi oturumda; SW uyanınca da atlanır                                               |
| Dinamik filtre kuralları | `applyFilters` derlenen kural yükü aynıysa DNR’yi yeniden yazmaz. Statik ruleset aç/kapa zaten farkı alır                                        |
| Cosmetic / popup / belge | Motor önbelleği yalnızca liste+özel kural anahtarı değişince düşer                                                                               |
| İstatistik yazımı        | Bir günün tüm anahtarları tek IndexedDB işleminde (`addStats`)                                                                                   |
| Sınıflama                | `testMatchOutcome` sonucu URL+tür için en fazla 500 girdi önbellekte. Liste uygulanınca önbellek silinir                                         |
| Kural derleme            | `compileList` aynı `\|\|alan^` satırlarını `requestDomains` altında birleştirir (Phase 3’ten). Bu aşamada ek derleyici yok; tekrar yazım kesildi |

## Ölçüm

Kaynak: `e2e/baseline.ts` → `docs/runtime-baseline.json` (5 tekrar, medyan). AX sütunu bu aşamada yeniden ölçülür; önceki sürümler aynı betiğin o günkü çıktısıdır.

| Sürüm | Reklam | İzleyici | Ortanca yükleme | Bellek |
| ----- | ------ | -------- | --------------- | ------ |
| 0.4.0 | 6/6    | 7/7      | 34 ms           | 569 MB |
| 0.5.0 | 6/6    | 7/7      | 30 ms           | 563 MB |
| 0.6.0 | 6/6    | 7/7      | 27 ms           | 541 MB |
| 0.8.0 | 6/6    | 7/7      | 24 ms           | 540 MB |

Karşılaştırma yalnızca yerel simüle sayfadır; gerçek sitelerde bellek tarayıcı + diğer eklentilere bağlıdır. 0.8.0’da birinci taraf kırılmadı, ana içerik gizlenmedi. uBO Lite aynı sayfada 25 ms / 539 MB.

## Desteklenmeyen veya eksik olanlar

| Konu                                  | Neden                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Service worker CPU profili (DevTools) | Otomatik ölçüm yok; DNR yazımını atlamak ve IDB birleştirmek gözlenen maliyetler            |
| Cosmetic motoru kısmi güncelleme      | Ghostery `FiltersEngine.merge` tüm paketleri birleştirir; tek liste değişince hepsi yeniden |
| `getMatchedRules` ile sayaç           | URL vermez, kota vardır, çift sayım riski. `testMatchOutcome` kaldı                         |
| Aşama 9 uyumluluk matrisi             | Ölçüm `docs/PHASE_9_TEST.md` ve güncellenmiş matris                                         |

## Testler

- Birim: 20 dosya, 138 test. `addStats` toplu yazım; `parseStatsDump`; mevcut derleme/önbellek testleri duruyor.
- E2E: 30/30 (Brave). `web-ext lint`: 0 hata, 3 uyarı (React `innerHTML` + EasyPrivacy’deki “coinminer” dizesi; önceki aşamalarla aynı). `npm audit`: 0 açık.
- `node e2e/baseline.ts` yukarıdaki 0.8.0 satırını yazdı.
