import { useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import type { SiteProfile } from '../shared/types.ts';

/** From the least protection lost to the most; each step keeps the ones before it. */
const STEPS: { patch: Partial<SiteProfile> | 'pause'; name: string; done: string }[] = [
  {
    patch: { privacy: false },
    name: L('gizlilik korumaları', 'privacy protections'),
    done: L(
      'Bu sitede çerez, parmak izi ve takip başlığı korumaları kapatıldı.',
      'Cookie, fingerprint and tracking-header protections are off on this site.',
    ),
  },
  {
    patch: { video: false },
    name: L('video reklam katmanı', 'video ad layer'),
    done: L('Video reklam katmanı da kapatıldı.', 'The video ad layer is off too.'),
  },
  {
    patch: { network: false },
    name: L('reklam ve izleyici engelleme', 'ad and tracker blocking'),
    done: L(
      'Reklam ve izleyici engelleme de kapatıldı. Tehlikeli site uyarıları açık kalır.',
      'Ad and tracker blocking is off too. Dangerous-site warnings stay on.',
    ),
  },
  {
    patch: 'pause',
    name: L('tüm koruma', 'all protection'),
    done: L('AX bu sitede tamamen duraklatıldı.', 'AX is fully paused on this site.'),
  },
];

type Stage = { at: number } | { fixed: number } | { notAx: true };

/**
 * The breakage wizard: relaxes protection on one site a step at a time, reloads the tab and asks
 * whether the page works now. Whatever fixed it stays; "not fixed even with AX off" puts it all back.
 */
export function Fix({
  site,
  original,
  run,
  onReport,
  onClose,
}: {
  site: string;
  original: SiteProfile;
  /** Runs a change, then refreshes the popup and reloads the tab. */
  run(action: () => Promise<unknown>): Promise<void>;
  onReport(fixedBy: string): void;
  onClose(): void;
}) {
  const [stage, setStage] = useState<Stage | null>(null);
  // The site as it was when the wizard opened; later renders get the relaxed profile.
  const [before] = useState(original);
  const apply = (i: number) =>
    run(async () => {
      const step = STEPS[i];
      if (!step) return;
      if (step.patch === 'pause') await send('site/setPaused', { site, paused: true });
      else await send('site/setProfile', { site, profile: step.patch });
    }).then(() => setStage({ at: i }));
  const restore = () =>
    run(async () => {
      await send('site/setPaused', { site, paused: false });
      await send('site/setProfile', { site, profile: before });
    });

  if (stage === null) {
    return (
      <div className="wizard" role="region" aria-label={L('Sorun giderme', 'Fix a broken site')}>
        <p>
          {L(
            'AX korumayı bu sitede adım adım gevşetecek ve her adımda sayfayı yenileyecek. Sayfa düzelince durun; düzelten ayar kalır.',
            'AX will relax protection on this site one step at a time and reload the page after each. Stop when the page works; the setting that fixed it stays.',
          )}
        </p>
        <div className="row">
          <button type="button" onClick={() => void apply(0)}>
            {L('Başla', 'Start')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {L('Vazgeç', 'Cancel')}
          </button>
        </div>
      </div>
    );
  }

  if ('fixed' in stage) {
    const step = STEPS[stage.fixed];
    return (
      <div className="wizard" role="status">
        <p>
          {L('Sorunu çözen:', 'Fixed by turning off:')} <strong>{step?.name}</strong>.{' '}
          {L(
            'Bu sitede böyle kalacak; Kontrol paneli › Siteler bölümünden geri açabilirsiniz.',
            'It stays this way on this site; you can turn it back on under Dashboard › Sites.',
          )}
        </p>
        <div className="row">
          <button type="button" onClick={() => onReport(step?.name ?? '')}>
            {L('Bunu bildir', 'Report this')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {L('Kapat', 'Close')}
          </button>
        </div>
      </div>
    );
  }

  if ('notAx' in stage) {
    return (
      <div className="wizard" role="status">
        <p>
          {L(
            'AX tamamen kapalıyken de sayfa bozuk; sorun büyük ihtimalle sitenin kendisinde ya da başka bir eklentide. Koruma eski haline getirildi.',
            'The page is broken even with AX fully off, so the problem is most likely the site itself or another extension. Protection is back as it was.',
          )}
        </p>
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={() => onReport(L('AX kapalıyken de bozuk', 'broken with AX off too'))}
          >
            {L('Yine de bildir', 'Report anyway')}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            {L('Kapat', 'Close')}
          </button>
        </div>
      </div>
    );
  }

  const step = STEPS[stage.at];
  const last = stage.at === STEPS.length - 1;
  return (
    <div className="wizard" role="status">
      <p>
        {L(`Adım ${stage.at + 1}/${STEPS.length}:`, `Step ${stage.at + 1}/${STEPS.length}:`)}{' '}
        {step?.done}{' '}
        {L(
          'Sayfa yenilendi. Şimdi düzgün çalışıyor mu?',
          'The page was reloaded. Does it work now?',
        )}
      </p>
      <div className="row">
        <button type="button" onClick={() => setStage({ fixed: stage.at })}>
          {L('Evet, düzeldi', 'Yes, it works')}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void (last ? restore().then(() => setStage({ notAx: true })) : apply(stage.at + 1))
          }
        >
          {last
            ? L('Hayır, hâlâ bozuk', 'No, still broken')
            : L('Hayır, devam et', 'No, keep going')}
        </button>
        <button type="button" className="link" onClick={() => void restore().then(onClose)}>
          {L('Vazgeç ve geri al', 'Cancel and undo')}
        </button>
      </div>
    </div>
  );
}
