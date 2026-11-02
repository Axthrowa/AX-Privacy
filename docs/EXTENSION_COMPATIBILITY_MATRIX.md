# Extension Compatibility Matrix

Seviyeler: **Yüksek** = aynı işi aynı katmanda yapıyor, kural/DOM çakışması olası · **Orta** = kısmi örtüşme · **Düşük** = farklı alanlar · **Yok** = alakasız.

İlk üç satırın AdGuard, uBO Lite, Ghostery, Malwarebytes ve Privacy Badger sütunları 2026-11-01 ölçümüdür (`docs/runtime-baseline.json`, AX 0.9.0, Shields kapalı, 6 reklam + 7 izleyici + 4 gizleme seçicisi). Brave Shields, Twitch Adblock ve ilk üç satırın altındaki modüller hâlâ yetenek tahminidir; bu koşuda kurulmadılar veya prob yoktu.

## AX modülleri ve mevcut eklentiler

| AX modülü                    | Brave Shields | AdGuard | uBO Lite | Ghostery                   | Malwarebytes             | Privacy Badger | Twitch Adblock |
| ---------------------------- | ------------- | ------- | -------- | -------------------------- | ------------------------ | -------------- | -------------- |
| Reklam engelleme (DNR)       | Yüksek        | Orta    | Yüksek   | Yüksek                     | Yüksek                   | Orta           | Düşük          |
| Cosmetic filtreleme          | Yüksek        | Orta    | Düşük    | Orta                       | Orta                     | Yok            | Yok            |
| Tracker engelleme            | Yüksek        | Yok     | Yüksek   | Yüksek                     | Yüksek                   | Orta           | Yok            |
| Fingerprinting koruması      | Yüksek        | Orta    | Yok      | Düşük                      | Düşük                    | Orta           | Yok            |
| Anti-phishing / malware      | Düşük         | Düşük   | Yok      | Yok                        | Yüksek                   | Yok            | Yok            |
| Cookie / consent             | Orta          | Orta    | Orta     | Yüksek (autoconsent)       | Yok                      | Yok            | Yok            |
| Popup / redirect             | Orta          | Yüksek  | Orta     | Orta (redirect-protection) | Orta                     | Yok            | Yok            |
| YouTube                      | Orta          | Orta    | Orta     | Orta                       | Yok                      | Yok            | Yok            |
| Twitch                       | Düşük         | Düşük   | Düşük    | Düşük                      | Yok                      | Yok            | Yüksek         |
| Form / sayfa DOM değişikliği | Düşük         | Düşük   | Düşük    | Düşük                      | Orta (shell-paste guard) | Yok            | Yok            |

## Ölçülen örtüşme (ağ engelleme)

Kaynak: `docs/runtime-baseline.json`. 13 reklam ve izleyici probu kullanıldı. Tablo, satırdaki eklentinin engellediği probların kaçının sütundaki eklenti tarafından da engellendiğini gösterir.

| ↓ engellenen / ayrıca engelleyen → | AdGuard | uBO Lite | Ghostery | Malwarebytes | Privacy Badger |
| ---------------------------------- | ------- | -------- | -------- | ------------ | -------------- |
| AdGuard (3)                        | —       | 3        | 3        | 3            | 1              |
| uBO Lite (13)                      | 3       | —        | 12       | 12           | 8              |
| Ghostery (12)                      | 3       | 12       | —        | 11           | 7              |
| Malwarebytes (12)                  | 3       | 12       | 11       | —            | 7              |
| Privacy Badger (8)                 | 1       | 8        | 7        | 7            | —              |

Sonuç: uBO Lite'ın kapsamı, diğer dördünün bu prob setindeki engellemelerinin tamamını içeriyor.

## AX 0.9.0 ile aynı prob (Shields kapalı)

Her eklentinin engellediği adreslerin tamamı AX'in engellediği 13 adresin içinde. AX'in fazladan tuttuğu adresler parantezde.

| Eklenti        | Örtüşen | AX'te olup onda olmayan        | Birlikte (birinci taraf / ana içerik) |
| -------------- | ------- | ------------------------------ | ------------------------------------- |
| AdGuard        | 3/3     | 10 adres (izleyicilerin hepsi) | Kırık yok, ana içerik duruyor         |
| uBO Lite       | 13/13   | yok                            | Kırık yok, ana içerik duruyor         |
| Ghostery       | 12/12   | `cdn.segment.com`              | Yalnızca tek başına ölçüldü           |
| Malwarebytes   | 12/12   | `cdn.taboola.com`              | Yalnızca tek başına ölçüldü           |
| Privacy Badger | 8/8     | 5 adres                        | Yalnızca tek başına ölçüldü           |

Gizleme: AX, AdGuard, Ghostery ve Malwarebytes yalnızca `#div-gpt-ad-1` gizledi. uBO Lite ve Privacy Badger bu dört seçiciden hiçbirini gizlemedi. AX + AdGuard ve AX + uBO Lite aynı seçicide kaldı; `#content` görünür kaldı.

Birlikte bellek ve ortanca yükleme: AX 495 MB / 40 ms, AX + AdGuard 1203 MB / 68 ms, AX + uBO Lite 675 MB / 39 ms, beş eklenti + AX 2735 MB / 221 ms. Birinci taraf üç betiğin hiçbiri kırılmadı.

AX başka eklentiyi kapatmıyor. Yukarıdaki "uyumlu mod" tablosu hâlâ öneridir; bu aşamada otomatik kapatma eklenmedi.

## Önerilen Brave Compatibility Mode davranışı

AX hiçbir eklentiyi veya Shields ayarını kendiliğinden kapatmaz. Kullanıcıya yalnızca öneri gösterir ve her değişiklik kullanıcı onayı ister.

| Durum                               | AX davranışı                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brave Shields açık                  | Cosmetic filtreleme ve fingerprint modülü "uyumlu mod"a geçer: ağ kurallarını uygular, agresif DOM gizlemeyi ve fingerprint kancalarını varsayılan olarak kapalı tutar. |
| AdGuard / uBO Lite / Ghostery etkin | Uyarı: "Aynı işi yapan N eklenti var." Hangisinin kalacağına kullanıcı karar verir.                                                                                     |
| Malwarebytes etkin                  | Anti-phishing modülü çalışır, ancak çift uyarı sayfası göstermemek için aynı domain için ikinci uyarıyı bastırır.                                                       |
| Twitch Adblock etkin                | Twitch modülü varsayılan olarak pasif kalır; kullanıcı açarsa çakışma uyarısı gösterilir.                                                                               |

## Tespit yöntemi (MV3 kısıtı)

`chrome.management` izni ile kurulu eklentiler listelenebilir. Bu izin, Chrome Web Store'da ek gerekçe isteyen hassas bir izindir. Brave Shields durumunu bir eklentinin okuyabileceği resmi bir API yok. Bu nedenle Shields tespiti yalnızca kullanıcı beyanı ve sayfa içi sezgilerle (ör. bilinen bir test kaynağının engellenip engellenmediği) yapılabilir. Bu bir **kısıt** olarak kabul edildi.
