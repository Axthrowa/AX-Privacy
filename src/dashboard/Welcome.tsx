import { send } from '../shared/messages.ts';
import { L } from '../shared/i18n.ts';
import { currentProfile, profileSettings } from '../shared/privacy-profiles.ts';
import type { PrivacyProfile } from '../shared/privacy-profiles.ts';
import type { Settings } from '../shared/types.ts';

/** Opened once, right after install. Protection is already on; this only explains and offers a choice. */
export function Welcome({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const profile = currentProfile(settings.privacy);
  const choose = (p: PrivacyProfile) =>
    void guard(() => send('privacy/set', { privacy: profileSettings(p) }));
  return (
    <section className="welcome">
      <h2>{L('AX Privacy kuruldu, koruma açık', 'AX Privacy is installed and protecting you')}</h2>
      <p>
        {L(
          'Reklamlar, izleyiciler ve bilinen tehlikeli siteler şu andan itibaren engelleniyor. Her şey bu bilgisayarda çalışır; gezdiğiniz sayfalar hiçbir sunucuya gönderilmez.',
          'Ads, trackers and known dangerous sites are blocked from now on. Everything runs on this computer; the pages you visit are never sent to any server.',
        )}
      </p>

      <h3>{L('Gizlilik düzeyi', 'Privacy level')}</h3>
      <div className="row" role="group" aria-label={L('Gizlilik profili', 'Privacy profile')}>
        <button
          type="button"
          aria-pressed={profile === 'balanced'}
          onClick={() => choose('balanced')}
        >
          {L('Dengeli (önerilen)', 'Balanced (recommended)')}
        </button>
        <button type="button" aria-pressed={profile === 'strict'} onClick={() => choose('strict')}>
          {L('Sıkı', 'Strict')}
        </button>
        <button
          type="button"
          aria-pressed={profile === 'paranoid'}
          onClick={() => choose('paranoid')}
        >
          {L('Paranoyak', 'Paranoid')}
        </button>
      </div>
      <p className="note">
        {L(
          'Dengeli siteleri bozmadan korur. Sıkı, üçüncü taraf çerezlerini de engeller ve parmak izini daha çok gizler; bazı giriş ve ödeme pencereleri bozulabilir. Paranoyak, başka sitelerin betiklerini de engeller; siteleri tek tek izinle açarsınız. Sonra Gizlilik bölümünden değiştirebilirsiniz.',
          'Balanced protects without breaking sites. Strict also blocks third-party cookies and hides more of your fingerprint; some sign-in and payment windows may break. Paranoid also blocks scripts from other sites; you allow sites one by one. You can change this later under Privacy.',
        )}
      </p>

      <h3>{L('Bir site bozulursa', 'If a site breaks')}</h3>
      <p>
        {L(
          'Araç çubuğundaki AX simgesine tıklayın ve “Bu sitede sorun var” deyin. AX korumayı adım adım gevşetip her adımda sayfa düzeldi mi diye sorar. Simgeyi görmüyorsanız yapboz simgesinden AX Privacy’yi sabitleyin.',
          'Click the AX icon in the toolbar and choose “Something is broken here”. AX relaxes protection step by step and asks after each step whether the page works. If you do not see the icon, pin AX Privacy from the puzzle-piece menu.',
        )}
      </p>
      <div className="row">
        <button type="button" onClick={() => (location.hash = 'overview')}>
          {L('Tamam', 'Done')}
        </button>
      </div>
    </section>
  );
}
