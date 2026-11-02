# Phase 5: Güvenlik

Sürüm 0.5.0. Bu aşamada bilinen zararlı sitelere karşı sayfa engelleme ve bir uyarı sayfası eklendi. Ayrıca adres ve sayfa üzerinde yerel risk işaretleri tespit ediliyor. Hiçbir adres dışarı gönderilmiyor ve hiçbir site "güvenli" ilan edilmiyor.

## Modüller

| Modül                          | Nasıl çalışıyor                                                                                                                                                                                                                                                                          | Varsayılan |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Sayfa engelleme (`$document`)  | `$document`/`$doc` ve `$all` artık derleniyor; ana çerçeve ve çerçeve isteklerini engelleyen DNR kurallarına dönüşüyor. Daha önce desteklenmiyordu                                                                                                                                       | —          |
| uBlock Badware risks           | Statik kural kümesi: 1.179 DNR kuralı, bunların 963'ü sayfa engelleme kuralı. Kötü amaçlı yazılım, sahte destek, dolandırıcılık siteleri                                                                                                                                                 | Açık       |
| URLhaus (alan adları)          | malware-filter projesinin "online" alan adı listesi. 1.878 alan adı, tek bir DNR kuralında `requestDomains` olarak tutuluyor                                                                                                                                                             | Açık       |
| Uyarı sayfası (`blocked.html`) | `webNavigation.onErrorOccurred` içinde ana çerçeve `ERR_BLOCKED_BY_CLIENT` verirse, adres AX'in etkin listelerindeki sayfa kurallarıyla (`*.doc.json`, istisnalar dahil) eşleştiriliyor. Eşleşme varsa sekme uyarı sayfasına yönlendiriliyor; sayfada adres ve listenin adı gösteriliyor | Açık       |
| "Yine de devam et"             | Kullanıcı tıklarsa o alan adı için öncelik 50 olan bir oturum kuralı (`allow`) ekleniyor. Bu kural tarayıcı kapanınca siliniyor. "Güvenli tarafa dön" önceki sayfaya iki adım geri gidiyor; geri gidilecek sayfa yoksa sekmeyi kapatıyor                                                 | —          |
| Yerel adres kontrolleri        | `engines/security/heuristics.ts`. Ağ isteği yapılmıyor. Ayrıntılar aşağıda                                                                                                                                                                                                               | Açık       |
| http şifre alanı               | Üst çerçevesi `http:` olan bir sayfada şifre alanı varsa veya şifre alanına odaklanılırsa bu durum sekme raporuna yazılıyor                                                                                                                                                              | Açık       |
| Popup güvenlik bölümü          | Yalnızca gerçek bulgulardan bir seviye çıkarılıyor: Yüksek / Dikkat / Düşük. Bulgu yoksa "bilinen bir risk bulunamadı; bu, sitenin güvenli olduğu anlamına gelmez" yazıyor. Sayısal puan yok                                                                                             | Açık       |

### Yerel kontroller

| Bulgu               | Ne zaman                                                                                                                                                                                      | Seviye |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `warning-bypassed`  | Site bir güvenlik listesinde ve kullanıcı uyarıya rağmen açtı                                                                                                                                 | Yüksek |
| `homograph`         | Punycode (`xn--`) etiketinde Latin harfleri Kiril veya Yunan harfleriyle karışık. Ya da etiket yalnızca Latin harflerine benzeyen harflerden oluşuyor (ör. `аррӏе`)                           | Orta   |
| `lookalike`         | Benzer harfler veya rakamlar Latin karşılıklarına çevrildikten sonra alan adı bir markayla aynı. Ya da ilk harf aynı ve tek harf farkı var (ör. `paypa1`, `gooogle`). Resmi alan adları hariç | Orta   |
| `brand-subdomain`   | Marka adı yalnızca alt alan adında geçiyor (ör. `paypal.com.secure-check.example`)                                                                                                            | Orta   |
| `userinfo`          | Adreste `@` öncesi kullanıcı bilgisi var                                                                                                                                                      | Orta   |
| `insecure-password` | http sayfasında şifre alanı var                                                                                                                                                               | Orta   |
| `brand-in-name`     | Alan adında tire ile ayrılmış bir marka adı geçiyor (ör. `paypal-login.example`)                                                                                                              | Düşük  |
| `ip-host`           | Site, alan adı yerine herkese açık bir IP adresiyle açılmış (özel ağ adresleri hariç)                                                                                                         | Düşük  |

Marka listesi elle derlendi: 30 marka ve resmi alan adları (Google, PayPal, Apple, Microsoft, Amazon, Meta, Netflix, Steam, kripto borsaları, Türk bankaları, e-Devlet, Trendyol, Hepsiburada, Sahibinden). Bu listenin dışındaki markalar için benzerlik kontrolü yapılmıyor.

## Ölçülen gerçekler

- **Toplam statik kural:** 23.382; varsayılan olarak etkin olanlar 21.594. Chromium'un uzantı başına garanti ettiği sınır 30.000.
- **Engellenen sayfaya hiç istek gitmiyor:** e2e testinde sunucu, engellenen alan adından istek almadı. "Yine de devam et" tıklanınca sayfa açıldı ve popup `warning-bypassed` gösterdi.
- **Statik listeler gerçekten etkin:** URLhaus listesindeki bir alan adı, siteye gidilmeden `testMatchOutcome` ile kontrol edildi ve `urlhaus` kural kümesiyle eşleşti.
- **Performans (`docs/runtime-baseline.json`):** AX 0.5.0 ile 6/6 reklam ve 7/7 izleyici engellendi. Ortanca yükleme süresi 30 ms, bellek 563 MB. 0.4.0'da bu değerler 34 ms ve 569 MB'tı.

## Desteklenmeyen veya eksik olanlar

| Konu                                                   | Neden                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kimlik avı (phishing) listeleri                        | phishing-filter OpenPhish verisi içeriyor; OpenPhish ticari kullanımı ve yeniden dağıtımı yasaklıyor. PhishTank kayıt ve API anahtarı gerektiriyor. Kimlik avına karşı yalnızca yerel kontroller ve uBlock Badware var |
| Google Safe Browsing                                   | API anahtarı gerekiyor ve adres önekleri Google'a gidiyor. Brave'in kendi Safe Browsing koruması zaten açık                                                                                                            |
| URLhaus'un URL bazlı kayıtları                         | Yaklaşık 100.000 kural statik kota sınırını aşıyor; yalnızca alan adı listesi kullanılıyor (paylaşımlı barındırma sitelerindeki tek tek URL'ler kapsanmıyor)                                                           |
| ScamAdviser benzeri site puanı, sahte alışveriş sitesi | Alan adı yaşı, WHOIS ve itibar verisi için dış servis gerekiyor; uydurma puan üretilmiyor                                                                                                                              |
| Kötü amaçlı indirme taraması                           | `downloads` izni ve dosya inceleme gerekiyor. Bu aşamada eklenmedi. İndirme adresleri listede ise DNR yine engelliyor                                                                                                  |
| Sahte giriş sayfası tespiti                            | Yalnızca http şifre alanı ve adres kontrolleri var; sayfa içeriği (logo, form hedefi) analiz edilmiyor                                                                                                                 |
| Şüpheli yönlendirme zinciri                            | Her yönlendirme adımı aynı listelerle kontrol ediliyor; zincir uzunluğu veya şekli ayrıca puanlanmıyor                                                                                                                 |
| Listelerin otomatik güncellenmesi                      | Listeler pakete gömülü; sürüm güncellemesiyle yenileniyor. Uzaktan kod veya kural çalıştırılmıyor                                                                                                                      |
| Brave Shields'in engellediği sayfalar                  | Uyarı sayfası yalnızca AX'in kendi listeleri eşleşirse gösteriliyor; Shields kendi hata sayfasını gösteriyor                                                                                                           |
| Var olan kurulumlar                                    | 0.4.0'dan güncelleyen kullanıcıların liste seçimi değiştirilmiyor; iki güvenlik listesi Listeler panelindeki "Güvenlik" kategorisinden açılmalı                                                                        |

## Lisanslar

| Bileşen                        | Kaynak                                                                                        | Lisans        |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ------------- |
| uBlock filters – Badware risks | `https://ublockorigin.github.io/uAssets/filters/badware.txt`                                  | GPL-3.0       |
| Online Malicious URL Blocklist | `https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt` (URLhaus) | CC0-1.0 / MIT |

## Testler

- **Birim (Vitest), 16 dosya, 105 test:**
  - Yeni `heuristics.test.ts`: RFC 3492 çözümleme, homograf, benzer alan adı, marka kontrolleri, resmi ve ilgisiz siteler için yanlış alarm olmaması, "bulgu yoksa seviye none" kuralı.
  - `$document`/`$all` derleme ve istisnalı `documentRules`.
  - Router'ın `security/*` mesajları (içerik betiğinden `proceed` reddediliyor).
  - Sekme raporundaki yeni alanlar.
- **E2E (Playwright + Brave 156), 22 test:** Bunların 3'ü yeni (`e2e/security.spec.ts`). Yalnızca simüle edilmiş `*.nexus-*.example` alan adları kullanıldı.
  - Uyarı sayfası, geri dönüş ve "yine de devam et".
  - Popup risk bulguları.
  - URLhaus kural kümesinin ziyaret edilmeden doğrulanması.
- `web-ext lint`: 0 hata, 3 uyarı (öncekiyle aynı). `npm audit`: 0 açık.
