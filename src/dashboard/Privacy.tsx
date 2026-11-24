import { useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import { currentProfile, PROFILES, profileSettings } from '../shared/privacy-profiles.ts';
import type { PrivacyProfile } from '../shared/privacy-profiles.ts';
import type { FingerprintLevel, PrivacySettings, Settings } from '../shared/types.ts';
import { Toggle } from './Toggle.tsx';
import { PermissionNote } from './Permission.tsx';
import { askPermissions, REQUEST_PERMISSIONS } from '../shared/permissions.ts';

const LEVELS: { value: FingerprintLevel; label: string }[] = [
  { value: 'off', label: L('Kapalı', 'Off') },
  {
    value: 'standard',
    label: L(
      'Standart: canvas, WebGL ve ses okumalarına site ve oturum başına gürültü',
      'Standard: per-site, per-session noise on canvas, WebGL and audio readback',
    ),
  },
  {
    value: 'strict',
    label: L(
      'Sıkı: Standart + GPU modelini, 4’ten fazla CPU çekirdeğini ve yoklanan yazı tiplerini gizle',
      'Strict: Standard + hide the GPU model, more than 4 CPU cores and probed fonts',
    ),
  },
];

const PROFILE_NAMES: Record<PrivacyProfile, string> = {
  balanced: L('Dengeli', 'Balanced'),
  strict: L('Sıkı', 'Strict'),
  paranoid: L('Paranoyak', 'Paranoid'),
};

export function Privacy({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const { privacy } = settings;
  const [kept, setKept] = useState(privacy.keepSiteData.join('\n'));
  const [scriptSites, setScriptSites] = useState(privacy.scriptSites.join('\n'));
  const set = (patch: Partial<PrivacySettings>) =>
    void guard(() => send('privacy/set', { privacy: patch }));
  const profile = currentProfile(privacy);
  const choose = (p: PrivacyProfile) => set(profileSettings(p));

  return (
    <section>
      <h2>{L('Gizlilik', 'Privacy')}</h2>
      <p className="muted">
        {L(
          'Takip parametresi temizleme ve çerez bildirimi gizleme “Filtre listeleri” bölümündeki AdGuard URL Tracking ve EasyList Cookie List ile açılıp kapanır. Değişiklikler açık sekmelerde sayfa yenilenince geçerli olur; duraklatılan sitelerde hiçbiri çalışmaz.',
          'Tracking-parameter cleanup and cookie-notice hiding are switched with AdGuard URL Tracking and EasyList Cookie List under “Filter lists”. Changes apply to open tabs after a reload; none of them run on paused sites.',
        )}
      </p>

      <div className="row" role="group" aria-label={L('Gizlilik profili', 'Privacy profile')}>
        {PROFILES.map((p) => (
          <button key={p} type="button" aria-pressed={profile === p} onClick={() => choose(p)}>
            {PROFILE_NAMES[p]}
          </button>
        ))}
        <span className="muted">
          {L('Şu an', 'Now')}: {profile ? PROFILE_NAMES[profile] : L('Özel', 'Custom')}
        </span>
      </div>
      <p className="note">
        {L(
          'Dengeli: siteleri bozma ihtimali düşük olan her şey açık; üçüncü taraf çerezleri açık kalır. Sıkı: buna ek olarak üçüncü taraf çerezleri engellenir ve parmak izi koruması Sıkı olur; bazı gömülü giriş ve ödeme pencereleri bozulabilir. Paranoyak: Sıkı + başka sitelerden gelen betikler engellenir, izin verdiğiniz siteler hariç; çoğu site bir izin ister. Aşağıdan tek tek değiştirirseniz profil Özel olur. Dil ve saat dilimi ile ayrıntılı raporlar profillerden etkilenmez.',
          'Balanced: everything unlikely to break sites is on; third-party cookies stay allowed. Strict: also blocks third-party cookies and sets fingerprint protection to Strict; some embedded sign-in and payment windows may break. Paranoid: Strict + scripts from other sites are blocked except on sites you allow; most sites will need that. Changing anything below one by one makes the profile Custom. Language and time zone, and detailed reports, are not part of the profiles.',
        )}
      </p>

      <Toggle
        label={L('Üçüncü taraf çerezlerini engelle', 'Block third-party cookies')}
        checked={privacy.blockThirdPartyCookies}
        onChange={(on) => set({ blockThirdPartyCookies: on })}
      />
      <p className="note">
        {L(
          'Başka sitelere giden isteklerden Cookie ve Set-Cookie başlıkları silinir. Gömülü giriş pencereleri, yorum eklentileri ve bazı ödeme sayfaları bozulabilir; o sitede korumayı duraklatın.',
          'Cookie and Set-Cookie headers are removed from requests to other sites. Embedded sign-in windows, comment widgets and some payment pages may break; pause protection on that site.',
        )}
      </p>

      <Toggle
        label={L('Başka sitelerin betiklerini engelle', 'Block scripts from other sites')}
        checked={privacy.blockThirdPartyScripts}
        onChange={(on) => set({ blockThirdPartyScripts: on })}
      />
      <p className="note">
        {L(
          'Sayfalar yalnız kendi sitelerinden betik yükleyebilir; reklam, analiz ve sohbet araçları da, video oynatıcılar ve yorumlar da durur. Bir sitede izin vermek için açılır pencereyi kullanın ya da aşağıya yazın. Ödeme, banka ve doğrulama (captcha) siteleri hiç etkilenmez.',
          'Pages may load scripts only from their own site; ads, analytics and chat widgets stop, and so do video players and comments. Allow a site from the popup or list it below. Payment, bank and captcha sites are never affected.',
        )}
      </p>
      {privacy.blockThirdPartyScripts && (
        <>
          <textarea
            aria-label={L(
              'Başka sitelerin betiklerine izin verilen siteler',
              'Sites allowed to load scripts from other sites',
            )}
            rows={4}
            spellCheck={false}
            placeholder="youtube.com"
            value={scriptSites}
            onChange={(e) => setScriptSites(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              onClick={() => set({ scriptSites: scriptSites.split('\n').filter((l) => l.trim()) })}
            >
              {L('Siteleri kaydet', 'Save sites')}
            </button>
          </div>
        </>
      )}

      <Toggle
        label={L('Çerez bildirimlerini otomatik reddet', 'Reject cookie notices automatically')}
        checked={privacy.cookieAutoReject}
        onChange={(on) => set({ cookieAutoReject: on })}
      />
      <p className="note">
        {L(
          'DuckDuckGo autoconsent (MPL-2.0) kurallarıyla tanınan bildirimlerde yalnızca “reddet” / “gerekli olanlar” seçilir; hiçbir zaman kabul edilmez. Tanınmayan bildirimlere dokunulmaz. Sayfa bağlamında yalnızca kütüphaneyle gelen hazır kod parçaları çalışır.',
          'On notices recognised by DuckDuckGo autoconsent (MPL-2.0) rules, only “reject” / “necessary only” is chosen; never “accept”. Unknown notices are left alone. Only the ready-made snippets shipped with the library run in the page.',
        )}
      </p>

      <Toggle
        label={L(
          'Takip etmeme sinyali gönder (Global Privacy Control)',
          'Send a do-not-track signal (Global Privacy Control)',
        )}
        checked={privacy.gpc}
        onChange={(on) => set({ gpc: on })}
      />
      <p className="note">
        {L(
          <>
            Her istekte <code>Sec-GPC: 1</code> başlığı ve sayfalara{' '}
            <code>navigator.globalPrivacyControl</code> sinyali gider. Bazı yasalarda (ör. CCPA)
            bağlayıcıdır; siteler uymak zorunda olmayabilir.
          </>,
          <>
            Every request carries the <code>Sec-GPC: 1</code> header and pages see{' '}
            <code>navigator.globalPrivacyControl</code>. Binding under some laws (e.g. CCPA); sites
            may not have to honour it.
          </>,
        )}
      </p>

      <Toggle
        label={L('WebRTC ile yerel IP adresini gizle', 'Hide the local IP address from WebRTC')}
        checked={privacy.hideLocalIps}
        onChange={(on) => set({ hideLocalIps: on })}
      />
      <p className="note">
        {L(
          'Görüntülü görüşme ve eşler arası bağlantılar yalnızca sitelerin zaten gördüğü genel adresi kullanır; bilgisayarın yerel adresi ve VPN arkasındaki gerçek adres sayfalara verilmez.',
          'Video calls and peer-to-peer connections use only the public address sites already see; the computer’s local address and the real address behind a VPN are not given to pages.',
        )}
      </p>

      <Toggle
        label={L('Dil ve saat dilimini gizle', 'Hide language and time zone')}
        checked={privacy.hideLocale}
        onChange={(on) => set({ hideLocale: on })}
      />
      <p className="note">
        {L(
          'Siteler dil olarak İngilizce (ABD), saat dilimi olarak UTC görür; bazı siteler İngilizce açılabilir ve saatleri UTC gösterebilir. Ülkeyi asıl gösteren şey IP adresidir ve onu hiçbir eklenti değiştiremez; bunun için VPN gerekir.',
          'Sites see English (US) as the language and UTC as the time zone; some sites may switch language and show times in UTC. What really reveals your country is the IP address, which no extension can change; that needs a VPN.',
        )}
      </p>

      <Toggle
        label={L('İzleme yönlendirmelerini atla', 'Skip tracking redirects')}
        checked={privacy.cleanLinks}
        onChange={(on) => set({ cleanLinks: on })}
      />
      <p className="note">
        {L(
          'Hedefi adresin içinde yazan bilinen yönlendirme bağlantılarında (Google, Facebook, YouTube ve Brave’in listesindeki izleme ağları) doğrudan hedefe gidilir. İzleme sunucusuna hiç uğranmaz. Bağlantıya tıklayınca arka planda izleme adresine giden “ping” bildirimi ve tarayıcının açmadığınız bağlantıları önceden yüklemesi de kapatılır.',
          'Known redirect links that carry their target in the address (Google, Facebook, YouTube and the tracking networks in Brave’s list) go straight to the target, never touching the tracking server. The background “ping” a link sends to a tracking address on click, and the browser preloading links you never opened, are switched off too.',
        )}
      </p>

      <Toggle
        label={L('Tarayıcının reklam API’lerini kapat', 'Turn off the browser’s ad APIs')}
        checked={privacy.browserAdApis}
        onChange={(on) => set({ browserAdApis: on })}
      />
      <p className="note">
        {L(
          'Chrome’un ilgi alanı konuları (Topics), sitede yapılan reklam açık artırmaları (Protected Audience) ve reklam ölçümü (Attribution Reporting) kapatılır. Bunlar tarayıcı ayarıdır; Firefox’ta yoktur.',
          'Turns off Chrome’s interest topics (Topics), on-device ad auctions (Protected Audience) and ad measurement (Attribution Reporting). These are browser settings; Firefox has none of them.',
        )}
      </p>

      <Toggle
        label={L(
          'Üçüncü taraflara cihaz ayrıntısı verme (Client Hints)',
          'Keep device details from third parties (Client Hints)',
        )}
        checked={privacy.limitClientHints}
        onChange={(on) => set({ limitClientHints: on })}
      />
      <p className="note">
        {L(
          'Başka sitelere giden isteklerden tam tarayıcı sürümü, cihaz modeli, işlemci mimarisi ve işletim sistemi sürümü başlıkları silinir. Sitenin kendisi bunları görmeye devam eder.',
          'The full browser version, device model, CPU architecture and OS version headers are removed from requests to other sites. The site itself still sees them.',
        )}
      </p>

      <Toggle
        label={L(
          'Gömülü Facebook, X ve Disqus içeriğini tıklayınca yükle',
          'Load embedded Facebook, X and Disqus content on click',
        )}
        checked={privacy.clickToLoad}
        onChange={(on) => set({ clickToLoad: on })}
      />
      <p className="note">
        {L(
          'Haber sitelerindeki gömülü gönderiler ve yorum kutuları, yüklendikleri anda bu şirketlere hangi sayfayı okuduğunuzu bildirir. Açıkken yerlerinde bir düğme görünür; tıklarsanız o sekme kapanana kadar yüklenir. Sınır: bu şirketlerin SDK’sını kullanan “Facebook ile giriş” düğmeleri de tıklamadan çalışmaz.',
          'Embedded posts and comment boxes on news sites tell these companies which page you read the moment they load. When on, a button takes their place; a click loads them until that tab closes. Limit: “Log in with Facebook” buttons that use the same SDK also wait for that click.',
        )}
      </p>

      <Toggle
        label={L(
          'Sekme kapanınca açık olmayan sitelerin verisini sil',
          'Clear data of sites with no open tab when a tab closes',
        )}
        checked={privacy.clearSiteData}
        onChange={(on) => set({ clearSiteData: on })}
      />
      <p className="note">
        {L(
          'Bir sekme kapandığında, açık sekmesi olmayan her sitenin çerezleri ve depoladığı veriler (yerel depolama, IndexedDB, önbellek, service worker) silinir; izleyicilerin bıraktıkları da gider. Bu sitelerdeki oturumlar kapanır. Aşağıdaki sitelerin ve korumasını kapattığınız sitelerin çerezleri hiç silinmez; bu sitelerin www dışındaki alt alan adlarının yerel depolaması silinebilir. Geçmiş, şifreler ve indirmeler silinmez. Yalnızca Chrome, Brave ve Edge’de çalışır.',
          'When a tab closes, the cookies and stored data (local storage, IndexedDB, cache, service workers) of every site without an open tab are cleared, including what trackers left behind. You are signed out of those sites. Cookies of the sites below and of sites whose protection you turned off are never cleared; local storage on their subdomains other than www can be. History, passwords and downloads are not touched. Works in Chrome, Brave and Edge only.',
        )}
      </p>
      {privacy.clearSiteData && (
        <>
          <textarea
            aria-label={L('Verisi silinmeyecek siteler', 'Sites whose data is kept')}
            rows={4}
            spellCheck={false}
            placeholder="github.com"
            value={kept}
            onChange={(e) => setKept(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              onClick={() => set({ keepSiteData: kept.split('\n').filter((l) => l.trim()) })}
            >
              {L('Siteleri kaydet', 'Save sites')}
            </button>
          </div>
        </>
      )}

      <Toggle
        label={L(
          'Gerekli ama izleyen sunucularda yalnızca çerezi engelle',
          'Block only the cookie on needed servers that track',
        )}
        checked={privacy.cdnCookies}
        disabled={privacy.blockThirdPartyCookies}
        onChange={(on) => set({ cdnCookies: on })}
      />
      <p className="note">
        {L(
          'Sitelerin çalışması için gereken bazı sunucuların dosyaları yüklenir, üçüncü taraf çerezleri silinir (Privacy Badger’ın listesi; giriş, ödeme ve banka adresleri hariç). Tüm üçüncü taraf çerezlerini engelliyorsanız bu zaten kapsanır.',
          'Files from some servers sites need still load, but their third-party cookies are removed (Privacy Badger’s list; sign-in, payment and bank addresses excluded). Already covered if you block all third-party cookies.',
        )}
      </p>

      <Toggle
        label={L(
          'Ayrıntılı raporlar ve günlük istatistik',
          'Detailed reports and daily statistics',
        )}
        checked={privacy.detailedReports}
        onChange={(on) => {
          // The browser asks for the permission only inside this click.
          if (!on) return set({ detailedReports: false });
          void askPermissions(REQUEST_PERMISSIONS).then(
            (ok) => ok && set({ detailedReports: true }),
          );
        }}
      />
      <p className="note">
        {L(
          'Açılır penceredeki alan adı listesini ve Özet’teki engellenen istek sayacını tutar. Bunun için arka plan her istekte uyanır, bu yüzden varsayılan olarak kapalıdır. Engelleme bu ayardan etkilenmez.',
          'Keeps the domain list in the popup and the blocked-request counter in Overview. The background wakes on every request for this, so it is off by default. Blocking does not depend on it.',
        )}
      </p>
      {privacy.detailedReports && (
        <PermissionNote
          perms={REQUEST_PERMISSIONS}
          why={L(
            'Raporlar duruyor: tarayıcının isteğe bağlı “webRequest” izni verilmemiş.',
            'Reports are paused: the optional “webRequest” browser permission is not granted.',
          )}
        />
      )}

      <label className="field">
        <span>{L('Parmak izi koruması', 'Fingerprint protection')}</span>
        <select
          aria-label={L('Parmak izi koruması', 'Fingerprint protection')}
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
        {L(
          'Gürültü bir tarayıcı oturumu boyunca aynı sitede aynıdır; farklı sitelerde ve tarayıcı yeniden açıldığında değişir. Böylece okunan değer ne siteler arasında ne de farklı günlerdeki ziyaretler arasında eşleştirmede işe yarar. Sayfanın kendi içinde oluşturduğu (blob) worker’lar da kapsanır. Sınırlar: sitenin dosyalarından yüklenen worker’lar kapsanmaz, sarmalanan fonksiyonlar tespit edilebilir. Sıkı düzey ayrıca bellek miktarını sabitler, pil bilgisini kaldırır, ekranın kullanılabilir alanını tam ekranla aynı gösterir ve sitelerin yokladığı nadir yazı tiplerini (Office, Adobe, Doğu Asya yazı tipleri) Arial olarak gösterir; böylece kurulu olup olmadıkları anlaşılmaz.',
          'The noise stays the same on one site for one browser session; it differs across sites and changes when the browser restarts. So the value read is useless for matching visits across sites or across days. Workers the page builds itself (from a blob) are covered too. Limits: workers loaded from the site’s files are not covered, and wrapped functions can be detected. Strict also fixes the memory size, removes battery details, reports the usable screen area as the full screen, and shows the rare fonts sites probe for (Office, Adobe, East Asian fonts) as Arial, so whether they are installed cannot be told.',
        )}
        {settings.isBrave &&
          L(
            ' Brave kendi parmak izi korumasını (farbling) zaten uyguluyor; ikisi birlikte zararsızdır.',
            ' Brave already applies its own fingerprint protection (farbling); running both is harmless.',
          )}
      </p>
    </section>
  );
}
