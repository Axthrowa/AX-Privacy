import { send } from '../shared/messages.ts';
import type { Settings, VideoSettings } from '../shared/types.ts';
import { Toggle } from './Toggle.tsx';

export function Video({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const { video } = settings;
  const set = (patch: Partial<VideoSettings>) =>
    void guard(() => send('video/set', { video: patch }));

  return (
    <section>
      <h2>YouTube ve Twitch</h2>
      <p className="muted">
        Reklam sunucuları, izleme istekleri ve görüntülü reklam alanları her iki sitede de filtre
        listeleriyle engellenir. Değişiklikler sayfa yenilenince geçerli olur.
      </p>

      <Toggle
        label="YouTube video reklamlarını kaldır"
        checked={video.youtubeAds}
        onChange={(on) => set({ youtubeAds: on })}
      />
      <p className="note">
        Oynatıcı yanıtlarındaki reklam programı (<code>adPlacements</code>, <code>adSlots</code>,{' '}
        <code>playerAds</code>) ve Shorts reklamları sayfa içinde silinir. Hiçbir istek
        yönlendirilmez, hesap veya çerez bilgisine dokunulmaz. YouTube reklamı videonun içine
        sunucuda gömerse (SSAI) kaldırılamaz.
      </p>

      <Toggle
        label="Twitch video reklamlarını kaldır"
        checked={video.twitchAds}
        onChange={(on) => set({ twitchAds: on })}
      />
      <p className="note">
        Reklam sırasında oynatıcı, Twitch’ten reklamsız bir oynatma listesi ister; yoksa reklam
        parçaları boş bir klibe çevrilir ve reklam bitene kadar görüntü kısa süre donabilir. Bu
        istekler anonimdir: Twitch hesabınız, çerezleriniz veya oturum anahtarınız kullanılmaz.
        Twitch yöntemini değiştirirse reklamlar geri gelebilir; yayın yine oynar.
      </p>

      <Toggle
        label="Sponsorlu kartları işaretle"
        checked={video.markSponsored}
        onChange={(on) => set({ markSponsored: on })}
      />
      <p className="note">
        Listelerin gizlemediği reklam kartları kesik turuncu çerçeve ve “Sponsorlu” etiketiyle
        gösterilir. Yalnızca CSS; sayfa taranmaz.
      </p>

      <Toggle
        label="Gömülü YouTube videolarını youtube-nocookie.com ile aç"
        checked={video.nocookieEmbeds}
        onChange={(on) => set({ nocookieEmbeds: on })}
      />
      <p className="note">
        Başka sitelere gömülü oynatıcılar YouTube’un gizlilik geliştirilmiş alan adından yüklenir;
        video oynatılana kadar çerez bırakılmaz. Gömülü oynatıcıda YouTube hesabınız görünmez (sonra
        izle, abonelik düğmesi).
      </p>

      <Toggle
        label="Kaldırılamayan reklamlarda sesi kapat ve görüntüyü karart"
        checked={video.adMute}
        onChange={(on) => set({ adMute: on })}
      />
      <p className="note">
        YouTube’un sunucuda videoya gömdüğü reklamlar ve Twitch’te kaldırılamayanlar için: oynatıcı
        kendi reklam işaretini gösterdiği sürece video sessize alınır ve karartılır; reklam bitince
        ses geri açılır. Sizin kapattığınız ses açılmaz.
      </p>

      <Toggle
        label="YouTube sponsor bölümlerini atla (SponsorBlock)"
        checked={video.sponsorSkip}
        onChange={(on) => set({ sponsorSkip: on })}
      />
      <p className="note">
        Videodaki sponsor bölümleri, gönüllülerin işaretlediği{' '}
        <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">
          SponsorBlock
        </a>{' '}
        verisiyle atlanır (veri lisansı CC BY-NC-SA 4.0). Açıkken izlediğiniz her video için
        sponsor.ajay.app’e istek gider; video kimliği gönderilmez, yalnızca kimliğin SHA-256
        özetinin ilk 4 karakteri gider. Bu öneki YouTube’daki çok sayıda video paylaşır; sunucu o
        öneke ait bütün kayıtları döndürür ve eşleştirme tarayıcıda yapılır. Sunucu IP adresinizi ve
        istek zamanını görür. Çerez gönderilmez, sonuç yalnızca bellekte tutulur.
      </p>
    </section>
  );
}
