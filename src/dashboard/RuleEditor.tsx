import { useMemo, useRef, useState } from 'react';
import { checkLine, lineTokens, matchesAddress, ruleScope } from '../filters/rule-editor.ts';
import { L } from '../shared/i18n.ts';

/**
 * Filter text box with highlighting (a coloured copy under a transparent textarea), the error of
 * each line as it is typed, and which lines would act on a test address.
 */
export function RuleEditor({ value, onChange }: { value: string; onChange(v: string): void }) {
  const back = useRef<HTMLPreElement>(null);
  const [address, setAddress] = useState('');
  const [caretLine, setCaretLine] = useState(0);
  const lines = useMemo(() => value.split('\n'), [value]);
  const errors = useMemo(
    () =>
      lines.flatMap((l, i) => {
        const c = checkLine(l);
        return c.kind === 'error' ? [{ n: i + 1, line: l.trim(), reason: c.reason }] : [];
      }),
    [lines],
  );
  const matching = useMemo(
    () =>
      address.trim()
        ? lines.flatMap((l, i) =>
            matchesAddress(l, address.trim()) ? [{ n: i + 1, line: l }] : [],
          )
        : [],
    [lines, address],
  );
  const scope = ruleScope(lines[caretLine] ?? '');
  const caret = (t: HTMLTextAreaElement) =>
    setCaretLine(t.value.slice(0, t.selectionStart).split('\n').length - 1);

  return (
    <>
      <div className="rule-editor">
        <pre ref={back} aria-hidden="true">
          {lines.map((l, i) => (
            <span key={i}>
              {lineTokens(l).map((t, j) => (
                <span key={j} className={t.cls ? `tok-${t.cls}` : undefined}>
                  {t.text}
                </span>
              ))}
              {'\n'}
            </span>
          ))}
        </pre>
        <textarea
          aria-label={L('Özel kurallar', 'Custom rules')}
          aria-describedby="rule-errors"
          value={value}
          spellCheck={false}
          rows={10}
          wrap="off"
          onChange={(e) => {
            onChange(e.target.value);
            caret(e.target);
          }}
          onSelect={(e) => caret(e.currentTarget)}
          onScroll={(e) => {
            if (back.current) {
              back.current.scrollTop = e.currentTarget.scrollTop;
              back.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
        />
      </div>
      {scope && <p className="note">{scope}</p>}
      <div id="rule-errors" aria-live="polite">
        {errors.length > 0 && (
          <ul className="rejected">
            {errors.map((e) => (
              <li key={e.n}>
                {L('Satır', 'Line')} {e.n}: <code>{e.line}</code>: {e.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="field">
        <span>{L('Eşleşme önizlemesi', 'Match preview')}</span>
        <input
          type="url"
          placeholder="https://www.example.com/ads/banner.js"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      {address.trim() && (
        <p className="note">
          {matching.length === 0
            ? L('Bu adrese hiçbir satır uymuyor.', 'No line acts on this address.')
            : L(
                `${matching.length} satır bu adreste çalışır: `,
                `${matching.length} lines act on this address: `,
              )}
          {matching.slice(0, 20).map((m) => (
            <code key={m.n} className="match-line">
              {m.n}: {m.line}
            </code>
          ))}
        </p>
      )}
    </>
  );
}
