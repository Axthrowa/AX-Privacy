# Phase 10: Yayın

Sürüm 0.10.0. Mağazaya gönderilmedi. Çıktı iki zip, gizlilik metni, kurulum ve boş bir profilde çalışan kurulumdur.

## Paket

`npm run pack` `dist/chrome` ve `dist/firefox` klasörlerini zip’ler, açıp `manifest.json` adını ve sürümünü kontrol eder. Zip adları `docs/KURULUM.md` içindedir. `dist/` depoya yazılmaz.

## Mağaza gerekçesi (gönderilmedi)

`declarativeNetRequestFeedback` izni yok; engellenen isteğin listesi `testMatchOutcome` ile okunur.

`host_permissions` (`http://*/*`, `https://*/*`) şunlar için duruyor: üçüncü taraf çerez başlığını silmek ve youtube-nocookie yönlendirmesi (DNR `modifyHeaders` / `redirect`), gözlem amaçlı `webRequest` sekme raporu, kullanıcının eklediği listeyi indirmek, içerik betiklerini http(s) sayfalara kaydetmek. Statik engelleme kuralları tek başına bu izni istemez; başlık değiştirme ve rapor ister.

Firefox manifestinde `data_collection_permissions.required` `none`. Uzaktan kod yok.

## Temiz kurulum

Chrome zip’i açılıp atılabilir bir Brave profiline yüklendi. Kullanıcının kendi profiline dokunulmadı. EasyList ve EasyPrivacy açıktı, `www.googletagmanager.com` betiği çalışmadı, Hakkında sayfası açıldı. Firefox zip’i açılıp Firefox 159’da aynı duman testinden geçti: kurulum, gizleme, ağ engeli, YouTube reklam planı, sponsorlu kart. 5/5.

## Testler

- Birim: zip aç-kapa dahil.
- `node e2e/clean-install.ts` Chromium paketini boş profilde çalıştırır.
