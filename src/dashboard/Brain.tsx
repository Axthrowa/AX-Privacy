import { useEffect, useRef, useState } from 'react';
import { THRESHOLD_MAX, THRESHOLD_MIN } from '../engines/brain/brain.ts';
import {
  createJudge,
  NANO_OPTIONS,
  type LanguageModelApi,
  type NanoAvailability,
} from '../engines/brain/nano-judge.ts';
import { L } from '../shared/i18n.ts';
import { Toggle } from './Toggle.tsx';
import { PermissionNote } from './Permission.tsx';
import { REQUEST_PERMISSIONS } from '../shared/permissions.ts';
import { send, type Api } from '../shared/messages.ts';
import type { Settings } from '../shared/types.ts';

type Info = Api['brain/info']['res'];

const STATE_NAME = {
  block: L('engelleniyor', 'blocked'),
  cookie: L('çerezi siliniyor', 'cookies dropped'),
  watch: L('izleniyor', 'watching'),
} as const;

/** Envelope for an exported model, so a settings backup is never mistaken for one. */
const FORMAT = 'ax-brain';

export function Brain({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Pages have the Prompt API; the worker does not, so the panel checks it here.
  const [available, setAvailable] = useState<NanoAvailability>('unavailable');
  const lm = (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
  useEffect(() => {
    void createJudge(lm).availability().then(setAvailable);
  }, [lm, downloading]);
  const reload = () => guard(async () => setInfo(await send('brain/info', {})));
  useEffect(() => {
    void send('brain/info', {})
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const learned = (settings.customRules.match(/^[^!\n]*##/gm) ?? []).length;
  const model = info?.model;

  return (
    <section id="brain">
      <h2>AX-Brain</h2>
      <p className="note">
        {L(
          'Filtre listelerinin kaçırdığı reklamları sayfada yerel olarak bulur ve gizler. Seçtiğiniz her reklamdan, "yanlış gizledi" dediğiniz her öğeden öğrenir. Hiçbir veri cihazdan çıkmaz.',
          'Finds and hides ads the filter lists missed, locally on the page. It learns from every ad you pick and every element you mark as wrongly hidden. No data leaves the device.',
        )}
      </p>
      {model && (
        <div className="cards">
          <div className="card">
            <strong>{model.sampleCount}</strong>
            <span>{L('öğrenme adımı', 'learning steps')}</span>
          </div>
          <div className="card">
            <strong>{learned}</strong>
            <span>{L('seçiciyle gizleme kuralı', 'picked hiding rules')}</span>
          </div>
          <div className="card">
            <strong>{Math.round(model.threshold * 100)}%</strong>
            <span>{L('gizleme eşiği', 'hiding threshold')}</span>
          </div>
          <div className="card">
            <strong>
              {model.sampleCount > 0 ? new Date(model.lastUpdated).toLocaleDateString() : '—'}
            </strong>
            <span>{L('son öğrenme', 'last learned')}</span>
          </div>
        </div>
      )}

      {model && (
        <label className="row">
          <span>
            {L('Gizleme eşiği', 'Hiding threshold')}: {Math.round(model.threshold * 100)}%
          </span>
          <input
            type="range"
            min={THRESHOLD_MIN * 100}
            max={THRESHOLD_MAX * 100}
            step={1}
            value={Math.round(model.threshold * 100)}
            aria-label={L('Gizleme eşiği', 'Hiding threshold')}
            onChange={(e) => {
              const threshold = Number(e.target.value) / 100;
              setInfo((i) => (i ? { ...i, model: { ...i.model, threshold } } : i));
            }}
            onPointerUp={() =>
              void guard(() => send('brain/setThreshold', { threshold: model.threshold }))
            }
            onKeyUp={() =>
              void guard(() => send('brain/setThreshold', { threshold: model.threshold }))
            }
          />
        </label>
      )}
      <p className="note">
        {L(
          'Yüksek eşik daha az ama daha emin gizler. Model tek başına yine yalnız %85 ve üstünde gizler; eşik, filtre işaretleriyle birlikte karar verir.',
          'A higher threshold hides less but more surely. The model alone still hides only at 85% and above; the threshold decides together with the filter signals.',
        )}
      </p>

      <h3>{L('Katman 3: Gemini Nano', 'Layer 3: Gemini Nano')}</h3>
      <Toggle
        label={L(
          "Kararsız kalınan öğeleri cihazdaki Gemini Nano'ya sor",
          'Ask on-device Gemini Nano about unsure elements',
        )}
        checked={info?.nano.on ?? false}
        disabled={!info || (available === 'unavailable' && !info.nano.on) || downloading}
        onChange={(on) =>
          void guard(async () => {
            // The model downloads once per browser, and only from a click: user activation.
            if (on && available !== 'available') {
              if (!lm)
                throw new Error(
                  L('Bu tarayıcıda Gemini Nano yok', 'No Gemini Nano in this browser'),
                );
              setDownloading(true);
              try {
                (await lm.create(NANO_OPTIONS)).destroy();
              } finally {
                setDownloading(false);
              }
            }
            await send('brain/setNano', { on });
            await reload();
          })
        }
      />
      <p className="note">
        {downloading
          ? L(
              'Model indiriliyor; bu birkaç dakika sürebilir.',
              'Downloading the model; this can take a few minutes.',
            )
          : available === 'unavailable'
            ? L(
                "Bu tarayıcı ya da cihaz Gemini Nano'yu desteklemiyor; katman kapalı kalır.",
                'This browser or device does not support Gemini Nano; the layer stays off.',
              )
            : L(
                'Sayfa modeli %45–75 arasında kararsız kaldığında sayfa başına en çok 3 öğe sorulur. Model cihazda çalışır; hiçbir veri dışarı çıkmaz. Yanıtlar oturum boyunca önbellekte tutulur.',
                'When the page model is unsure (45–75%), at most 3 elements per page are asked about. The model runs on the device; no data leaves it. Answers are cached for the session.',
              )}
      </p>

      <h3>{L('Kapalı olduğu siteler', 'Sites where it is off')}</h3>
      {info && info.paused.length === 0 ? (
        <p className="note">
          {L(
            'Yok. Açılır pencereden "Yanlış gizledi" dediğiniz site 7 gün burada görünür.',
            'None. A site where you say "wrongly hidden" in the popup shows here for 7 days.',
          )}
        </p>
      ) : (
        <ul className="sites">
          {info?.paused.map(({ site, until }) => (
            <li key={site}>
              <span>
                {site} <span className="muted">({new Date(until).toLocaleDateString()})</span>
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void guard(async () => {
                    await send('brain/unpause', { site });
                    await reload();
                  })
                }
              >
                {L('Yeniden aç', 'Turn back on')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>{L('Öğrenilen izleyiciler', 'Learned trackers')}</h3>
      <p className="note">
        {L(
          'Çerez yazan ya da adreste ziyaretçi kimliği taşıyan bir üçüncü taraf en az 3 farklı sitede görülürse çerezleri silinir; iki tür izlemeyle 6 sitede tekrar ederse engellenir. 60 gün görülmeyen kayıt unutulur. Gizli pencereler öğretmez.',
          'A third party that sets cookies or carries a visitor ID in its address on at least 3 different sites loses its cookies; seen on 6 sites with two kinds of tracking, it is blocked. A record unseen for 60 days is forgotten. Private windows teach nothing.',
        )}
      </p>
      <PermissionNote
        perms={REQUEST_PERMISSIONS}
        why={L(
          'Öğrenme kapalı: istekleri görmek için tarayıcıdan isteğe bağlı “webRequest” izni gerekiyor.',
          'Learning is off: seeing requests needs the optional “webRequest” browser permission.',
        )}
      />
      {info && info.trackers.length === 0 ? (
        <p className="note">{L('Henüz yok.', 'None yet.')}</p>
      ) : (
        <ul className="sites">
          {info?.trackers.map((t) => (
            <li key={t.domain}>
              <span>
                {t.domain}{' '}
                <span className="muted">
                  ({STATE_NAME[t.state]}, {t.sites} {L('site', 'sites')})
                </span>
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void guard(async () => {
                    await send('brain/forgetTracker', { domain: t.domain });
                    await reload();
                  })
                }
              >
                {L('Unut', 'Forget')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>{L('Kişisel model', 'Personal model')}</h3>
      <div className="row">
        <button
          type="button"
          disabled={!model}
          onClick={() => {
            if (!model) return;
            const blob = new Blob([JSON.stringify({ format: FORMAT, model }, null, 2)], {
              type: 'application/json',
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ax-brain-model.json';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          {L('Dışa aktar', 'Export')}
        </button>
        <button type="button" className="secondary" onClick={() => file.current?.click()}>
          {L('İçe aktar', 'Import')}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (!confirm(L('AX-Brain modeli sıfırlansın mı?', 'Reset the AX-Brain model?'))) return;
            void guard(async () => {
              await send('brain/reset', {});
              await reload();
            });
          }}
        >
          {L('Sıfırla', 'Reset')}
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          aria-label={L('AX-Brain modeli', 'AX-Brain model')}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (!chosen) return;
            void guard(async () => {
              let data: unknown;
              try {
                data = JSON.parse(await chosen.text()) as unknown;
              } catch {
                throw new Error(L('Dosya JSON değil', 'The file is not JSON'));
              }
              const bag = data as { format?: unknown; model?: unknown };
              if (bag.format !== FORMAT) {
                throw new Error(L('Bu bir AX-Brain dosyası değil', 'This is not an AX-Brain file'));
              }
              await send('brain/import', { model: bag.model });
              await reload();
            });
          }}
        />
      </div>
      <p className="note">
        {L(
          'Sıfırlamak modeli ilk hâline döndürür ve öğrenilen izleyicileri unutur; seçiciyle eklediğiniz gizleme kuralları Reklam sekmesinde kalır. İçe aktarılan model güvenli sınırlara kırpılır.',
          'Reset returns the model to its starting state and forgets learned trackers; hiding rules you added with the picker stay on the Ads tab. An imported model is clamped to safe bounds.',
        )}
      </p>
    </section>
  );
}
