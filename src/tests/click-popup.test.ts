import { describe, expect, it } from 'vitest';
import { callersOf, isScriptLink, shouldBlockOpen } from '../engines/popup/click.ts';

const page = 'https://netprime.me/watch';

describe('shouldBlockOpen', () => {
  it('blocks a third-party or blank window opened from a click that was not that link', () => {
    expect(shouldBlockOpen(page, 'https://ads.example/landing', null, false)).toBe(true);
    expect(shouldBlockOpen(page, 'about:blank', null, false)).toBe(true);
    expect(shouldBlockOpen(page, 'https://ads.example/a', 'https://netprime.me/title', false)).toBe(
      true,
    );
  });

  it('allows the link under the cursor, and any same-site window', () => {
    expect(
      shouldBlockOpen(page, 'https://fine.example/out', 'https://fine.example/out', false),
    ).toBe(false);
    expect(shouldBlockOpen(page, 'https://www.netprime.me/player', null, false)).toBe(false);
    expect(shouldBlockOpen(page, '/player', null, false)).toBe(false);
  });

  it('blocks a full-page third-party overlay even when the opened URL is that overlay', () => {
    expect(shouldBlockOpen(page, 'https://ads.example/a', 'https://ads.example/a', true)).toBe(
      true,
    );
  });

  const button = (...callers: string[]) => ({ onControl: true, callers });

  it('lets a button on the page open a window with the page own code', () => {
    const share = 'https://share.example/post';
    expect(shouldBlockOpen(page, share, null, false, button())).toBe(false);
    expect(shouldBlockOpen(page, share, null, false, button('https://netprime.me/app.js'))).toBe(
      false,
    );
    expect(
      shouldBlockOpen(page, share, null, false, button('https://cdn.netprime-static.com/a.js')),
    ).toBe(false);
  });

  it('blocks an ad script hooking the same button, and lets an SDK open its own site', () => {
    const ad = 'https://coronisoralogy.cfd/x';
    expect(shouldBlockOpen(page, ad, null, false, button('https://lt.bollingpatties.com/r'))).toBe(
      true,
    );
    expect(
      shouldBlockOpen(
        page,
        'https://sdk.example/login',
        null,
        false,
        button('https://cdn.sdk.example/sdk.js'),
      ),
    ).toBe(false);
  });

  it('never blocks sign-in, payment and sharing destinations', () => {
    for (const dest of [
      'https://accounts.google.com/o/oauth2/auth',
      'https://www.facebook.com/sharer/sharer.php',
      'https://www.paypal.com/checkout',
    ]) {
      expect(shouldBlockOpen(page, dest, null, false)).toBe(false);
      expect(
        shouldBlockOpen(page, dest, null, false, button('https://cdn.other.example/a.js')),
      ).toBe(false);
    }
  });

  it('still blocks a click on empty page space, whoever asks', () => {
    expect(
      shouldBlockOpen(page, 'https://ads.example/a', null, false, {
        onControl: false,
        callers: ['https://netprime.me/app.js'],
      }),
    ).toBe(true);
  });

  it('reads script URLs off a stack and spots links that only run a script', () => {
    expect(
      callersOf(
        'Error\n at j4 (https://lt.bollingpatties.com/raopfHgJ6uO/vWlLn:1:65581)\n at <anonymous>:3:1\n at https://a.example/b.js?x=1:2:3',
      ),
    ).toEqual(['https://lt.bollingpatties.com/raopfHgJ6uO/vWlLn', 'https://a.example/b.js?x=1']);
    expect(isScriptLink(page, '#')).toBe(true);
    expect(isScriptLink(page, 'javascript:void(0)')).toBe(true);
    expect(isScriptLink(page, 'https://netprime.me/title')).toBe(false);
  });
});
