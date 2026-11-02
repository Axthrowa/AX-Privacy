# Phase 7: Kontrol paneli

Sürüm 0.7.0’da özet, tema, site duraklatma ve ayar yedeği geldi. Atlananlar 0.8.0’da kapatıldı: dürüst reklam/izleyici/güvenlik sayaçları, site başına modül profili, 14 hash sayfa, yığın CSS grafik, yedekte 30 günlük istatistik.

## Modüller

| Modül               | Nasıl çalışıyor                                                                                                                                                                                                                                | Varsayılan |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Günlük sayaçlar     | Engellenen alt kaynak `testMatchOutcome` ile sınıflanır. EasyList/uBlock/AdGuard TR = reklam, EasyPrivacy/URL Tracking = izleyici, Badware/URLhaus = güvenlik. Eşleşme yoksa (Shields/başka eklenti) sayılmaz. 30 günden eski satırlar silinir | Açık       |
| Alan adı sıralaması | Aynı depoda `host:` önekli satırlar; yalnızca AX eşleşince artar. Özet en çok 10 alanı gösterir                                                                                                                                                | Açık       |
| Güvenlik günlüğü    | Son 50 sayfa engeli ve kapatılan açılır pencere `storage.local` içinde. Adres dışarı gitmez                                                                                                                                                    | Açık       |
| Özet / 14 sayfa     | Hash yönlendirme (`#overview` … `#about`). Görünmeyen sayfa DOM’da yok. Kontroller boş kabuk değil; ilgili liste veya ayar o sayfada                                                                                                           | —          |
| Site profili        | `siteProfiles`: ağ / gizlilik / video / güvenlik. Duraklatma hâlâ her şeyi kapatır. Ağ kapalı: alt kaynak `allow` (belge engeli durur). Güvenlik kapalı: hedef için `main_frame`/`sub_frame` `allow`                                           | Tümü açık  |
| Tema                | `theme: dark \| light`. Yalnızca arayüz                                                                                                                                                                                                        | Koyu       |
| Yedek               | `{ nexus: 1, exportedAt, settings, stats? }`. `isBrave` yazılmaz ve okunmaz. `stats` son 30 günün satırları ve olayları                                                                                                                        | —          |

## Ölçülen gerçekler

- Simüle sayfada `www.googletagmanager.com` (EasyPrivacy) engellenince izleyici/istek sayacı arttı ve alan adı özet listesine girdi.
- 14 sayfa menüde; özel kurallar `#advanced`, listeler `#lists`, duraklatma `#sites`.
- Tema düğmesi `data-theme` özniteliğini `light` yaptı.
- Formdan eklenen site duraklatıldı; yedek alınıp site açıldıktan sonra içe aktarınca yeniden duraklatıldı. Brave etiketi ve `isBrave` yedekten gelmedi. Yedekte `stats.rows` / `stats.events` var.
- Birim testleri sahte kategori satırlarını, zarfı olmayan JSON’u ve bozuk profil alanını reddediyor.

## Desteklenmeyen veya eksik olanlar

| Konu                                          | Neden                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| Reklam / izleyici ayrımı DNR kuralı düzeyinde | Statik kurallar karışık; ayrım yalnızca `testMatchOutcome` + liste kategorisi |
| Kimlik avı sayacı                             | OpenPhish yeniden dağıtılamaz; sütun uydurulmaz                               |
| Grafik kütüphanesi                            | Bağımlılık eklenmedi; CSS yığın çubukları                                     |
| Site başına reklam vs izleyici DNR            | MV3 tek `allow` ile listeyi ayıramaz; profil dört uygulanabilir modül         |

## Testler

- Birim: 20 dosya, 138 test. `stats.test.ts` (sınıflama + özet + yedek), `settings.test.ts` profiller, `control.test.ts` kural 5/6 ve modül `excludeMatches`, `router.test.ts` `site/setProfile` + `restoreStats`, `messages.test.ts`, `tab-report.test.ts` 3 argüman, `db.test.ts` toplu yazım.
- E2E: 30/30. `e2e/dashboard.spec.ts` 14 menü, sayaç, tema, duraklatma, yedekte `stats`. Diğer spec’ler hash sayfalara gider.
