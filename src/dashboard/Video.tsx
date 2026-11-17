import { useEffect, useState } from 'react';
import { L, LOCALE } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import { SPONSOR_CATEGORIES, SPONSOR_LABELS } from '../shared/sponsor.ts';
import type { SkipMode } from '../shared/sponsor.ts';
import type { Settings, VideoSettings, YoutubeWarnings } from '../shared/types.ts';
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
  const [warnings, setWarnings] = useState<YoutubeWarnings | null>(null);
  useEffect(() => {
    send('video/warnings', {})
      .then(setWarnings)
      .catch(() => undefined);
  }, []);
  const [channels, setChannels] = useState(video.sponsorChannels.join('\n'));

  return (
    <section>
      <h2>{L('YouTube ve Twitch', 'YouTube and Twitch')}</h2>
      <p className="muted">
        {L(
          'Reklam sunucuları, izleme istekleri ve görüntülü reklam alanları her iki sitede de filtre listeleriyle engellenir. Değişiklikler sayfa yenilenince geçerli olur.',
          'Ad servers, tracking requests and display ad slots are blocked on both sites by the filter lists. Changes apply after a page reload.',
        )}
      </p>

      <Toggle
        label={L('YouTube video reklamlarını kaldır', 'Remove YouTube video ads')}
        checked={video.youtubeAds}
        onChange={(on) => set({ youtubeAds: on })}
      />
      <p className="note">
        {L(
          <>
            Oynatıcı yanıtlarındaki reklam programı (<code>adPlacements</code>, <code>adSlots</code>
            , <code>playerAds</code>) ve Shorts reklamları sayfa içinde silinir. Hiçbir istek
            yönlendirilmez, hesap veya çerez bilgisine dokunulmaz. YouTube reklamı videonun içine
            sunucuda gömerse (SSAI) kaldırılamaz.
          </>,
          <>
            The ad schedule in player responses (<code>adPlacements</code>, <code>adSlots</code>,{' '}
            <code>playerAds</code>) and Shorts ads are removed inside the page. No request is
            redirected and no account or cookie data is touched. Ads YouTube stitches into the video
            on its servers (SSAI) cannot be removed.
          </>,
        )}
      </p>
      <p className="note">
        {L(
          'YouTube “reklam engelleyicilere izin verilmiyor” uyarısı gösterirse AX o sekmede reklam kaldırmayı bırakır ve sayfayı bir kez yeniler; video reklamlı da olsa oynar. Sekme kapanınca bu durum sona erer.',
          'If YouTube shows its “ad blockers are not allowed” warning, AX stops removing ads in that tab and reloads the page once; the video plays, with ads if need be. This ends when the tab closes.',
        )}
        {warnings && warnings.count > 0 && (
          <>
            {' '}
            {L(
              `Uyarı şimdiye kadar ${warnings.count} kez görüldü`,
              `The warning has been seen ${warnings.count} times`,
            )}
            {warnings.last &&
              L(
                `, en son ${new Date(warnings.last).toLocaleString(LOCALE)}`,
                `, last on ${new Date(warnings.last).toLocaleString(LOCALE)}`,
              )}
            .
          </>
        )}
      </p>

      <Toggle
        label={L(
          'YouTube “Reklamı geç” düğmesine otomatik bas',
          'Press YouTube’s “Skip ad” button automatically',
        )}
        checked={video.autoSkipAds}
        onChange={(on) => set({ autoSkipAds: on })}
      />
      <p className="note">
        {L(
          'Kaldırılamayan bir reklamda oynatıcının kendi “Geç” düğmesi görünür görünmez basılır. Sayfada başka hiçbir şeye tıklanmaz.',
          'On an ad that could not be removed, the player’s own “Skip” button is pressed as soon as it shows. Nothing else on the page is clicked.',
        )}
      </p>

      <Toggle
        label={L('Twitch video reklamlarını kaldır', 'Remove Twitch video ads')}
        checked={video.twitchAds}
        onChange={(on) => set({ twitchAds: on })}
      />
      <p className="note">
        {L(
          'Reklam sırasında oynatıcı, Twitch’ten reklamsız bir oynatma listesi ister; yoksa reklam parçaları boş bir klibe çevrilir ve reklam bitene kadar görüntü kısa süre donabilir. Bu istekler anonimdir: Twitch hesabınız, çerezleriniz veya oturum anahtarınız kullanılmaz. Twitch yöntemini değiştirirse reklamlar geri gelebilir; yayın yine oynar.',
          'During an ad the player asks Twitch for an ad-free playlist; failing that, ad segments become an empty clip and the picture may freeze briefly until the ad ends. These requests are anonymous: your Twitch account, cookies and session token are not used. If Twitch changes its method, ads may come back; the stream still plays.',
        )}
      </p>

      <Toggle
        label={L('Sponsorlu kartları işaretle', 'Mark sponsored cards')}
        checked={video.markSponsored}
        onChange={(on) => set({ markSponsored: on })}
      />
      <p className="note">
        {L(
          'Listelerin gizlemediği reklam kartları kesik turuncu çerçeve ve “Sponsorlu” etiketiyle gösterilir. Yalnızca CSS; sayfa taranmaz.',
          'Ad cards the lists do not hide get a dashed orange border and a “Sponsored” label. CSS only; the page is not scanned.',
        )}
      </p>

      <Toggle
        label={L('Sponsorlu kartları tamamen gizle', 'Hide sponsored cards completely')}
        checked={video.hideSponsored}
        onChange={(on) => set({ hideSponsored: on })}
      />
      <p className="note">
        {L(
          'Ana sayfa, arama ve yan paneldeki reklam kartları işaretlenmek yerine kaldırılır. Açıkken işaretleme ayarı kullanılmaz.',
          'Ad cards on the home page, in search and in the side panel are removed instead of marked. While on, the marking setting is not used.',
        )}
      </p>

      <Toggle
        label={L(
          'Gömülü YouTube videolarını youtube-nocookie.com ile aç',
          'Open embedded YouTube videos via youtube-nocookie.com',
        )}
        checked={video.nocookieEmbeds}
        onChange={(on) => set({ nocookieEmbeds: on })}
      />
      <p className="note">
        {L(
          'Başka sitelere gömülü oynatıcılar YouTube’un gizlilik geliştirilmiş alan adından yüklenir; video oynatılana kadar çerez bırakılmaz. Gömülü oynatıcıda YouTube hesabınız görünmez (sonra izle, abonelik düğmesi).',
          'Players embedded in other sites load from YouTube’s privacy-enhanced domain; no cookie is set until the video plays. Your YouTube account is not visible in the embedded player (watch later, subscribe button).',
        )}
      </p>

      <Toggle
        label={L(
          'Diğer sitelerdeki oynatıcılarda reklamları kaldır (beta)',
          'Remove ads in players on other sites (beta)',
        )}
        checked={video.genericPlayers}
        onChange={(on) => set({ genericPlayers: on })}
      />
      <p className="note">
        {L(
          'Haber, dizi ve film sitelerindeki JW Player, hls.js, Shaka, dash.js ve Video.js oynatıcıları için. Yalnızca sayfada bu oynatıcılardan biri görülünce devreye girer: JW Player’ın reklam planı silinir, HLS oynatma listesinde reklam arası olarak işaretlenen parçalar çıkarılır, ayrı oynatılan ön reklam videosu sessize alınıp sonuna sarılır. FreeWheel ve SpotX reklam isteklerine “reklam yok” yanıtı verilir. Netflix, Disney+ gibi şifreli akışlara dokunulmaz. Beta: bir sitede video bozulursa o siteyi duraklatın veya bunu kapatın.',
          'For JW Player, hls.js, Shaka, dash.js and Video.js players on news, series and film sites. It only wakes up once one of these players shows up on the page: JW Player’s ad schedule is removed, segments marked as an ad break in an HLS playlist are dropped, and a separately played pre-roll is muted and wound to its end. FreeWheel and SpotX ad requests get a “no ads” answer. Encrypted streams such as Netflix or Disney+ are not touched. Beta: if video breaks on a site, pause that site or turn this off.',
        )}
      </p>

      <Toggle
        label={L(
          'Kaldırılamayan reklamlarda sesi kapat ve görüntüyü karart',
          'Mute and darken ads that cannot be removed',
        )}
        checked={video.adMute}
        onChange={(on) => set({ adMute: on })}
      />
      <p className="note">
        {L(
          'YouTube’un sunucuda videoya gömdüğü reklamlar ve Twitch’te kaldırılamayanlar için: oynatıcı kendi reklam işaretini gösterdiği sürece video sessize alınır ve karartılır; reklam bitince ses geri açılır. Sizin kapattığınız ses açılmaz.',
          'For ads YouTube stitches into the video on its servers and ones that cannot be removed on Twitch: while the player shows its own ad marker, the video is muted and darkened; sound comes back when the ad ends. Sound you muted yourself stays muted.',
        )}
      </p>

      <Toggle
        label={L(
          'Kaldırılamayan YouTube reklamlarını 16 kat hızlı oynat',
          'Play YouTube ads that cannot be removed at 16x',
        )}
        checked={video.adSpeedUp}
        onChange={(on) => set({ adSpeedUp: on })}
      />
      <p className="note">
        {L(
          'Reklam birkaç saniyede biter; bitince videonun kendi hızı geri gelir. Risk: YouTube oynatma hızını görebilir ve bunu reklam engelleme sayıp hesabı işaretleyebilir. Twitch’te canlı reklam hızlandırılamaz.',
          'The ad ends in a few seconds; the video’s own speed comes back afterwards. Risk: YouTube can see the playback rate, count it as ad blocking and flag the account. Live Twitch ads cannot be sped up.',
        )}
      </p>

      <Toggle
        label={L(
          'YouTube sponsor bölümlerini atla (SponsorBlock)',
          'Skip YouTube sponsor segments (SponsorBlock)',
        )}
        checked={video.sponsorSkip}
        onChange={(on) => set({ sponsorSkip: on })}
      />
      <p className="note">
        {L(
          <>
            Videodaki sponsor bölümleri, gönüllülerin işaretlediği{' '}
            <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">
              SponsorBlock
            </a>{' '}
            verisiyle atlanır (veri lisansı CC BY-NC-SA 4.0). Açıkken izlediğiniz her video için
            sponsor.ajay.app’e istek gider; video kimliği gönderilmez, yalnızca kimliğin SHA-256
            özetinin ilk 4 karakteri gider. Bu öneki YouTube’daki çok sayıda video paylaşır; sunucu
            o öneke ait bütün kayıtları döndürür ve eşleştirme tarayıcıda yapılır. Sunucu IP
            adresinizi ve istek zamanını görür. Çerez gönderilmez; sonuç tarayıcı kapanana kadar
            yalnızca bellekte tutulur. Ne atladığınız ne oy verdiğiniz sunucuya bildirilir.
          </>,
          <>
            Sponsor segments are skipped using{' '}
            <a href="https://sponsor.ajay.app" target="_blank" rel="noreferrer">
              SponsorBlock
            </a>{' '}
            data marked by volunteers (data licence CC BY-NC-SA 4.0). While on, a request goes to
            sponsor.ajay.app for every video you watch; the video ID is not sent, only the first 4
            characters of its SHA-256 hash. Many YouTube videos share that prefix; the server
            returns every record for it and matching happens in the browser. The server sees your IP
            address and the time of the request. No cookie is sent; the result stays in memory only
            until the browser closes. Neither what you skip nor any vote is reported.
          </>,
        )}
      </p>

      {video.sponsorSkip && (
        <>
          <h3>{L('SponsorBlock kategorileri', 'SponsorBlock categories')}</h3>
          <p className="note">
            {L(
              'Kapalı: hiçbir şey yapılmaz. Yalnızca göster: zaman çubuğunda renkli işaret. Düğmeyle atla: bölüme gelince “Atla” düğmesi çıkar. Otomatik atla: bölüm atlanır (ya da sesi kapatılır) ve birkaç saniye “Geri al” düğmesi görünür. Video gönderilen bölümlerden 2 saniyeden fazla uzun veya kısaysa o bölümler kullanılmaz.',
              'Off: nothing happens. Show only: a coloured mark on the timeline. Skip with a button: a “Skip” button appears when the segment starts. Skip automatically: the segment is skipped (or muted) and an “Undo” button shows for a few seconds. If the video is more than 2 seconds longer or shorter than the submitted segments assume, those segments are not used.',
            )}
          </p>
          {SPONSOR_CATEGORIES.map((c) => (
            <label className="field" key={c}>
              <span>
                <span aria-hidden="true" style={{ color: SPONSOR_LABELS[c].color }}>
                  ■{' '}
                </span>
                {SPONSOR_LABELS[c].name}
              </span>
              <select
                aria-label={SPONSOR_LABELS[c].name}
                value={video.sponsorModes[c]}
                onChange={(e) =>
                  set({
                    sponsorModes: { ...video.sponsorModes, [c]: e.target.value as SkipMode },
                  })
                }
              >
                {modesFor(c).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <h3>{L('Atlanmayacak kanallar', 'Channels never skipped')}</h3>
          <p className="note">
            {L(
              <>
                Desteklemek istediğiniz kanallarda hiçbir bölüm kendiliğinden atlanmaz veya sessize
                alınmaz; işaretler ve düğmeler kalır. Her satıra bir kanal: <code>@kanaladi</code>{' '}
                ya da kanal adresi.
              </>,
              <>
                On channels you want to support nothing is skipped or muted automatically; marks and
                buttons stay. One channel per line: <code>@channelname</code> or the channel
                address.
              </>,
            )}
          </p>
          <textarea
            aria-label={L('Atlanmayacak kanallar', 'Channels never skipped')}
            rows={4}
            spellCheck={false}
            value={channels}
            onChange={(e) => setChannels(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              onClick={() => set({ sponsorChannels: channels.split('\n').filter((l) => l.trim()) })}
            >
              {L('Kanalları kaydet', 'Save channels')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const MODE_LABELS: Record<SkipMode, string> = {
  off: L('Kapalı', 'Off'),
  show: L('Yalnızca göster', 'Show only'),
  manual: L('Düğmeyle atla', 'Skip with a button'),
  auto: L('Otomatik atla', 'Skip automatically'),
};

/** A highlight is one moment and the whole-video label has no range: neither can be skipped. */
const modesFor = (c: (typeof SPONSOR_CATEGORIES)[number]): SkipMode[] =>
  c === 'poi_highlight' || c === 'exclusive_access' || c === 'chapter'
    ? ['off', 'show', ...(c === 'poi_highlight' ? (['manual'] as const) : [])]
    : ['off', 'show', 'manual', 'auto'];
