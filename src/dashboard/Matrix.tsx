import { useState } from 'react';
import { parseMatrixLine } from '../engines/core/matrix.ts';
import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';
import type { Settings } from '../shared/types.ts';
import { Toggle } from './Toggle.tsx';

/** Advanced mode: the dynamic filtering rules, one `site target type action` per line. */
export function Matrix({
  settings,
  guard,
}: {
  settings: Settings;
  guard(action: () => Promise<unknown>): Promise<void>;
}) {
  const [draft, setDraft] = useState(settings.matrix.rules.join('\n'));
  const bad = draft
    .split('\n')
    .map((l, i) => ({ n: i + 1, l: l.trim() }))
    .filter(({ l }) => l && !l.startsWith('#') && !parseMatrixLine(l));
  return (
    <section id="matrix">
      <h2>{L('Gelişmiş mod', 'Advanced mode')}</h2>
      <Toggle
        label={L('Dinamik kural matrisini kullan', 'Use the dynamic rule matrix')}
        checked={settings.matrix.on}
        onChange={(on) => void guard(() => send('matrix/set', { on }))}
      />
      <p className="note">
        {L(
          <>
            Satır başına <code>site hedef tür eylem</code>. Site: kuralın geçerli olduğu sayfalar (
            <code>*</code> tümü). Hedef: üçüncü taraf alan adı (<code>*</code> tümü). Tür:{' '}
            <code>* script frame image xhr css font media</code>. Eylem: <code>block</code>{' '}
            engeller, <code>allow</code> listelere rağmen izin verir, <code>noop</code> daha genel
            bir matris kuralını bu hücrede kaldırır. En özel kural kazanır. Örnek:{' '}
            <code>* * script block</code> ve <code>example.com cdn.example.net * allow</code>. Açık
            olunca açılır pencerede bu sayfanın üçüncü taraf alan adları için hücreler görünür
            (ayrıntılı raporlar gerekir).
          </>,
          <>
            One <code>site target type action</code> per line. Site: the pages it applies to (
            <code>*</code> all). Target: a third-party domain (<code>*</code> all). Type:{' '}
            <code>* script frame image xhr css font media</code>. Action: <code>block</code> blocks,{' '}
            <code>allow</code> allows despite the lists, <code>noop</code> lifts a broader matrix
            rule in this cell. The most specific rule wins. Example: <code>* * script block</code>{' '}
            and <code>example.com cdn.example.net * allow</code>. When on, the popup shows cells for
            this page’s third-party domains (needs detailed reports).
          </>,
        )}
      </p>
      <textarea
        aria-label={L('Matris kuralları', 'Matrix rules')}
        rows={8}
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {bad.length > 0 && (
        <ul className="rejected">
          {bad.map(({ n, l }) => (
            <li key={n}>
              {L('Satır', 'Line')} {n}: <code>{l}</code>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          onClick={() =>
            void guard(async () => {
              const s = await send('matrix/set', { rules: draft.split('\n') });
              setDraft(s.matrix.rules.join('\n'));
            })
          }
        >
          {L('Matrisi uygula', 'Apply matrix')}
        </button>
      </div>
    </section>
  );
}
