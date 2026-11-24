# AX Privacy 5.0 — plan durumu

Plan belgesindeki her madde ve koddaki karşılığı. `[x]` bitti, `[~]` kısmen, `[ ]` yapılmadı.
Son güncelleme: 24.11.2026.

## AX-Brain 2.0

- [x] Katman 1 sınıflandırıcı: 48 özellik (`engines/brain/rich.ts`: geometri, bağlantı, içerik, 6 kovalı hash'lenmiş kelime torbası, DOM, davranış) ve paketle gelen MLP 48 → 32 → 1 (ReLU, 1.601 parametre, saf TS, `mlp-weights.json`). Ağırlık yoksa v4 lojistik modeli tek başına çalışır.
- [x] Çevrimdışı eğitim: `scripts/brain-crawl.ts` Tranco ilk 10.000 + Tranco'daki ilk 1.000 `.tr` sitesini başsız Chromium'la tarar. Paketteki kozmetik motorun (`default.bin`) gizleyeceği adaylar `--ax-label` özelliğiyle işaretlenir: 1; reklam içermeyen görünür adaylar: 0. Satırlarda site adı yok, SHA-256 öneki var; veri depo dışında tutulur. `scripts/brain-train.ts` Adam ile eğitir.
  - Sapma: elle doğrulanmış 2.000 örneklik altın set yok (elle etiketleme yapılmadı). Yerine kapı, eğitimde hiç görülmeyen sitelerin (hash'in ilk hanesi 0–1, ~%12) otomatik etiketli satırlarında ölçülür; eşik ayrı bir site diliminde seçilir.
- [x] Kişisel ince ayar: MLP donuk; kullanıcının 12 özellikli lojistik modeli "kişisel başlık" olarak MLP'nin log-oranını, gönderilen modelden ne kadar uzaklaştıysa o kadar kaydırır (`richProbability`). Seçici, "yanlış gizledi" ve 6 saniyelik [Geri Al] onu SGD ile günceller; ağırlık [-4, +4] ve `MAX_DRIFT` ±2 kırpılıyor. 60 günlük TTL Katman 2'nin izleyici kayıtlarında.
- [x] Katman 2: ağ davranışı öğrenimi (`engines/brain/trackers.ts`, `background/trackers.ts`). Üçüncü taraf yanıtında Set-Cookie ya da adreste yüksek entropili kimlik → site başına kayıt. 3+ site: çerez silinir; 6+ site ve 2 tür sinyal: engellenir. IndexedDB `trackers` deposu, en çok 2.000 kayıt (LRU), 60 gün TTL. Korunan siteler ve büyük platformlar hiç öğrenilmez; Privacy Badger CDN listesi yalnız çerez seviyesinde kalır. Gizli pencere öğretmez. AX-Brain panelinde liste + "Unut"; Sıfırla hepsini siler.
  - Sapma: terfi 2001–2300 bandı yerine `requestDomains` ile toplu 2 kontrol kuralı (ID 20 çerez, 21 engel). 2.000 alan adı iki kurala sığar; 5.000'lik band gerekmiyor ve filtre kuralı kotasını yemiyor.
  - Sayfa sinyalleri (`content/brain-signals.ts`, MAIN dünya): metin çizilmiş canvas'ın geri okunması (parmak izi) ve `localStorage`'a kimlik benzeri değer yazılması. Çağıran betik yığından bulunur. Sayfa bu olayı taklit edebileceği için yalnız ağdan zaten kaydı olan alan adına sayılır.
- [x] Katman 3: Gemini Nano hakemi (`engines/brain/nano-judge.ts`). Prompt API worker'da olmadığı için offscreen belgede çalışır (`nano.html`, `offscreen` izni; Firefox manifestinden çıkarılır), offscreen belge yalnız katman açıkken açılır. Varsayılan kapalı; panelden açılır, model indirme tıklamayla (kullanıcı etkinliği). Sayfa modeli 0,45–0,75 arasında ve en az bir reklam işareti varsa sayfa başına en çok 3 soru; yanıt `boolean` şemasıyla sınırlı, oturum önbelleği 500 soru. Evet derse içerik koruması ve bozulma bekçisi yine geçerli. Prompt API olmayan tarayıcıda (Firefox, eski Chrome) katman kendiliğinden kapalı.
- [x] Kademeli eylem: model tek başına yalnız ≥ 0,85'te ve yalnız kozmetik gizliyor (`MODEL_HIDE_PROBABILITY`; eğitim, kapıyı geçen eşiği bu değere kalibre eder). Katman 1 hiç DNR kuralı üretmez; ağ engeline terfi yalnız Katman 2'de ve plandan sıkı: 2 tür sinyal + 6 site.
- [x] Bağışıklık: `protected-hosts.ts`, `IMMUNE_ROOTS`.
- [x] Bozulma bekçisi: ana içerik hiç gizlenmez; düzen kayması > 0,5, görünür metnin yarısının gitmesi, kilitlenen kaydırma veya [Geri Al] → tüm gizlemeler geri sarılır, site 7 gün yalnızca liste modunda, gizlenenler unutturulur (`engines/brain/watchdog.ts`, `brain/broke`).
- [x] Açıklanabilirlik: popup'ta gizlenen her öğe, nedeni ve tek tek geri alma.
- [x] Taşma önlemi: sıfırla / dışa / içe aktar panelde; kişisel eğitim her ağırlığı ve sapmayı gönderilen modelden en çok ±2 uzaklaştırabilir (`MAX_DRIFT`), içe aktarılan model de aynı sınıra kırpılır.
- [x] Model güncellemeleri yalnız sürümle; kural dışa aktarma (ayar yedeği).

## Reklam engelleme motoru

- [x] Yinelenen ve alt küme kurallar: liste içi tekrarlar zaten atılıyordu; artık birleşik `requestDomains` kurallarında üst alan adı varken alt alan adı da atılıyor (`withoutCovered`). Çekirdek: varsayılan listeler 30.000'i aşarsa `fitBudget` tarama sıklığına (`--hits`, `brain-crawl` çıktısı `hosts.json`) göre en az görülenleri atar. Bugün varsayılan listelerde 25.513 kural, kırpma çalışmıyor.
- [x] `getAvailableStaticRuleCount()` havuz kontrolü ve Listeler sayfasında gösterim.
- [x] Haftalık otomatik sürüm (`lists.yml`); aradaki günlerde liste güncellemesi veri olarak dinamik kurallara, kozmetik motora ve artık `+js()` satırlarına iner (`scriptletDelta`: yalnız paketteki scriptlet'lerin adları ve argümanları, kod yok).
- [x] Kozmetik: prosedürel seçiciler, geç doldurulan alanlar; genel gizleme site başına ayrı kapatılabiliyor.
- [x] Anti-adblock scriptlet kapsamı: listelerde geçen adlardan desteklenmeyen 7 kaldı (Brave'e özgü 3'ü ve `nbc`, `multiup`, `mpegdash-prune`, `proxy-apply-config`).
- [x] Pop-up kalkanı: pop-under imzaları, orta tık / Ctrl+tık.
- [x] Öğe seçici + zapper + klavye; aynı kaynaklı iframe'lerin içinde seçim (e2e). Başka kaynaklı iframe tek kutu olarak seçilir.
- [x] Gelişmiş mod: site × üçüncü taraf × tür dinamik kural matrisi (`engines/core/matrix.ts`, kural ID 500–999); popup'ta bu sayfanın üçüncü tarafları için hücreler. Kısayol: `noop` site düzeyinde farklıysa daha geniş kuralı o sitede tümden kaldırır.
- [x] Site başına 4 seviye: Kapalı / Temel / Optimal / Tam (`shared/site-level.ts`, `site/setLevel`).

## Gizlilik

- [x] İzleyici istekleri, 3. taraf çerezleri, CDN'de yalnızca çerez silme, URL parametreleri.
- [~] Referrer: Chrome zaten siteler arası yalnız köken gönderiyor; ayrı kural yok (bilinçli).
- [x] Parmak izi gürültü / katı, WebRTC, GPC + DNT, otomatik çerez reddi, tıkla-yükle, youtube-nocookie.
- [x] Sekme kapanınca site verisini unut, `<a ping>` ve önceden yükleme kapalı.
- [x] Profiller: Dengeli, Sıkı, Paranoyak (üçüncü taraf betikler engelli, popup'tan site başına izin).
- [x] Yerel istatistik, sorun raporu adres içermez, Firefox `data_collection_permissions: none`.

## Güvenlik

- [x] Zararlı alan adları, engel sayfasında "yine de devam et".
- [x] Taklit alan adı: homograph + elle seçilmiş markalar + 5.000 yaygın site (`engines/security/brands.json`, `npm run brands`). Liste, önbellekteki çerez bildirimi listelerinden çevrimdışı çıkarılıyor (çerez bannerı gösteren ana akım siteler, kural sayısına göre); Tranco indirilmedi. Düzenleme mesafesi 9+ harfte ≤ 2, 6–8 harfte ≤ 1, aynı ilk harf; bilinen siteler birbirine benzetilmez. Bulgu düşük önemde. Ölçüm: listelerdeki 6.885 gerçek site adında 59 yanlış eşleşme (%0,9). Yetişkin site adları çıkarılır (genel kelimeler + SHA-256).
- [x] Sahte giriş: şifre başka kökene gidiyorsa uyarı; şifre alanına odaklanınca sayfanın başlığı, site adı (`og:site_name`, `application-name`) ve logo metni bilinen bir markayı adlandırıyor ama adres o markanın alan adlarından biri değilse yüksek risk (`engines/security/page-checks.ts`, `security/loginBrand`; arka plan sekme adresiyle yeniden doğrular). Sayfa gövdesi okunmaz: "Google ile giriş" düğmeleri uyarı vermez.
- [x] Teknik destek dolandırıcılığı ve kilit kırıcı.
- [x] Kripto madencisi: resource-abuse listesi + sezgi (`engines/security/miner.ts`, `content/miner-guard.ts`). Madenci adı (Worker dosyası, WASM export/import) ya da havuz soketi + iş → Worker'lar sonlandırılır, yenisi ve havuz soketi reddedilir, popup'ta yüksek risk. Yalnız biçim (çekirdek başına Worker + WASM; video düzenleyici/oyun da yapar) → durdurmadan düşük uyarı. Worker içinde derlenen WASM görülmez; CPU ölçümü yok.
- [x] Bildirim spam'i kalkanı.
- [x] Uzaktan kod yok, CSP, `sender.id` kontrolü, challenge sayfalarına enjeksiyon yok.
- [x] `webRequest` ve `declarativeNetRequestFeedback` isteğe bağlı izin; Katman 2 öğrenimi, ayrıntılı raporlar ve filtre günlüğü yalnız izin verilince çalışır, izin geri alınınca durur.
- [x] Tedarik zinciri: `npm audit --omit=dev`, SHA-256; `npm run pack` CycloneDX SBOM üretir (`ax-privacy-<sürüm>.cdx.json`, zaman/seri no çıkarılmış) ve SHA256SUMS'a ekler; zip zaman damgaları sabit (`SOURCE_DATE_EPOCH` ya da 1980-01-01); `npm run repro` iki kez derleyip paketler, fark varsa hata verir; release iş akışı ikisini de çalıştırır ve SBOM'u yayınlar.

## Video

- [x] YouTube budama + sessize alma; anti-adblock kutusu: tespiti önleyen scriptlet'ler (`json-prune`, `trusted-replace-xhr-response`, `trusted-rpfr`...) listelerden geliyor. Sapma: kutu yine çıkarsa gizlenmiyor (gizlenince YouTube videoyu durduruyor); seçiciyle görülüp o sekme reklam budamadan geri çekilir ve bir kez yenilenir (`content/yt-guard.ts`).
- [x] SponsorBlock önek sorgusu, kategori seçimi.
- [x] Twitch Worker kancası TS'te.
- [x] Firefox surrogate kök nedeni: Firefox surrogate'leri yüklüyor; e2e adresi port taşıdığı için yol içeren kurallar (`||host/yol`) eşleşmiyordu. Test artık 80 numaralı portu deniyor, 9/9 geçiyor.
- [x] Türk yayın siteleri: en çok izlenen 30 site için canlı denetim (`e2e/tr-video-check.ts`, `docs/tr-video-check.json`). 23.11.2026: 29/30 yüklendi, AX açıkken 29'unda video reklam isteği 0 (AX'siz toplam 2xx yanıt sayıları dosyada). CI'da değil: sonuç ağa ve saate bağlı.

## Arayüz

- [x] v4 popup düzeni, kontrol paneli aynı temada.
- [x] Popup: site seviyesi seçici (Kapalı / Temel / Optimal / Tam).
- [x] Popup: yapay zekâ gizleme satırı ve tek tek geri alma.
- [x] "Bu sitede bir şey bozuk": katmanlar tek tek, plandaki sırayla (genel gizleme → scriptlet → yapay zekâ → kozmetik → gizlilik → video → ağ); yalnız sorunu çözen kapalı kalır.
- [x] Panel genel bakış: tasarruf edilen veri ve süre tahmini (`estimateSavings`, varsayımlar kodda ve ekranda).
- [x] Listeler: kategori, kural sayısı, kota, bölge (`region`) ve son güncelleme (bu sürüm için indirilen son kopya; yoksa "paketteki kopya").
- [x] Kural editörü: sözdizimi renklendirme, satır satır anlık hata, imlecin olduğu satırın kapsamı, eşleşme önizlemesi.
- [x] Filtre günlüğü (isteğe bağlı `webRequest` ile): sekme seçimi, istekler, "Kuralları göster" ile engelleyen kural metni.
- [x] Gizlilik ve Güvenlik: profil seçimi ve son tehdit olayları günlüğü.
- [x] AX-Brain paneli: durum, kapalı siteler, sıfırla / dışa / içe aktar; güven eşiği kaydırıcısı (%50–99, `brain/setThreshold`) ve öğrenilen izleyiciler var; Katman 3 anahtarı ve indirme durumu var.
- [x] Yedekleme: tek JSON.
- [x] TR / EN, açık / koyu tema, karşılama sayfası.

## Kalite ve yayın

- [x] Vitest birim testleri, kural doğrulama, derleyici fuzz testi.
- [x] Eski hattın 9 Node test betiği Vitest'te karşılanıyor: `test-ax-brain` → `brain.test`, `test-universal-ad-scorer` → `scorer.test`, `test-cosmetic-compiler` → `cosmetic-engine.test` + `compiler-fuzz.test`, `test-filter-updater` → `updates.test`, `test-popup-vignette` → `popup.test`, `test-punycode` → `network.test` (`toAsciiDomain`) + `url.test`, `test-twitch-gql` → `twitch.test`, `test-youtube-pruner` → `youtube.test`, `validate-rules` → `rulesets-static.test`.
- [~] E2E: Chromium (Chrome yerine) / Firefox / Brave. Edge yok: Chrome gibi Edge de paketlenmemiş eklentiyi komut satırından yüklemeyi kaldırdı, Playwright onu süremez; bu makinede Edge kurulu da değil.
- [x] Site taraması (`site-check`), performans ölçümü (`baseline`, `resource-check`).
- [x] Yapay zekâ kapısı (kesinlik ≥ %98, yanlış gizleme ≤ %0,5): `brain-train.ts` geçmezse ağırlık yazmaz; `rich.test.ts` paketteki ağırlıkların kapı sonucunu doğrular. 24.11.2026 eğitimi: 10.977 siteden 7.602'si açıldı, 71.164 satır; eğitimde görülmeyen sitelerde 8.904 satır (511 reklam): kesinlik %98,8, yanlış gizleme %0,036, duyarlılık %49. Sapma: altın set elle doğrulanmadı (yukarıda).
- [x] Sürüm tek kaynaktan (`package.json`), 5.0.0.
- [x] Değişiklik günlüğü (`CHANGELOG.md`).
- [x] E2E'de telemetri = 0 (`e2e/telemetry.spec.ts`): service worker, popup ve panel, gezinme boyunca kendi dosyaları dışında hiçbir adrese istek atmıyor. Dış istek eklenince testin düştüğü elle doğrulandı.
