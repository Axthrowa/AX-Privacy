# Phase 11: Rakiplerin yöntemlerini birleştirme

Sürüm 0.11.0. Kurulu paketler incelendi: uBO Lite 2026.1026.1812, AdGuard 5.5.3.28, Ghostery 10.6.10, Privacy Badger 2026.9.15.2, Malwarebytes 3.3.8, Twitch Adblock 2.2 ve Brave 156'nın filtre bileşenleri.

REA kanıtları: Twitch Adblock `ev_aec222e0d2f9f8a39500b7ac024708e4a0830e13ea303e81bf2c23442ef727bb`, Malwarebytes `ev_e621e120c7bbde87a58631153193699061ee93494efe13242279777e4d2830dd`. Diğerleri paket dosyalarının okunmasıyla incelendi. Brave'in `adblock-rust` motoru tersine çevrilmedi: `chrome.dll` incelenmedi; yalnızca veri dosyaları ve listeler okundu.

## Siteler nasıl bozulmuyor (gözlenen) ve AX'te karşılığı

| Teknik                                             | Kimde görüldü                                                 | AX 0.11.0                                                       |
| -------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| Engellenen betik yerine zararsız kopya (surrogate) | uBO Lite (`web_accessible_resources`), Privacy Badger         | Var. `$redirect` artık `public/surrogates/` dosyalarına gidiyor |
| Sayfa betiklerinden önce, senkron scriptlet        | uBO Lite (`scripting/scriptlet`), AdGuard, Ghostery           | Var. Önceki sürümde scriptlet'ler hiç çalışmıyordu (aşağıda)    |
| Onarım listeleri (istisnalar)                      | uBO `unbreak`, `quick-fixes`; `brave-unbreak`; Ghostery fixes | Var: `ublock-unbreak`, `ublock-quick-fixes`, `brave-unbreak`    |
| Engel yerine yalnızca çerez silme (CDN'ler)        | Privacy Badger `cookieblock` (853 alan adı)                   | Yok. Üçüncü taraf çerez seçeneği var, alan adı bazlı değil      |
| Tıklamayla yüklenen sosyal gömme                   | Privacy Badger                                                | Yok                                                             |
| Öğe seçici (kullanıcının kendi kuralı) \*          | AdGuard, uBO Lite, Ghostery, Brave                            | Var. Açılır penceredeki "Sayfada bir öğeyi gizle"               |

\* Öğe seçici yalnızca açılır pencereden başlatılınca yüklenir (4,8 KB, sürekli maliyeti yok). Tek bir `host##seçici` kuralı yazar; satır sonu içeren veya CSS/betik taşıyan seçici reddedilir. Kayıt izni bir kullanımlıktır, 10 dakikada dolar ve yalnızca üst çerçeveden kabul edilir. Sınırlar: fareyle çalışır (Tab ile düğmelere ulaşılır ama öğe seçimi klavyeyle yapılamaz); başka alan adından gelen iframe'in içi seçilemez, iframe'in kendisi seçilebilir; Firefox'ta uçtan uca test edilmedi. Kural Kontrol panelindeki özel kurallar kutusundan silinir.

## Daha az kaynak

| Değişiklik                                 | Önce                                   | Şimdi                                       |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------- |
| Her karede çalışan `popups.js`             | 271 KB (tüm PSL tablosu dahil)         | 2,4 KB                                      |
| Motor birleştirme (SW her soğuk başlangıç) | 137 ms (Node ölçümü)                   | Derlemede yapılıyor (`engines/default.bin`) |
| Tekrar gelen host                          | Her karede motor                       | `storage.session` önbelleğinden, motorsuz   |
| Sıradan sayfada `cosmetic/dom` mesajı      | Her sayfada                            | Kural kelimesi yoksa hiç (e2e testi var)    |
| Her istekte `webRequest` dinleyicisi       | Her zaman açık, SW'yi uyanık tutuyordu | Yalnızca "Ayrıntılı raporlar" açıkken       |
| Her gezinmede `webNavigation`, `tabs`      | Her zaman açık                         | Yalnızca gerektiğinde                       |

Bedeli: içerik betiği artık 141 KB'lık kelime tablosu ve 1,1 MB'a kadar scriptlet verisi yüklüyor (uBO Lite ile aynı yöntem, benzer boyut). Kullanıcı `declarativeNetRequest` sayaçlarını görüyor; alan adı listesi ve günlük istatistik varsayılan kapalı.

Ölçüm (`docs/runtime-baseline.json`, yerel test sayfası, 5 tekrar): Eklentisiz 401 MB / 30 ms, AX 499 MB / 24 ms, uBO Lite 536 MB / 24 ms, Privacy Badger 605 MB / 39 ms, Ghostery 797 MB / 34 ms, AdGuard 985 MB / 37 ms, Malwarebytes 1271 MB / 54 ms. Bu bellek ölçümü tek sayfalı anlık durumdur; service worker uyku süresini ölçmez.

## Ölçümle bulunan hatalar

1. **Scriptlet'ler hiç çalışmıyordu.** `popups.ts` MAIN world'de `chrome.runtime.sendMessage` çağırıyordu; bu API orada yok, hata yutuluyordu. Listelerdeki kuralların tamamı boştu. Testi de yoktu.
2. **`$redirect` için Phase 3 notu yanlıştı.** Temiz bir denemede `extensionPath` yönlendirmesi Brave 156'da çalıştı (`use_dynamic_url` açık ve kapalı).
3. Derleme sırasında yakalananlar: regex host'lu kural "tüm siteler" sayılıyordu (`nowoif` her yerde devreye giriyordu); `rpnt` yerine yazdığı metin yine eşleşince sayfa kilitleniyordu (gerçek YouTube açılmadı); `rmnt` Trusted Types sayfalarında hata atıyordu.

## Bilerek yapılmayanlar

| Konu                                                                           | Neden                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listeden gelen `rpnt` ile sayfaya kod yazma, `trusted-*` scriptlet'leri        | Kuralın metni kod olarak çalışır. YouTube kuralları birlikte çalışan parçalar; biri olmadan oynatmayı bozabilir                                            |
| CNAME gizlemeyi çözme                                                          | Chromium eklentileri DNS göremez. Brave bunu kendisi yapıyor. AdGuard'ın listesi 300.000 alan adı (10 MB), kaynak hedefiyle çelişiyor                      |
| Malwarebytes veritabanları ve Ghostery `dnr-fixes` dosyası                     | Lisans veya dağıtım izni net değil. Yöntem aynı: kategori listeleri + izin listesi                                                                         |
| Twitch Adblock'un `rules.twadblock.com`'dan kural çekmesi ve kimlik göndermesi | Uzaktan kural ve kullanıcı kimliği gönderimi var (`js/bg.js`, `uid` ile POST). AX'te gönderim yok                                                          |
| Twitch'te oturum anahtarını yeniden kullanma                                   | TwitchAdSolutions bunu yedek akış için yapar. AX istekleri anonimdir; reklamsız liste bulunamazsa parçaları boş klibe çevirir, görüntü kısa süre donabilir |

## Testler

- Birim: 25 dosya. Scriptlet derleyici, kelime tablosu ve Twitch çalışan kancası ayrıca test edildi.
- E2E (Brave): scriptlet'lerin sayfa içinde gerçek davranışı, surrogate'in yerine yüklenmesi, Trusted Types, çalışan kancasının yalnızca oynatıcı çalışanına girmesi.
- `node e2e/live-check.ts`: gerçek YouTube'da reklam alanları silinmiş, video ilerliyor; gerçek Twitch'te video ilerliyor. **Ölçüm süresince Twitch reklamı gösterilmedi**, yani reklam sırasında davranış yalnızca simüle playlist ile doğrulandı.
- `node e2e/site-check.ts`: `docs/site-check.json`. Başsız tarayıcı birçok sitede 403 ile reddedildi (sahibinden, hepsiburada, ekşi, IMDb, Trendyol); bu siteler için sonuç yok.
- **Çözülmedi:** Amazon.com.tr başsız tarayıcıya çoğunlukla HTTP 202 bot sayfası veriyor. 11 denemede gerçek sayfa AX'suz 3, AX ile 0 kez açıldı. AX bu sitede hiç istek engellemedi ve scriptlet çalıştırmadı, ama örnek küçük; normal tarayıcıda elle bakılmalı.
- `npm run filters` çevrimiçi kipte Node'un `fetch`'i içinde (undici assert) bir kez çöktü; bu sürümde yeni listeler `curl` ile indirilip `--offline` ile derlendi. Eski listeler 1 Kasım önbelleğinden geldi.

## Güncelleme

Paketlenmemiş eklentinin dosyaları tarayıcı kapalıyken değişirse `onInstalled` gelmiyordu; kod yeni, kurallar ve betikler eskiydi. Arka plan artık başlarken uygulanmış sürümü kontrol ediyor.

## netprime.me düzeltmesi

Gerçek sitede 8 tıklamayla ölçüldü (`node e2e/popup-check.ts`). Düzeltme öncesi AX'te ilk tıklamada reklam sekmesi açılıyor ve sayfada sahte "TAMAM" kutusu çıkıyordu; şimdi iki koşuda da 0 sekme, kutu yok. uBO Lite ile aynı.

- **Regex kuralları derlenmiyordu.** Rastgele alan adlı reklam ağlarını yakalayan uBO kuralları regex. Derleme artık bunları alıyor; lookahead'ler uBO Lite gibi atılıyor, tüm sayfa engelleyen kurallarda ise atılmıyor, kural düşürülüyor.
- **Tarayıcı sınırı.** 416 regex'ten 124'ü bellek sınırını aştı ve eklentinin başlamasını engelledi. `scripts/regex-check.ts` artık derlemede tarayıcıya soruyor: tekrar sayıları üç kademede düşürülüyor (yalnız kaynak kuralları), yine sığmayan 40 kural atılıyor. Derleme için kurulu Brave gerekir.
- **Sekme açmanın diğer yolları.** Reklam betiği `window.open` yerine `<form target=_blank>.submit()` kullanıyordu. Koruma artık form `submit`/`requestSubmit` ve eklenmemiş bağlantıdaki `click`/`dispatchEvent` yollarını da kapsıyor.
- **Site bozma düzeltmesi.** Eski kural, bağlantı olmayan bir yere tıklamada başka siteye açılan her pencereyi engelliyordu; paylaş ve giriş düğmeleri de bundan etkileniyordu. Artık tıklanan öğeye (düğme, imleci el olan öğe) ve çağrıyı yapan betiğe bakılıyor; giriş, ödeme ve paylaşım hedefleri hiç engellenmiyor. Sınır: başka alan adındaki CDN'den çalışan ve adında sitenin adı geçmeyen bir site betiği, listede olmayan bir adrese düğmeyle pencere açarsa engellenebilir.

Garanti değildir: kuralı olmayan yeni bir reklam ağı geçebilir. `domain=site.*` biçimli uBO kuralları hâlâ derlenmiyor (yaklaşık 278 satır).

## Otomatik liste güncelleme

MV3 statik kural dosyaları değiştirilemez. Arka plan 12 saatte bir açık listeleri kaynağından kontrol eder (ETag / Last-Modified; değişmeyen liste inmez). Değişen liste derlenir ve paketle farkı alınır: yeni kurallar dinamik kurala, listeden çıkanlar `updateStaticRules` ile kapatılır. Gizleme motoru, açılır pencere ve sayfa engelleme kuralları da yenilenir.

Sınırlar: yeni bir eklenti sürümü eski güncellemeleri geçersiz kılar ve baştan indirir. Paketin yarısından küçük çıkan liste reddedilir, eski hali çalışmaya devam eder. Dinamik kota 29.000 kural, 1.000 regex, 4.900 yönlendirme; önce özel kurallar ve kullanıcı listeleri yerleşir. **Scriptlet kuralları güncellenmez:** sayfa betiklerinden önce çalışmaları için paket dosyası olmaları gerekir, uzaktan betik yüklemek de MV3 ve projenin kuralına aykırıdır. Bu yüzden eklenti sürümleri de düzenli yenilenmelidir (`npm run filters`, `npm run build`).

## 0.13.0

- **Ad:** AX Privacy. İç tanımlayıcılar (IndexedDB adı, yedek dosyasındaki `nexus` anahtarı, test alan adları) bilerek değişmedi: değişse ayarlar ve eski yedekler kaybolurdu.
- **`domain=site.*`:** 40 yaygın uzantıya açılıyor; `ublock` listesindeki `domain` nedenli atlamalar kalktı. Listede olmayan bir uzantıya taşınan site kaçabilir.
- **Scriptlet:** `href-sanitizer`, `remove-cookie`, `nobab`, `nofab`, `popads-dummy`, `json-prune-xhr-response`, `xml-prune`, `refresh-defuser`, `set-attr`, `trusted-set`, `trusted-set-cookie`, `trusted-set-*-storage-item`, `prevent-innerHTML`, `norafif`, `trusted-replace-argument`. Bunlar yalnızca sabit değer, seçici ve metin kullanır. Sayfaya kod yazanlar (`rpnt` kod biçimi, `trusted-rpnt`, `trusted-create-html`, `trusted-click-element`, `trusted-json-edit` vb.) eklenmedi.
- **Duraklatma:** açılır pencerede "Bu sitede sorun var": 30 dakika sonra koruma kendiliğinden döner.
- **Rozet:** tarayıcının kendi sayacı. Başlık kuralları da sayıldığı için GPC başlığı Brave'de kaldırıldı (Brave gönderiyor), diğer tarayıcılarda sayfa isteklerine daraltıldı; orada sayaç her sayfada birkaç fazla gösterir. CDN çerez kuralının eşleşmeleri de sayılır.
- **Yönlendirme atlama:** Brave'in debounce listesi (MPL-2.0) + Google, Facebook, YouTube, Steam. Tıklama anında yerelde çözülür.
- **CDN çerezi:** Privacy Badger cookieblock listesi (GPL-3.0), giriş, ödeme, banka ve captcha sunucuları çıkarılarak. Tüm üçüncü taraf çerez engeli açıksa gereksiz olduğu için eklenmez.
- **Rahatsızlık listesi:** AdGuard Popups, varsayılan kapalı.
- **Sürüm üretimi:** `npm run release` ve `.github/workflows/lists.yml` (haftalık). İş akışı henüz bir uzak depoda çalıştırılmadı.

**AdGuard listeleri:** `filters.adtidy.org` tarayıcıdan gelen güncelleme isteklerini reddediyor (`HTTP 403`, ardından `Failed to fetch`); `curl` ile derleme sırasında iniyor. Nedeni doğrulanmadı. Bu yüzden `adguard-tr`, `adguard-urltracking` ve `adguard-popups` periyodik güncellemenin dışında (`buildOnly`), yalnızca yeni sürümle yenileniyor. `adguard-popups` için red ayrıca denenmedi; aynı sunucuda olduğu için dahil edildi.

## 0.14.0

- **`$csp`:** sayfaya içerik politikası ekleyen kurallar `modifyHeaders` ile çalışıyor; tüm siteleri kapsayan biçim reddediliyor.
- **`redirect-rule` eklenmedi (bilerek):** 442 satırın 323'ü `*$...,redirect-rule=x,domain=site` biçiminde, yani "bu sitede engellenecek olan her şey yerine". DNR "engellenecek olan" koşulunu kuramaz; olduğu gibi çevirmek sitenin tüm betiklerini kırar. Engellenen alan adlarıyla sınırlamak 94.784 alan adını grup başına tekrarlar (grup başına yaklaşık 2 MB).
- **Açılır pencere:** bu sitede gizlenen öğeler ve geri alma; panoya kopyalanan sorun raporu (hiçbir yere gönderilmez, sayfa adresi içermez).
- **Öğe seçici:** ok tuşları ve Enter. Başka alan adından gelen iframe'in içi hâlâ seçilemez.
- **`npm run sites`:** gerçek sitelerde bozulma ve reklam sekmesi denetimi, sorun varsa çıkış kodu 1.
- **`npm run resource-check`:** service worker'ın gezinme sırasında uyanık kaldığı süre (`docs/resource-check.json`).
- **Firefox testleri:** scriptlet, form yoluyla açılan reklam sekmesi ve yönlendirme atlama eklendi. **Bilinen sınır:** surrogate dosyaları Firefox'ta yüklenmiyor (neden bulunamadı); kural düz engel gibi çalışıyor.
- **Uyanıklık:** ilk ölçümde service worker gezinme boyunca %99 uyanıktı, çünkü her çerçeve açılışta mesaj atıyordu. Gizleme sonuçları artık `storage.local`'da; içerik betiği daha önce görülen host için arka planı hiç uyandırmıyor. Sonuç `docs/resource-check.json` dosyasında. uBO Lite'ın aynı ölçümdeki değeri doğrudan karşılaştırılamaz: varsayılan temel kipte büyük olasılıkla sayfa betiği çalıştırmıyor, bu doğrulanmadı.
- **Uyanıklık ölçümü** (`npm run resource-check`, aynı siteye 10 saniyede bir ziyaret, 2 dakika): düzeltme öncesi %99; içerik önbelleği ve `tabs.onRemoved` dinleyicisinin kaldırılmasıyla %41 (tek uyanış, ilk ziyaret sonrası arka plan bir daha uyanmadı). Ayrıntılı raporlar açıkken %99. Her yeni site ilk ziyarette yine uyandırır; çok farklı site gezinmede oran daha yüksek olur.
