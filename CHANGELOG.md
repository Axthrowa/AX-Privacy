# Değişiklik günlüğü

Eski sürümlerin ayrıntıları `docs/PHASE_*.md` dosyalarında. Plan maddelerinin durumu: `docs/V5_PLAN_STATUS.md`.

## 5.0.0

### AX-Brain 2.0

- **Katman 1:** 12 yerine 48 özellik (geometri, bağlantı, içerik, hash'lenmiş kelime torbası, DOM, davranış) ve paketle gelen küçük bir MLP (48 → 32 → 1, ~1.600 parametre, saf TS). Ağırlıklar `src/engines/brain/mlp-weights.json`.
- **Çevrimdışı eğitim:** `scripts/brain-crawl.ts` Tranco ilk 10.000 + `.tr` ilk 1.000 siteyi başsız Chromium'la tarar; paketteki kozmetik filtrelerin gizleyeceği öğeler 1, kalan görünür adaylar 0 etiketi alır. Site adı yazılmaz, yalnız SHA-256 öneki. `scripts/brain-train.ts` siteye göre ayrılmış test setinde kalite kapısını (kesinlik ≥ %98, yanlış gizleme ≤ %0,5) geçmezse ağırlık yazmaz. Bu sürümün ağırlıkları: 7.602 siteden 71.164 örnek; eğitimde görülmeyen sitelerde kesinlik %98,8, yanlış gizleme %0,036, duyarlılık %49. Elle doğrulanmış altın set yok.
- **Kişisel başlık:** kullanıcının 12 özellikli lojistik modeli MLP'nin kararını kaydırır; ana ağırlıklar donuk kalır.
- **Katman 2:** ağ davranışından izleyici öğrenimi (3+ sitede çerez silme, 6+ site ve 2 sinyalde engel).
- **Katman 3:** Gemini Nano hakemi (isteğe bağlı, cihazda).
- Bozulma bekçisi, açıklanabilir gizleme ve tek tek geri alma.

### Engelleme

- Liste içinde, üst alan adı zaten listelenmişse alt alan adı kuralı atılır. Varsayılan listeler tarayıcının garanti ettiği 30.000 statik kuralı aşarsa derleyici en az görülen kuralları atar (`npm run filters -- --hits hosts.json`, tarama sıklığına göre).
- Liste güncellemelerinden gelen `+js()` satırları sürüm beklemeden sayfaya veri olarak ulaşır (uzaktan kod yok).
- Gelişmiş mod: site × üçüncü taraf × tür dinamik kural matrisi; popup'ta hücreler.
- Yeni scriptlet'ler: `trusted-*` ailesi, `json-edit-*`, `jsonl-edit-*`, `prevent-canvas`, `prevent-dialog`, `prevent-navigation` ve diğerleri. Desteklenmeyen 7 ad kaldı.
- Öğe seçici aynı kaynaklı iframe'lerin içine de girer.

### Gizlilik ve izinler

- **Paranoyak** profil: üçüncü taraf betikler engellenir, site başına izin popup'tan.
- `webRequest` artık isteğe bağlı izin: Katman 2 öğrenimi ve filtre günlüğü yalnız izin verilince çalışır.

### Arayüz

- Filtre günlüğü (isteğe bağlı izinle), istek başına onu durduran kural.
- Kural editörü: sözdizimi renklendirme, satır satır anlık hata, imlecin olduğu satırın kapsamı, eşleşme önizlemesi.
- Genel bakış: tasarruf edilen veri ve süre tahmini.
- Listeler: bölge ve son güncelleme zamanı.

### Firefox

- Surrogate dosyaları Firefox'ta yükleniyor. Önceki "yüklenmiyor" gözlemi test adresindeki port yüzündendi: yol içeren kurallar (`||host/yol`) port taşıyan adreste eşleşmiyordu.

### Test

- E2E: eklentinin kendisi gezinme, popup ve panel boyunca hiçbir dış adrese istek atmıyor (telemetri = 0).
- `e2e/tr-video-check.ts`: en çok izlenen 30 Türk yayın sitesinde video reklam isteklerinin canlı denetimi.
- Eski hattın 9 Node test betiğinin karşılıkları Vitest'te.
