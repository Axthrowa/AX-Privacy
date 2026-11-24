import { useState } from 'react';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import type { SiteProfile } from '../shared/types.ts';

type Layer = Exclude<keyof SiteProfile, 'security'>;

/**
 * The plan's order: the layers most likely to break a page and cheapest to lose come first. Each
 * step turns off only its own layer and puts the earlier ones back, so the one that fixes the
 * page is the only one left off.
 */
export const STEPS: { layer: Layer | 'pause'; name: string }[] = [
  { layer: 'generic', name: L('genel gizleme', 'generic hiding') },
  { layer: 'scriptlets', name: L('scriptlet’ler', 'scriptlets') },
  { layer: 'brain', name: L('AX-Brain yapay zekâ gizlemesi', 'AX-Brain AI hiding') },
  { layer: 'cosmetic', name: L('siteye özel gizleme', 'site-specific hiding') },
  { layer: 'privacy', name: L('gizlilik korumaları', 'privacy protections') },
  { layer: 'video', name: L('video reklam katmanı', 'video ad layer') },
  { layer: 'network', name: L('reklam ve izleyici engelleme', 'ad and tracker blocking') },
  { layer: 'pause', name: L('tüm koruma', 'all protection') },
];

/** Steps worth trying: a layer already off on this site cannot be what breaks it. */
export const stepsFor = (profile: SiteProfile) =>
  STEPS.filter((s) => s.layer === 'pause' || profile[s.layer]);

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
  const steps = stepsFor(before);
  const apply = (i: number) =>
    run(async () => {
      const step = steps[i];
      if (!step) return;
      if (step.layer === 'pause') {
        await send('site/setProfile', { site, profile: before });
        await send('site/setPaused', { site, paused: true });
      } else {
        await send('site/setProfile', { site, profile: { ...before, [step.layer]: false } });
      }
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
            'AX bu sitede katmanları tek tek kapatıp her seferinde sayfayı yenileyecek: genel gizleme, scriptlet’ler, yapay zekâ, siteye özel gizleme, sonra gizlilik, video ve ağ engeli. Sayfa düzelince durun; yalnızca sorunu çözen katman kapalı kalır.',
            'AX will turn layers off one at a time on this site and reload the page after each: generic hiding, scriptlets, AI, site-specific hiding, then privacy, video and network blocking. Stop when the page works; only the layer that fixed it stays off.',
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
    const step = steps[stage.fixed];
    return (
      <div className="wizard" role="status">
        <p>
          {L('Sorunu çözen:', 'Fixed by turning off:')} <strong>{step?.name}</strong>.{' '}
          {L(
            'Bu sitede yalnızca bu katman kapalı kalacak; diğerleri açık. Kontrol paneli › Siteler bölümünden geri açabilirsiniz.',
            'Only this layer stays off on this site; the rest are on. You can turn it back on under Dashboard › Sites.',
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

  const step = steps[stage.at];
  const last = stage.at === steps.length - 1;
  return (
    <div className="wizard" role="status">
      <p>
        {L(`Adım ${stage.at + 1}/${steps.length}:`, `Step ${stage.at + 1}/${steps.length}:`)}{' '}
        {step?.layer === 'pause'
          ? L('AX bu sitede tamamen duraklatıldı.', 'AX is fully paused on this site.')
          : L(`Yalnızca ${step?.name ?? ''} kapatıldı.`, `Only ${step?.name ?? ''} is off.`)}{' '}
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
