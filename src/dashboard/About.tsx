import { useRef, useState } from 'react';
import { send } from '../shared/messages.ts';
import type { Settings } from '../shared/types.ts';
import { browserLabel } from './brave.ts';

export function About({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <section id="about">
      <h2>Hakkında ve yedek</h2>
      <p>Tarayıcı: {browserLabel(settings.isBrave)}</p>
      <p className="note">
        Sürüm {chrome.runtime.getManifest().version}. Geçmiş sunucuya gitmez. Dışarı istek yalnız
        şunlarda vardır: SponsorBlock açıksa video kimliğinin 4 karakterlik özeti, ve sizin
        eklediğiniz bir filtre listesinin adresi.
      </p>
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void guard(async () => {
              const data = await send('settings/export', {});
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'ax-privacy-settings.json';
              a.click();
              URL.revokeObjectURL(a.href);
            })
          }
        >
          Ayarları dışa aktar
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void guard(async () => {
              const data = await send('settings/export', {});
              await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
              setCopied(true);
            })
          }
        >
          {copied ? 'Kopyalandı' : 'Panoya kopyala'}
        </button>
        <button type="button" className="secondary" onClick={() => file.current?.click()}>
          Ayarları içe aktar
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          aria-label="Ayar yedeği"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (!chosen) return;
            void guard(async () => {
              const text = await chosen.text();
              let data: unknown;
              try {
                data = JSON.parse(text) as unknown;
              } catch {
                throw new Error('Dosya JSON değil');
              }
              await send('settings/import', { data });
            });
          }}
        />
      </div>
      <p className="note">
        Yedek ayarları, özel kuralları, liste adreslerini ve varsa son 30 günün sayaçlarını içerir.
        Abone listenin metni yoktur; içe aktarınca listeler yeniden indirilir.
      </p>
    </section>
  );
}
