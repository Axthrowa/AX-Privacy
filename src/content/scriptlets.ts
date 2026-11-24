import { callsFor } from '../engines/adblock/scriptlets.ts';
import { SCRIPTLETS } from '../engines/adblock/scriptlet-impl.ts';
import { YOUTUBE_SITES, YT_BACKOFF_KEY } from '../engines/video/youtube.ts';

// MAIN world at document_start, in every frame. The `scriptlets/<id>.js` data files run first, in
// the same synchronous pass, so a matching page's scripts cannot run before these hooks.
declare global {
  var __nexusSl: string[] | undefined;
}

// shortcut: this world cannot read settings, so a third-party frame inside a paused site still runs
// these; registered scripts can only exclude by a frame's own address.
const tables = self.__nexusSl ?? [];
delete self.__nexusSl;
const parent = location.ancestorOrigins[0];
const host = location.hostname || (parent ? new URL(parent).hostname : '');
/** A YouTube tab that showed the ad blocker warning runs no list scriptlets either (see yt-guard). */
const youtubeBackedOff = () => {
  if (!YOUTUBE_SITES.some((site) => host === site || host.endsWith(`.${site}`))) return false;
  try {
    return sessionStorage.getItem(YT_BACKOFF_KEY) !== null;
  } catch {
    return false;
  }
};
const run = (calls: ReturnType<typeof callsFor>) => {
  for (const [name, ...args] of calls) {
    try {
      SCRIPTLETS[name]?.(...args);
    } catch {
      // One rule failing must not stop the others or disturb the page.
    }
  }
};
const calls = youtubeBackedOff() ? [] : callsFor(tables, host);
run(calls);

// Rows from list updates newer than this build (content/scriptlets-delta.ts), once per page. The
// page could send this event too, but only to run packaged scriptlets on itself.
const done = new Set(calls.map((c) => JSON.stringify(c)));
const onDelta = (e: Event) => {
  document.removeEventListener('ax-sl-delta', onDelta);
  if (youtubeBackedOff()) return;
  try {
    const detail = (e as CustomEvent<unknown>).detail;
    const more = typeof detail === 'string' ? (JSON.parse(detail) as unknown) : null;
    if (!Array.isArray(more) || !more.every((t) => typeof t === 'string')) return;
    run(callsFor(more as string[], host).filter((c) => !done.has(JSON.stringify(c))));
  } catch {
    // A malformed delta changes nothing.
  }
};
document.addEventListener('ax-sl-delta', onDelta);
