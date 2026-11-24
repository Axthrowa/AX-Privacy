import { SCRIPTLET_DELTA_KEY } from '../engines/adblock/scriptlets.ts';

// Isolated world. `+js()` rows that updated lists added since this version was built: data only,
// naming scriptlets the package already has. content/scriptlets.ts (MAIN) runs the ones for this
// page. They come a moment after the packaged ones, since storage is read asynchronously.
void chrome.storage.local.get([SCRIPTLET_DELTA_KEY, 'settings']).then((got) => {
  const delta = (got[SCRIPTLET_DELTA_KEY] ?? {}) as Record<string, string>;
  const enabled = (got.settings as { enabledLists?: string[] } | undefined)?.enabledLists ?? [];
  const tables = Object.entries(delta)
    .filter(([id, t]) => enabled.includes(id) && typeof t === 'string' && t)
    .map(([, t]) => t);
  if (tables.length) {
    // A string crosses into the page's world; an object would not.
    document.dispatchEvent(new CustomEvent('ax-sl-delta', { detail: JSON.stringify(tables) }));
  }
});
