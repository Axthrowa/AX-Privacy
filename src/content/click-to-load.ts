import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';

/** Where embeds sit before their script runs, by who would see the visit once loaded. */
const EMBEDS: [name: string, selector: string][] = [
  ['Facebook', '.fb-post, .fb-video, .fb-page, .fb-comments, iframe[src*="facebook.com/plugins/"]'],
  ['X (Twitter)', 'blockquote.twitter-tweet, blockquote.twitter-video, a.twitter-timeline'],
  ['Disqus', '#disqus_thread'],
];
const seen = new WeakSet<Element>();

function placeholder(name: string): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'all:initial;display:block;box-sizing:border-box;max-width:550px;margin:8px 0;padding:12px 14px;border:1px solid #8884;border-radius:8px;background:#f6f7f9;color:#222;font:14px/1.4 system-ui,sans-serif';
  const text = document.createElement('div');
  text.textContent = L(
    `AX bu ${name} içeriğini engelledi. Yüklenirse ${name} bu sayfayı ziyaret ettiğinizi görebilir.`,
    `AX held back this ${name} content. Once loaded, ${name} can see that you visited this page.`,
  );
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = L(`${name} içeriğini yükle`, `Load ${name} content`);
  button.style.cssText =
    'all:initial;margin-top:8px;padding:6px 12px;border-radius:6px;background:#1f6feb;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer';
  button.addEventListener('click', () => {
    button.disabled = true;
    // The page's own embed code already failed; a reload lets it run as the site wrote it.
    void send('embed/load', {})
      .then(() => location.reload())
      .catch(() => (button.disabled = false));
  });
  box.append(text, button);
  return box;
}

function scan(): void {
  for (const [name, selector] of EMBEDS) {
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el)) continue;
      seen.add(el);
      el.before(placeholder(name));
    }
  }
}

void send('embed/status', {})
  .then(({ blocked }) => {
    if (!blocked) return;
    const start = () => {
      scan();
      new MutationObserver(scan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start);
    else start();
  })
  .catch(() => undefined);
