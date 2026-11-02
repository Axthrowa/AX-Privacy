import { send } from '../shared/messages.ts';
import type { FingerprintLevel, PrivacySettings, Settings } from '../shared/types.ts';
import { Toggle } from './Toggle.tsx';

const LEVELS: { value: FingerprintLevel; label: string }[] = [
  { value: 'off', label: 'Kapalı' },
  {
    value: 'standard',
    label: 'Standart: canvas, WebGL ve ses okumalarına site başına sabit gürültü',
  },
  { value: 'strict', label: 'Sıkı: Standart + GPU modelini ve 4’ten fazla CPU çekirdeğini gizle' },
];

export function Privacy({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const { privacy } = settings;
  const set = (patch: Partial<PrivacySettings>) =>
    void guard(() => send('privacy/set', { privacy: patch }));

  return (
    <section>
      <h2>Gizlilik</h2>
      <p className="muted">
        Takip parametresi temizleme ve çerez bildirimi gizleme “Filtre listeleri” bölümündeki
        AdGuard URL Tracking ve EasyList Cookie List ile açılıp kapanır. Değişiklikler açık
        sekmelerde sayfa yenilenince geçerli olur; duraklatılan sitelerde hiçbiri çalışmaz.
      </p>

      <Toggle
        label="Üçüncü taraf çerezlerini engelle"
        checked={privacy.blockThirdPartyCookies}
        onChange={(on) => set({ blockThirdPartyCookies: on })}
      />
      <p className="note">
        Başka sitelere giden isteklerden Cookie ve Set-Cookie başlıkları silinir. Gömülü giriş
        pencereleri, yorum eklentileri ve bazı ödeme sayfaları bozulabilir; o sitede korumayı
        duraklatın.
      </p>

      <Toggle
        label="Çerez bildirimlerini otomatik reddet"
        checked={privacy.cookieAutoReject}
        onChange={(on) => set({ cookieAutoReject: on })}
      />
      <p className="note">
        DuckDuckGo autoconsent (MPL-2.0) kurallarıyla tanınan bildirimlerde yalnızca “reddet” /
        “gerekli olanlar” seçilir; hiçbir zaman kabul edilmez. Tanınmayan bildirimlere dokunulmaz.
        Sayfa bağlamında yalnızca kütüphaneyle gelen hazır kod parçaları çalışır.
      </p>

      <Toggle
        label="Takip etmeme sinyali gönder (Global Privacy Control)"
        checked={privacy.gpc}
        onChange={(on) => set({ gpc: on })}
      />
      <p className="note">
        Her istekte <code>Sec-GPC: 1</code> başlığı ve sayfalara{' '}
        <code>navigator.globalPrivacyControl</code> sinyali gider. Bazı yasalarda (ör. CCPA)
        bağlayıcıdır; siteler uymak zorunda olmayabilir.
      </p>

      <Toggle
        label="İzleme yönlendirmelerini atla"
        checked={privacy.cleanLinks}
        onChange={(on) => set({ cleanLinks: on })}
      />
      <p className="note">
        Hedefi adresin içinde yazan bilinen yönlendirme bağlantılarında (Google, Facebook, YouTube
        ve Brave’in listesindeki izleme ağları) doğrudan hedefe gidilir. İzleme sunucusuna hiç
        uğranmaz.
      </p>

      <Toggle
        label="Gerekli ama izleyen sunucularda yalnızca çerezi engelle"
        checked={privacy.cdnCookies}
        disabled={privacy.blockThirdPartyCookies}
        onChange={(on) => set({ cdnCookies: on })}
      />
      <p className="note">
        Sitelerin çalışması için gereken bazı sunucuların dosyaları yüklenir, üçüncü taraf çerezleri
        silinir (Privacy Badger’ın listesi; giriş, ödeme ve banka adresleri hariç). Tüm üçüncü taraf
        çerezlerini engelliyorsanız bu zaten kapsanır.
      </p>

      <Toggle
        label="Ayrıntılı raporlar ve günlük istatistik"
        checked={privacy.detailedReports}
        onChange={(on) => set({ detailedReports: on })}
      />
      <p className="note">
        Açılır penceredeki alan adı listesini ve Özet’teki reklam / izleyici sayaçlarını tutar.
        Bunun için arka plan her istekte uyanır, bu yüzden varsayılan olarak kapalıdır. Engelleme bu
        ayardan etkilenmez.
      </p>

      <label className="field">
        <span>Parmak izi koruması</span>
        <select
          aria-label="Parmak izi koruması"
          value={privacy.fingerprint}
          onChange={(e) => set({ fingerprint: e.target.value as FingerprintLevel })}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <p className="note">
        Gürültü aynı sitede hep aynıdır, farklı sitelerde farklıdır; böylece okunan değer siteler
        arası eşleştirmede işe yaramaz. Sınırlar: Web Worker’lar kapsanmaz, sarmalanan fonksiyonlar
        tespit edilebilir, AX'e özel yazılmış bir betik gürültüyü geri alabilir. Yazı tipi, ekran,
        saat dilimi ve WebRTC yüzeyleri bu aşamada korunmuyor.
        {settings.isBrave &&
          ' Brave kendi parmak izi korumasını (farbling) zaten uyguluyor; ikisini birlikte açmak gerekmez.'}
      </p>
    </section>
  );
}
