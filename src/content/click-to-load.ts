import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';

/** Where embeds sit before their script runs, by who would see the visit once loaded. */
const EMBEDS: [name: string, selector: string][] = [
  ['Facebook', '.fb-post, .fb-video, .fb-page, .fb-comments, iframe[src*="facebook.com/plugins/"]'],
  ['X (Twitter)', 'blockquote.twitter-tweet, blockquote.twitter-video, a.twitter-timeline'],
  ['Disqus', '#disqus_thread'],
];

/** One notice per page: a single click lets every embed in this tab load. */
let box: HTMLElement | undefined;
let text: HTMLElement | undefined;
let closed = false;

function notice(): void {
  box = document.createElement('div');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'AX Privacy');
  box.style.cssText =
    'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;box-sizing:border-box;max-width:min(380px,calc(100vw - 32px));padding:12px 14px;border:1px solid #8884;border-radius:8px;background:#f6f7f9;color:#222;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px #0003';
  text = document.createElement('div');
  const load = document.createElement('button');
  load.type = 'button';
  load.textContent = L('İçerikleri yükle', 'Load content');
  load.style.cssText =
    'all:initial;margin-top:8px;padding:6px 12px;border-radius:6px;background:#1f6feb;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer';
  load.addEventListener('click', () => {
    load.disabled = true;
    // The page's own embed code already failed; a reload lets it run as the site wrote it.
    void send('embed/load', {})
      .then(() => location.reload())
      .catch(() => (load.disabled = false));
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', L('Kapat', 'Close'));
  close.style.cssText =
    'all:initial;margin:8px 0 0 12px;padding:6px 8px;color:#555;font:600 15px system-ui,sans-serif;cursor:pointer';
  close.addEventListener('click', () => {
    closed = true;
    box?.remove();
  });
  box.append(text, load, close);
  document.documentElement.append(box);
}

function scan(): void {
  if (closed) return;
  const found = EMBEDS.flatMap(([name, selector]) => {
    const n = document.querySelectorAll(selector).length;
    return n ? [[name, `${n} ${name}`]] : [];
  });
  if (!found.length) return;
  if (!box?.isConnected) notice();
  const list = found.map(([, counted]) => counted).join(', ');
  const who = found.length === 1 && found[0] ? found[0][0] : L('bu şirketler', 'these companies');
  const line = L(
    `AX bu sayfada ${list} içeriğini engelledi. Yüklenirse ${who} sayfayı ziyaret ettiğinizi görebilir.`,
    `AX held back ${list} content on this page. Once loaded, ${who} can see that you visited it.`,
  );
  if (text && text.textContent !== line) text.textContent = line;
}

void send('embed/status', {})
  .then(({ blocked }) => {
    if (!blocked) return;
    const start = () => {
      scan();
      // Our own text changes are childList mutations too; scan only rewrites when the line differs.
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start);
    else start();
  })
  .catch(() => undefined);
