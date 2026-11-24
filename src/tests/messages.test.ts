import { describe, expect, it } from 'vitest';
import { parseMessage, senderKind } from '../shared/messages.ts';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${ID}/`;

describe('parseMessage', () => {
  it('accepts well-formed messages and drops extra fields', () => {
    expect(parseMessage({ type: 'global/set', enabled: false, evil: 1 })).toEqual({
      type: 'global/set',
      enabled: false,
    });
    expect(parseMessage({ type: 'site/setPaused', site: 'example.com', paused: true })).toEqual({
      type: 'site/setPaused',
      site: 'example.com',
      paused: true,
    });
  });
  it('accepts picker features only as 12 numbers in [0, 1]', () => {
    const features = new Array<number>(12).fill(0.5);
    expect(parseMessage({ type: 'picker/add', selector: '.ad', features })).toEqual({
      type: 'picker/add',
      selector: '.ad',
      features,
    });
    expect(parseMessage({ type: 'picker/add', selector: '.ad' })).toEqual({
      type: 'picker/add',
      selector: '.ad',
    });
    for (const bad of [[1], new Array(12).fill(2), new Array(12).fill('1'), 'x']) {
      expect(parseMessage({ type: 'picker/add', selector: '.ad', features: bad })).toBeNull();
    }
  });
  it('accepts brain/broke only with a known reason', () => {
    expect(parseMessage({ type: 'brain/broke', reason: 'user' })).toEqual({
      type: 'brain/broke',
      reason: 'user',
    });
    expect(parseMessage({ type: 'brain/broke', reason: 'anything' })).toBeNull();
  });

  it('accepts a brain/setThreshold value only inside 0.5 to 0.99', () => {
    expect(parseMessage({ type: 'brain/setThreshold', threshold: 0.8 })).toEqual({
      type: 'brain/setThreshold',
      threshold: 0.8,
    });
    for (const threshold of [0.2, 1, Number.NaN, '0.8']) {
      expect(parseMessage({ type: 'brain/setThreshold', threshold })).toBeNull();
    }
  });

  it('accepts brain/ask only with short text, a few hostnames and a size', () => {
    const ok = { type: 'brain/ask', text: 'Bonus', hosts: ['bet.net'], width: 300, height: 250 };
    expect(parseMessage(ok)).toEqual(ok);
    expect(parseMessage({ ...ok, text: 'x'.repeat(401) })).toBeNull();
    expect(parseMessage({ ...ok, hosts: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBeNull();
    expect(parseMessage({ ...ok, hosts: ['Bad Host'] })).toBeNull();
    expect(parseMessage({ ...ok, width: 'wide' })).toBeNull();
    expect(parseMessage({ type: 'brain/setNano', on: 'yes' })).toBeNull();
  });

  it('accepts brain/signal only with a known kind and a web source', () => {
    const ok = { type: 'brain/signal', signal: 'fingerprint', source: 'https://t.net/fp.js' };
    expect(parseMessage(ok)).toEqual(ok);
    expect(parseMessage({ ...ok, signal: 'cookie' })).toBeNull();
    expect(parseMessage({ ...ok, source: 'javascript:alert(1)' })).toBeNull();
    expect(parseMessage({ ...ok, source: `https://t.net/${'x'.repeat(2048)}` })).toBeNull();
  });

  it('accepts brain/hidden reports only with known-shaped reasons and a valid vector', () => {
    const features = new Array<number>(12).fill(0);
    expect(parseMessage({ type: 'brain/hidden', reasons: ['iab-dimension'], features })).toEqual({
      type: 'brain/hidden',
      reasons: ['iab-dimension'],
      features,
    });
    for (const reasons of [['<img>'], 'x', new Array(13).fill('a'), [1]]) {
      expect(parseMessage({ type: 'brain/hidden', reasons, features })).toBeNull();
    }
    expect(parseMessage({ type: 'brain/hidden', reasons: [], features: [1] })).toBeNull();
  });
  it('accepts only known boolean shield switches', () => {
    expect(parseMessage({ type: 'shields/set', shields: { popups: false } })).toEqual({
      type: 'shields/set',
      shields: { popups: false },
    });
    expect(parseMessage({ type: 'shields/set', shields: { popups: 'no' } })).toBeNull();
    expect(parseMessage({ type: 'shields/set', shields: { evil: true } })).toBeNull();
    expect(parseMessage({ type: 'shields/set' })).toBeNull();
  });
  it('rejects unknown types and wrong field types', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage('global/set')).toBeNull();
    expect(parseMessage({ type: 'nope' })).toBeNull();
    expect(parseMessage({ type: 'global/set', enabled: 'false' })).toBeNull();
    expect(parseMessage({ type: 'site/setPaused', site: '*://x/*', paused: true })).toBeNull();
    expect(parseMessage({ type: 'rules/setCustom', text: 'x'.repeat(200_001) })).toBeNull();
    expect(parseMessage({ type: 'lists/setEnabled', id: 'easylist' })).toBeNull();
    expect(parseMessage({ type: 'userList/add', url: 5 })).toBeNull();
    expect(parseMessage({ type: 'cosmetic/dom', classes: [], ids: [] })).toBeNull();
  });
  it('validates privacy patches field by field', () => {
    expect(
      parseMessage({
        type: 'privacy/set',
        privacy: { fingerprint: 'strict', cookieAutoReject: true },
      }),
    ).toEqual({ type: 'privacy/set', privacy: { fingerprint: 'strict', cookieAutoReject: true } });
    expect(parseMessage({ type: 'privacy/set', privacy: { fingerprint: 'max' } })).toBeNull();
    expect(parseMessage({ type: 'privacy/set', privacy: { evil: true } })).toBeNull();
    expect(parseMessage({ type: 'tab/report', tabId: 1.5 })).toBeNull();
    expect(parseMessage({ type: 'video/set', video: { youtubeAds: false } })).toEqual({
      type: 'video/set',
      video: { youtubeAds: false },
    });
    expect(parseMessage({ type: 'video/set', video: { youtubeAds: 'no' } })).toBeNull();
    expect(parseMessage({ type: 'video/set', video: { __proto__x: true } })).toBeNull();
    expect(
      parseMessage({ type: 'video/set', video: { adMute: true, sponsorSkip: false } }),
    ).toEqual({ type: 'video/set', video: { adMute: true, sponsorSkip: false } });
    expect(parseMessage({ type: 'video/segments', videoId: 'dQw4w9WgXcQ' })).toEqual({
      type: 'video/segments',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(parseMessage({ type: 'video/segments', videoId: '../../x' })).toBeNull();
    expect(parseMessage({ type: 'video/segments', videoId: 'dQw4w9WgXcQ1' })).toBeNull();
    expect(parseMessage({ type: 'stats/get', days: 7 })).toEqual({ type: 'stats/get', days: 7 });
    expect(parseMessage({ type: 'stats/get', days: 14 })).toBeNull();
    expect(parseMessage({ type: 'theme/set', theme: 'light' })).toEqual({
      type: 'theme/set',
      theme: 'light',
    });
    expect(parseMessage({ type: 'theme/set', theme: 'neon' })).toBeNull();
    expect(
      parseMessage({ type: 'site/setProfile', site: 'a.com', profile: { network: false } }),
    ).toEqual({ type: 'site/setProfile', site: 'a.com', profile: { network: false } });
    expect(
      parseMessage({ type: 'site/setProfile', site: 'a.com', profile: { x: true } }),
    ).toBeNull();
    expect(parseMessage({ type: 'settings/import', data: { nexus: 1 } })).toEqual({
      type: 'settings/import',
      data: { nexus: 1 },
    });
  });
  it('passes only the autoconsent reports the background records', () => {
    expect(
      parseMessage({
        type: 'consent/msg',
        msg: { type: 'eval', id: 'a', snippetId: 'EVAL_X', code: 'fetch("//evil")' },
      }),
    ).toBeNull();
    expect(
      parseMessage({ type: 'consent/msg', msg: { type: 'init', url: 'https://a.com/' } }),
    ).toBeNull();
    expect(
      parseMessage({ type: 'consent/msg', msg: { type: 'optOutResult', cmp: 'X', result: true } }),
    ).toEqual({ type: 'consent/msg', msg: { type: 'optOutResult', cmp: 'X', result: true } });
    expect(parseMessage({ type: 'consent/msg', msg: { type: 'report', state: {} } })).toBeNull();
  });
  it('trims page features to strings within limits', () => {
    const classes = [
      'ad',
      '',
      7,
      'x'.repeat(513),
      ...Array.from({ length: 6000 }, (_, i) => `c${i}`),
    ];
    const msg = parseMessage({ type: 'cosmetic/dom', classes, ids: ['top'], hrefs: [] });
    expect(msg?.type).toBe('cosmetic/dom');
    if (msg?.type !== 'cosmetic/dom') return;
    expect(msg.classes[0]).toBe('ad');
    expect(msg.classes).toHaveLength(5000);
    expect(msg.ids).toEqual(['top']);
  });
});

describe('senderKind', () => {
  it('classifies extension pages as ui', () => {
    expect(senderKind({ id: ID, url: `${ORIGIN}popup.html` }, ID, ORIGIN)).toBe('ui');
    expect(
      senderKind(
        { id: ID, url: `${ORIGIN}dashboard.html`, tab: { id: 1 } as chrome.tabs.Tab },
        ID,
        ORIGIN,
      ),
    ).toBe('ui');
  });
  it('classifies web frames as content', () => {
    expect(
      senderKind(
        { id: ID, url: 'https://example.com/', tab: { id: 1 } as chrome.tabs.Tab },
        ID,
        ORIGIN,
      ),
    ).toBe('content');
  });
  it('rejects other extensions and tab-less web senders', () => {
    expect(senderKind({ id: 'other', url: `${ORIGIN}popup.html` }, ID, ORIGIN)).toBeNull();
    expect(senderKind({ id: ID, url: 'https://example.com/' }, ID, ORIGIN)).toBeNull();
    expect(senderKind({ id: ID }, ID, ORIGIN)).toBeNull();
  });
});
