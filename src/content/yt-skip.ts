import { YOUTUBE_AD_SELECTOR } from '../engines/video/ad-state.ts';
import { matchingDuration, segmentAt, videoIdFrom } from '../engines/video/sponsorblock.ts';
import { send } from '../shared/messages.ts';
import { L } from '../shared/i18n.ts';
import { channelKey, SPONSOR_LABELS } from '../shared/sponsor.ts';
import type { PlanSegment } from '../shared/types.ts';

// YouTube, opt-in. Acts on SponsorBlock segments by the mode the user chose per category: marks
// them on the timeline, offers a button, or skips / mutes on its own with an undo. Each segment is
// acted on once per page view; seeking back into one plays it. The background looks segments up by
// hash prefix, so the video ID is not sent anywhere, and nothing here is reported back.

const TOAST_MS = 6_000;
const LOOKAHEAD_S = 2;

let current: string | null = null;
let plan: PlanSegment[] = [];
let channels: string[] = [];
/** The duration `usable` was picked for; -1 forces a new pick. */
let forDuration = -1;
let usable: PlanSegment[] = [];
const handled = new Set<number>();
let muting: { index: number; wasMuted: boolean } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let labelShown = false;

const label = (s: PlanSegment) => SPONSOR_LABELS[s.category].name;
const playerOf = (video: HTMLVideoElement) =>
  (video.closest('.html5-video-player') as HTMLElement | null) ?? video.parentElement;

/** The channel of the open video, as the exception list stores it. */
function ownerChannel(): string | null {
  const a = document.querySelector<HTMLAnchorElement>(
    'ytd-watch-metadata #owner a[href], ytd-video-owner-renderer a[href]',
  );
  return a ? channelKey(new URL(a.href, location.href).pathname) : null;
}

// ---- Player UI: one open shadow root, so page styles cannot reach it and it cannot reach the page.

let ui: { host: HTMLElement; bar: HTMLElement; toast: HTMLElement } | null = null;
function uiFor(video: HTMLVideoElement) {
  const player = playerOf(video);
  if (!player) return null;
  if (ui?.host.isConnected && ui.host.parentElement === player) return ui;
  ui?.host.remove();
  const host = document.createElement('div');
  host.dataset.axSponsor = '';
  host.style.cssText = 'position:absolute;left:12px;bottom:64px;z-index:70;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
div{display:flex;gap:6px;flex-wrap:wrap;font:500 13px/1.3 Roboto,Arial,sans-serif}
button,.toast{pointer-events:auto;border:0;border-radius:4px;padding:6px 10px;background:rgba(20,20,20,.88);color:#fff;font:inherit}
button{cursor:pointer}button:hover{background:#333}.toast:empty{display:none}.toast button{margin-left:8px;padding:2px 8px;background:#3a3a3a}
</style><div class="bar"></div><div class="toast" role="status"></div>`;
  player.append(host);
  ui = {
    host,
    bar: root.querySelector('.bar') as HTMLElement,
    toast: root.querySelector('.toast') as HTMLElement,
  };
  return ui;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(video: HTMLVideoElement, text: string, undo?: () => void) {
  const u = uiFor(video);
  if (!u) return;
  u.toast.replaceChildren(text);
  if (undo) {
    const b = document.createElement('button');
    b.textContent = L('Geri al', 'Undo');
    b.onclick = () => {
      undo();
      u.toast.replaceChildren();
    };
    u.toast.append(b);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => u.toast.replaceChildren(), TOAST_MS);
}

function setButtons(video: HTMLVideoElement, buttons: { text: string; act(): void }[]) {
  const u = uiFor(video);
  if (!u) return;
  const key = buttons.map((b) => b.text).join('\n');
  if (u.bar.dataset.key === key) return;
  u.bar.dataset.key = key;
  u.bar.replaceChildren(
    ...buttons.map(({ text, act }) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.onclick = act;
      return b;
    }),
  );
}

function drawMarkers(video: HTMLVideoElement) {
  const bar = playerOf(video)?.querySelector<HTMLElement>('.ytp-progress-bar');
  bar?.querySelector('[data-ax-markers]')?.remove();
  if (!bar || !(video.duration > 0)) return;
  const layer = document.createElement('div');
  layer.dataset.axMarkers = '';
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40';
  for (const s of usable) {
    if (s.action === 'full') continue;
    const m = document.createElement('div');
    const left = (s.start / video.duration) * 100;
    const width = s.action === 'poi' ? 0.4 : ((s.end - s.start) / video.duration) * 100;
    m.title = label(s);
    m.style.cssText = `position:absolute;top:0;bottom:0;left:${left}%;width:${width}%;min-width:2px;background:${SPONSOR_LABELS[s.category].color};opacity:.75`;
    layer.append(m);
  }
  bar.append(layer);
}

// ---- Acting on segments.

function reset(id: string | null) {
  current = id;
  plan = [];
  usable = [];
  forDuration = -1;
  handled.clear();
  muting = null;
  labelShown = false;
  clearTimeout(timer);
  if (ui) {
    ui.bar.replaceChildren();
    delete ui.bar.dataset.key;
    ui.toast.replaceChildren();
  }
}

function tick(video: HTMLVideoElement) {
  const id = videoIdFrom(location.href);
  if (id !== current) {
    reset(id);
    if (id) {
      send('video/segments', { videoId: id })
        .then((p) => {
          if (current !== id) return;
          plan = p.segments;
          forDuration = -1;
          channels = p.channels;
        })
        .catch(() => undefined);
    }
    return;
  }
  // While an ad plays, the same element shows the ad's own timeline.
  if (plan.length === 0 || document.querySelector(YOUTUBE_AD_SELECTOR)) return;
  if (!Object.is(forDuration, video.duration)) {
    forDuration = video.duration;
    usable = matchingDuration(plan, video.duration);
    drawMarkers(video);
  }
  const t = video.currentTime;
  const excepted = channels.length > 0 && channels.includes(ownerChannel() ?? '');
  const auto = (s: PlanSegment) => s.mode === 'auto' && !excepted;

  const full = usable.find((s) => s.action === 'full');
  if (full && !labelShown) {
    labelShown = true;
    toast(video, `${L('Tüm video', 'Whole video')}: ${label(full)}`);
  }

  // Mute: on while inside an automatic mute segment, back to how it was after.
  if (
    muting &&
    !(t >= (usable[muting.index]?.start ?? 0) && t < (usable[muting.index]?.end ?? 0))
  ) {
    if (!muting.wasMuted) video.muted = false;
    muting = null;
  }
  const inside = segmentAt(t, usable, handled);
  const seg = inside === null ? undefined : usable[inside];
  if (inside !== null && seg && auto(seg) && (seg.action === 'skip' || seg.action === 'mute')) {
    handled.add(inside);
    if (seg.action === 'skip') {
      video.currentTime = seg.end;
      toast(video, `${L('Atlandı', 'Skipped')}: ${label(seg)}`, () => {
        video.currentTime = seg.start;
      });
    } else {
      muting = { index: inside, wasMuted: video.muted };
      video.muted = true;
      toast(video, `Sessiz: ${label(seg)}`, () => {
        video.muted = muting?.wasMuted ?? false;
        muting = null;
      });
    }
  }

  // Buttons: a manual segment we are inside, and the highlight until it is reached.
  const buttons: { text: string; act(): void }[] = [];
  for (const [i, s] of usable.entries()) {
    if (handled.has(i) || s.mode === 'show') continue;
    const manual = s.mode === 'manual' || (excepted && s.mode === 'auto');
    if (manual && (s.action === 'skip' || s.action === 'mute') && t >= s.start && t < s.end) {
      buttons.push({
        text: `${L('Atla', 'Skip')}: ${label(s)}`,
        act: () => {
          handled.add(i);
          video.currentTime = s.end;
        },
      });
    }
    if (s.action === 'poi' && t < s.start) {
      buttons.push({
        text: L('Önemli ana git', 'Go to the highlight'),
        act: () => {
          handled.add(i);
          video.currentTime = s.start;
        },
      });
    }
  }
  setButtons(video, buttons);

  // timeupdate fires about 4 times a second; a timer lands on the next automatic start exactly.
  clearTimeout(timer);
  const next = usable.find(
    (s, i) => !handled.has(i) && auto(s) && s.start > t && s.start - t < LOOKAHEAD_S,
  );
  if (next && !video.paused) {
    const wait = ((next.start - t) / (video.playbackRate || 1)) * 1000;
    timer = setTimeout(() => tick(video), Math.max(0, wait) + 5);
  }
}

for (const type of ['timeupdate', 'durationchange', 'seeked']) {
  document.addEventListener(
    type,
    (e) => {
      if (e.target instanceof HTMLVideoElement) tick(e.target);
    },
    true,
  );
}
