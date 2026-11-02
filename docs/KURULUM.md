# Kurulum

Sürüm 0.10.0. Mağaza paketi yoktur. Zip’ler `npm run build` ardından `npm run pack` ile `dist/` içine yazılır:

- `dist/nexus-privacy-0.10.0-chrome.zip` — Chromium (Brave, Chrome, Edge)
- `dist/nexus-privacy-0.10.0-firefox.zip` — Firefox 140 ve üstü

Zip’i açın. `manifest.json` klasörün içinde durmalı.

## Brave, Chrome veya Edge

1. `brave://extensions`, `chrome://extensions` veya `edge://extensions` açın.
2. Geliştirici modunu açın.
3. "Paketlenmemiş öğe yükle" deyin ve zip’i açtığınız klasörü seçin.
4. Araç çubuğundaki AX simgesinden açma/kapama ve site duraklatma yapılır. Ayrıntı panel için simgeye sağ tıklayıp seçeneklere gidin.

Bu kurulum mağaza güncellemesi almaz. Yeni sürüm için klasörü değiştirip eklentiler sayfasında yenileye basın.

## Firefox

1. `about:debugging#/runtime/this-firefox` açın.
2. "Geçici eklenti yükle" deyin ve açılmış klasördeki `manifest.json` dosyasını seçin.
3. Geçici yükleme Firefox kapanınca kalkar. Kalıcı kurulum Mozilla imzası ister; bu zip imzalı değildir.

Android ve mağaza yayını bu pakette yoktur.

## İlk açılış

Koruma açıktır. Parmak izi gürültüsü, üçüncü taraf çerez silme, çerez bildirimi reddi, reklamı sessize alma ve SponsorBlock kapalıdır. YouTube reklam alanlarını silme ve "Sponsorlu" işaretleme açıktır. Liste metinleri paketin içindedir; kurulumda dışarıdan liste indirilmez.
