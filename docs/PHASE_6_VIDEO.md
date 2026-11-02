# Phase 6: Video koruması

Sürüm 0.6.0. Bu aşamada YouTube'un oynatıcı verisindeki reklam planı kaldırılıyor. Hâlâ görünen sponsorlu kartlar işaretleniyor. Twitch'te liste kurallarıyla reklam sunucuları engelleniyor ve görüntülü reklam alanları gizleniyor.

İsteğe bağlı (varsayılan kapalı) üç seçenek var:

- Gömülü YouTube videolarını youtube-nocookie.com üzerinden açma.
- Kaldırılamayan reklamlarda sesi kapatıp görüntüyü karartma.
- SponsorBlock ile sponsor bölümlerini atlama.

Hiçbir ağ trafiğine müdahale edilmiyor: proxy, oynatma listesi veya token değişikliği yok. DRM, çerez ve hesap verilerine dokunulmuyor.

## Modüller

| Modül                                      | Nasıl çalışıyor                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Varsayılan |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| YouTube reklam planı (`yt-ads`)            | `content/yt-ads.js` sayfanın kendi ortamında (MAIN world) ve `document_start` anında çalışıyor. Oynatıcı yanıtlarından `adPlacements`, `adSlots`, `playerAds`, `adBreakHeartbeatParams` alanlarını siliyor (üst düzeyde ve `playerResponse` altında). Ayrıca Shorts akışından reklam girdilerini (`adClientParams.isAd`) çıkarıyor. Ayrıntılar aşağıda. Saf mantık `engines/video/youtube.ts`'te                                                                    | Açık       |
| Sponsorlu kart işareti                     | `content/yt-sponsored.css`, içinde reklam rozeti veya reklam bileşeni bulunan akış kartlarına kesikli turuncu çerçeve ve "Sponsorlu · AX" etiketi ekliyor. Yalnızca CSS kullanılıyor; kart gizlenmiyor, sayfadan veri okunmuyor                                                                                                                                                                                                                                     | Açık       |
| youtube-nocookie gömme                     | Başka sitelerdeki `youtube.com/embed/...` çerçeveleri, DNR yönlendirme kuralıyla (`transform.host`) `www.youtube-nocookie.com`'a gidiyor. YouTube'un kendi sayfaları hariç tutuluyor                                                                                                                                                                                                                                                                                | Kapalı     |
| Reklam sırasında ses kapatma (`video-ads`) | YouTube ve Twitch'te, oynatıcı kendi reklam işaretini gösterdiği sürece video sessize alınıyor ve karartılıyor (`brightness(0.15)`). Reklam bitince ses geri açılıyor. Kullanıcının kendi kapattığı ses açılmıyor; reklam sırasında kullanıcı sesi açarsa yeniden kapatılmıyor. İşaretler: YouTube `.html5-video-player.ad-showing`; Twitch `video-ad-label`, `video-ad-countdown` ve "Learn more about this ad" düğmesi. Saf mantık `engines/video/ad-state.ts`'te | Kapalı     |
| SponsorBlock (`yt-skip`)                   | İzlenen videonun sponsor bölümleri, bir kez ve ileri sarılarak atlanıyor. Geri sarılırsa bölüm oynuyor; reklam sırasında atlama yapılmıyor. Arka plan, video kimliğinin SHA-256 özetinin ilk 4 karakteriyle `sponsor.ajay.app`'e soruyor ve eşleştirmeyi kendisi yapıyor. Ayrıntılar aşağıda                                                                                                                                                                        | Kapalı     |
| Twitch (listeler)                          | EasyList `\|\|edge.ads.twitch.tv^` ve `twitch.tv##.stream-display-ad__wrapper`, uBlock filters'ın Twitch kuralları                                                                                                                                                                                                                                                                                                                                                  | Açık       |
| Listelerin günlük güncellenmesi            | Kullanıcının eklediği listeler `chrome.alarms` ile günde bir kez yeniden indiriliyor; hata olursa listenin önceki hali korunuyor. Yalnızca filtre metni indiriliyor, kod çalıştırılmıyor. Yeni izin: `alarms` (kuruluşta uyarı göstermiyor)                                                                                                                                                                                                                         | Açık       |
| Dashboard "YouTube ve Twitch"              | Beş anahtar ve her birinin sınırlarını anlatan açıklamalar. Ayarlar `video/set` mesajıyla yalnızca arayüzden değiştirilebiliyor                                                                                                                                                                                                                                                                                                                                     | —          |
| Cosmetic hata düzeltmesi (listeler)        | `##seçici {css}` biçimindeki satırlar Ghostery motorunda aynı gruptaki tüm seçicileri geçersiz kılıyordu. Gömülü listelerde bu satırlar artık motora alınmıyor (`safeCosmeticLines`). uBlock motoru 1.429 KB'tan 491 KB'a indi                                                                                                                                                                                                                                      | —          |

### YouTube reklam planı nasıl kaldırılıyor

YouTube oynatıcısı, reklamları sayfaya gömülü `ytInitialPlayerResponse` nesnesinden ve `/youtubei/v1/player` yanıtından okuyor. Betik üç noktada bu veriyi temizliyor:

1. `window.ytInitialPlayerResponse` ve `ytInitialReelWatchSequenceResponse` için bir ayarlayıcı (setter). Sayfa değeri atadığında reklam alanları siliniyor.
2. `JSON.parse` sarmalayıcısı.
3. `Response.prototype.json` sarmalayıcısı.

Sarmalayıcılar `Proxy` ile yapılıyor. `Function.prototype.toString` de aynı şekilde sarılıyor ve orijinal fonksiyonun metnini döndürüyor. Bu yüzden `name`, `length` ve `toString()` sonucu, değiştirilmemiş yerleşik fonksiyonla birebir aynı.

Bu kaynak kodu AX'e ait; uBlock'un `json-prune` betiği kopyalanmadı. Yalnızca alan adları kamuya açık bilgi olarak kullanıldı.

### SponsorBlock'ta gizlilik

- İstek: `GET https://sponsor.ajay.app/api/skipSegments/<4 karakter>?categories=["sponsor"]`. Çerez (`credentials: 'omit'`) ve referrer gönderilmiyor.
- Video kimliği istekte yer almıyor. Canlı denemede aynı öneki 43–45 kayıtlı video paylaşıyordu. Yanıt bunların hepsini içeriyor ve doğru video tarayıcıda seçiliyor.
- Sunucu yine de IP adresini ve istek zamanını görüyor. Bu yüzden seçenek varsayılan olarak kapalı ve dashboard'da açıkça yazıyor.
- Sonuçlar yalnızca service worker belleğinde tutuluyor (en fazla 100 video). Hiçbir şey diske yazılmıyor.
- Arka plan, isteği yalnızca seçenek açıksa ve site duraklatılmamışsa yapıyor. İçerik betiği bunu kendi başına tetikleyemiyor.
- Veri lisansı CC BY-NC-SA 4.0. Dashboard'da kaynak belirtiliyor. AX ticari bir ürün olursa bu seçenek lisans gereği kaldırılmalı.

## Ölçülen gerçekler

### Yerel testler (simüle edilmiş sayfalar)

- **YouTube reklam planı:** Dört veri yolunun tamamında yalnızca `videoDetails` kaldı: gömülü değişken, global nesne, `fetch().json()` ve `JSON.parse`. Sarmalanan fonksiyonlar sayfaya `function parse() { [native code] }` olarak göründü. Seçenek kapatılınca betiğin kaydı siliniyor ve aynı yanıt reklam alanlarıyla geliyor.
- **Sponsorlu işaret:** Reklam kartı kesikli çerçeve ve etiket aldı, normal video kartı almadı.
- **nocookie:** Gömülü çerçeve `www.youtube-nocookie.com/embed/nexus` adresine gitti.
- **Ses kapatma:** YouTube'da `ad-showing` sınıfı, Twitch'te `video-ad-label` öğesi eklenince video sessize alındı ve karartıldı. İşaret kalkınca ikisi de geri döndü.
- **SponsorBlock:** Yerel sahte sunucuya tek istek gitti: `/api/skipSegments/5f6b?categories=...`. İstekte video kimliği yoktu. 12. saniyedeki video 20. saniyeye atlandı.
- **Twitch:** `.stream-display-ad__wrapper` gizlendi, sohbet görünür kaldı. `edge.ads.twitch.tv` betiği sunucuya hiç ulaşmadı.

### Canlı kontrol (`npm run live-check`, `docs/live-check.json`)

Elle çalıştırılıyor; CI'da değil. Sonuçlar ağa, bölgeye ve o an reklam planlanıp planlanmadığına bağlı. Test profilleri geçici; hesap yok ve çerezler saklanmıyor.

- **YouTube:** AX olmadan gerçek oynatıcı yanıtında `adPlacements` ve `adBreakHeartbeatParams` vardı; AX ile ikisi de silindi. Video iki durumda da 20 saniye boyunca normal oynadı. AX ile `JSON.parse` yerel kod olarak göründü.
- **Twitch:** Ses kapatmada kullanılan üç reklam işareti, Twitch'in o gün sunduğu oynatıcı kodunda vardı. Yayın AX ile normal oynadı.
- **Sınır:** Ölçüm süresince iki sitede de reklam oynamadı. Bu yüzden gerçek bir reklam sırasında ses kapatmanın çalıştığı canlı olarak gözlenmedi. Bu yalnızca yerel testlerle ve işaretlerin oynatıcı kodunda bulunmasıyla destekleniyor.
- **SponsorBlock API (`node e2e/sponsorblock-live.ts`):** Gerçek yanıt biçimi ayrıştırıcıyla uyumlu çıktı; aynı kovadaki bir video için `[0, 31.861]` bölümü okundu.

### Firefox (`npm run e2e:firefox`)

Gerçek Firefox 159'da WebDriver BiDi ile test edildi. Testte tüm alan adları `127.0.0.1`'e çözülüyor, yani dışarı istek gitmiyor. Sonuç 5/5:

- Eklenti kuruluyor.
- Listelerden öğe gizleme çalışıyor.
- Ağ engelleme çalışıyor.
- MAIN world'de YouTube reklam planı siliniyor ve sarmalayıcılar yerel görünüyor.
- CSS içerik betiği çalışıyor.

### Performans (`docs/runtime-baseline.json`)

AX 0.6.0 ile 6/6 reklam ve 7/7 izleyici engellendi. Ortanca yükleme 27 ms, bellek 541 MB. 0.5.0'da bu değerler 30 ms ve 563 MB'tı.

## Desteklenmeyen veya eksik olanlar

| Konu                                                    | Neden ve alternatif                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sunucu tarafında birleştirilen reklamları silmek (SSAI) | Oynatma listesini veya erişim token'ını değiştirmeyi gerektiriyor; bu, platform güvenlik mekanizmasına müdahale olur ve yapılmıyor. Alternatif olarak reklam sırasında ses kapatma ve karartma eklendi. Reklamın süresi kısalmıyor                                                                     |
| Sarmalayıcıların tamamen gizlenmesi                     | `toString`, `name` ve `length` artık aynı. Ama `ytInitialPlayerResponse` için tanımlanan erişimci (`getOwnPropertyDescriptor`) ve zamanlama farkları yine fark edilebilir. YouTube reklam engelleyici uyarısı gösterebilir                                                                             |
| YouTube'un JSON alan adlarını değiştirmesi              | Betikteki alan listesi sürümle güncelleniyor; uzaktan kod çalıştırılmıyor. Kullanıcının eklediği listeler artık her gün güncelleniyor, ama bu yalnızca liste kurallarını (gizleme ve engelleme) kapsıyor, betik mantığını değil. Değişiklik olursa oynatma bozulmuyor, yalnızca reklamlar geri geliyor |
| Dashboard ayarlarının Firefox'ta e2e testi              | Firefox'un BiDi uygulaması `moz-extension://` sayfalarına gezinmeye izin vermiyor. Ayar değiştirme yalnızca Brave'de uçtan uca test edildi; Firefox'ta varsayılan ayarlarla çalışan özellikler test edildi                                                                                             |
| Firefox'ta SponsorBlock ve ses kapatma                  | Aynı nedenle Firefox'ta açılamadılar ve test edilmediler                                                                                                                                                                                                                                               |

## Testler

- **Birim (Vitest), 19 dosya, 126 test:**
  - `youtube.test.ts`: alan silme, `playerResponse` altındaki veri, dizi yanıtlar, Shorts reklam girdileri.
  - `ad-state.test.ts` (yeni): site eşleşmesi; ses kapatıp geri verme; kullanıcının tercihine saygı.
  - `sponsorblock.test.ts` (yeni): SHA-256 öneki (OpenSSL ile bağımsız doğrulandı); yanıt doğrulama; tek seferlik atlama; video kimliği okuma.
  - Ayarlar, mesajlar (`video/segments` yalnızca geçerli video kimliği kabul ediyor), router (SponsorBlock yalnızca seçenek açıkken ve korunan sitede soruluyor), kontrol kuralları ve manifest izinleri.
- **E2E (Playwright + Brave 156), 28 test:** Bunların 6'sı `e2e/video.spec.ts`'te. Tüm takım üç kez tekrar edildi: 84/84 geçti. youtube.com ve twitch.tv HSTS listesinde olduğu için testler geçici, kendinden imzalı sertifikalı yerel bir HTTPS sunucusu kullanıyor. `sponsor.ajay.app` yerel sunucuya eşleniyor. Gerçek sitelere istek gitmiyor.
- **Firefox 159 (BiDi):** 5/5, üç ardışık çalıştırmada.
- `web-ext lint`: 0 hata, 3 uyarı (öncekiyle aynı). `npm audit`: 0 açık.
