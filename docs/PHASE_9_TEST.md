# Phase 9: Test ve uyumluluk

Sürüm 0.9.0. Yeni özellik yok. Bu aşama mevcut testleri bir tur daha koştu, uyarı sayfasındaki bir izni daralttı ve çakışma matrisindeki tahminleri ölçümle değiştirdi.

## Güvenlik denetimi

Kod sınırı tarandı: mesaj ayrıştırma, içerik betiği izin listesi, CSP, `web_accessible_resources`, uyarı sayfası, liste indirme, istatistik ve SponsorBlock.

| Kontrol                 | Sonuç                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP                     | `script-src 'self'; object-src 'none'; base-uri 'none'`                                                                                            |
| Web'e açık dosya        | `web_accessible_resources` yok. Sayfa eklentiye mesaj gönderemiyor (e2e)                                                                           |
| İçerik betiği mesajları | Yalnızca `cosmetic/*`, `popup/userOpen`, `consent/msg`, `security/insecurePassword`, `video/segments`. `proceed`, ayar ve içe aktarma reddediliyor |
| Çerez `eval`            | Sayfanın gönderdiği kod atılıyor; yalnızca paket içi snippet kimliği kalıyor                                                                       |
| Uyarı sayfası           | Liste adı React metni. `javascript:` adresinde "yine de devam et" yok (e2e)                                                                        |
| Devam izni              | Oturum `allow` kuralı, adres bir sayfa engelleme listesinde değilse yazılmıyor                                                                     |
| Uzak kod                | Yok. Kullanıcı listesi metin filtredir; son adres https veya yerel http değilse reddedilir                                                         |
| Veri çıkışı             | Sayaç ve güvenlik günlüğü yerelde. SponsorBlock yalnızca seçenek açıkken 4 karakterlik önek sorar                                                  |
| `web-ext lint`          | 0 hata, 3 uyarı (öncekiyle aynı: paket `innerHTML`, EasyPrivacy içinde "coinminer" dizesi)                                                         |
| `npm audit`             | 0 açık                                                                                                                                             |

Kalan risk: listelenen bir alan adı için "yine de devam et" oturum boyunca her kaynak türüne `allow` yazar. Güvenlik profilini kapatmak o adresi belge engelinden muaf tutar. `host_permissions` tüm http(s) adresleridir; DNR için gerekli. MAIN world betikleri sayfa tarafından fark edilebilir.

## Uyumluluk

Ayrı atılabilir profiller, Shields kapalı. Ayrıntı `docs/EXTENSION_COMPATIBILITY_MATRIX.md` ve `docs/runtime-baseline.json`.

AX + AdGuard ve AX + uBO Lite birinci taraf betiği kırmadı, ana içeriği gizlemedi. Ağ kümesi uBO Lite ile birebir (13/13). AdGuard bu sette 3 reklam engelledi, izleyici engellemedi; üçü de AX'in içinde. Birlikte çalışınca AX'in 13'ü duruyor.

Ölçülmeyenler: Brave Shields (bu koşuda kapalı), parmak izi, çerez, YouTube, Twitch. Onların matris hücreleri tahmin olarak duruyor.

## Testler

- Birim: 20 dosya, 138 test. `proceed` listesiz adresi reddeder.
- E2E: 31/31 (Brave). Yeni: uyarı sayfası `javascript:` adresine izin vermez ve liste adını metin basar. Mevcut "yine de devam et" listelenen simüle sitede duruyor.
- `node e2e/baseline.ts`: 11 yapılandırma, 5 tekrar.
