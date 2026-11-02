# AX Privacy — gizlilik

Sürüm 0.10.0. Hesap yok. Telemetri yok. Geçmiş, sekme adresleri ve sayaçlar tarayıcıdan çıkmaz.

## Tarayıcıda kalanlar

| Veri                       | Nerede            | Ne zaman silinir                                    |
| -------------------------- | ----------------- | --------------------------------------------------- |
| Ayarlar, site profilleri   | `storage.local`   | Eklentiyi kaldırınca                                |
| Günlük sayaçlar            | IndexedDB, 30 gün | Sayaçları sıfırlayınca veya süre dolunca            |
| Güvenlik günlüğü (son 50)  | `storage.local`   | Sayaçlarla birlikte veya eklenti kalkınca           |
| Sekme raporu               | `storage.session` | Sekme kapanınca; tarayıcı kapanınca oturum da biter |
| "Yine de devam et" izni    | Oturum DNR kuralı | Tarayıcı kapanınca                                  |
| Eklediğiniz filtre listesi | IndexedDB         | Listeyi kaldırınca                                  |

Yedek dosyası (`nexus-settings.json`) sizin indirdiğiniz bir dosyadır. `isBrave` alanını içermez. İstatistik satırları dosyadaysa içe aktarınca geri yazılır.

## Dışarı giden istekler

AX'in kendi sunucusu yoktur ve gezinme sırasında AX bir sunucuya istek atmaz. Liste güncellemeleri gezinmeden bağımsızdır.

| Ne                               | Ne gider                                                                                                            | Ne zaman                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| SponsorBlock                     | Video kimliğinin SHA-256 özetinin ilk 4 karakteri                                                                   | Yalnızca siz açarsanız                          |
| Sizin eklediğiniz filtre listesi | O adresin kendisi; liste metni indirilir                                                                            | Ekleyince ve günde bir                          |
| Paketle gelen listeler           | Listenin kendi sunucusu; yalnızca filtre metni indirilir, çerez ve referrer gönderilmez. Sunucu IP adresinizi görür | 12 saatte bir, kapatılabilir (Filtre listeleri) |

SponsorBlock sorgusu video kimliğinin tamamını göndermez. Adres çubuğu, izleme geçmişi veya sayaçlar bu istekle gitmez.

## Yapılmayanlar

Konum, kişi, ödeme, parola veya çerez içeriği okunmaz ve gönderilmez. Başka eklenti kapatılmaz. Bir site "güvenli" diye işaretlenmez. Uzaktan kod indirilip çalıştırılmaz. Çerez reddi yalnızca paketin içindeki autoconsent kurallarıyla olur; sayfanın gönderdiği kod çalıştırılmaz.
