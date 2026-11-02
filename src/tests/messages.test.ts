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
  it('passes only the autoconsent messages the background handles, minus page-supplied code', () => {
    expect(
      parseMessage({
        type: 'consent/msg',
        msg: { type: 'eval', id: 'a', snippetId: 'EVAL_X', code: 'fetch("//evil")' },
      }),
    ).toEqual({ type: 'consent/msg', msg: { type: 'eval', id: 'a', snippetId: 'EVAL_X' } });
    expect(
      parseMessage({ type: 'consent/msg', msg: { type: 'optOutResult', cmp: 'X', result: true } }),
    ).toEqual({ type: 'consent/msg', msg: { type: 'optOutResult', cmp: 'X', result: true } });
    expect(parseMessage({ type: 'consent/msg', msg: { type: 'report', state: {} } })).toBeNull();
    expect(parseMessage({ type: 'consent/msg', msg: { type: 'eval', id: 'a' } })).toBeNull();
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
