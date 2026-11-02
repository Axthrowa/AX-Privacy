import { playlistTools, twitchWorkerHook } from '../engines/video/twitch.ts';

// MAIN world on Twitch. The player downloads its playlists in a worker built from a blob, so this
// prepends the playlist filter to that blob. Other workers on the page are left alone.

const HOOK = `(${String(twitchWorkerHook)})((${String(playlistTools)})());\n`;

function blobText(url: string): string {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.send();
  return xhr.responseText;
}

function jumpToLive(): void {
  const video = document.querySelector('video');
  const end = video?.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
  if (video && end > video.currentTime + 1) video.currentTime = end - 0.5;
}

const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    let target = url;
    const src = String(url);
    if (src.startsWith('blob:')) {
      try {
        const text = blobText(src);
        if (/wasmworker|amazon-ivs/i.test(text)) {
          target = URL.createObjectURL(new Blob([HOOK, text], { type: 'text/javascript' }));
        }
      } catch {
        // An unreadable blob runs as it was: the player must never lose its worker because of us.
      }
    }
    super(target, options);
    if (target !== url) {
      this.addEventListener('message', (e: MessageEvent<{ nexusTwitch?: string }>) => {
        if (e.data?.nexusTwitch === 'ad-end') jumpToLive();
      });
    }
  }
};
