import { normalizeModel, train, type BrainModel } from '../engines/brain/brain.ts';

/** Same key as the v4 JS line, so a model trained there carries over. */
export const BRAIN_KEY = 'axBrainModel';

export async function loadBrain(): Promise<BrainModel> {
  return normalizeModel((await chrome.storage.local.get(BRAIN_KEY))[BRAIN_KEY]);
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialized so two quick updates cannot overwrite each other. Label 1: an ad, 0: not one. */
export function trainBrain(features: number[], label: 0 | 1 = 1): Promise<void> {
  return trainBrainAll([features], label);
}

export function trainBrainAll(vectors: number[][], label: 0 | 1): Promise<void> {
  const run = queue.then(async () => {
    let model = await loadBrain();
    for (const f of vectors) model = train(f, label, model);
    await chrome.storage.local.set({ [BRAIN_KEY]: model });
  });
  queue = run.catch(() => undefined);
  return run;
}

const PAUSED_KEY = 'axBrainPaused';
/** How long AX-Brain rests on a site after the user said it broke something. */
export const BRAIN_PAUSE_MS = 7 * 24 * 60 * 60_000;

async function pausedSites(): Promise<Record<string, number>> {
  const raw = (await chrome.storage.local.get(PAUSED_KEY))[PAUSED_KEY];
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
}

export async function brainPausedUntil(site: string): Promise<number | null> {
  const until = (await pausedSites())[site];
  return typeof until === 'number' && until > Date.now() ? until : null;
}

/** Sites still resting, soonest first. */
export async function brainPausedSites(): Promise<{ site: string; until: number }[]> {
  const now = Date.now();
  return Object.entries(await pausedSites())
    .filter(([, until]) => typeof until === 'number' && until > now)
    .map(([site, until]) => ({ site, until }))
    .sort((a, b) => a.until - b.until);
}

export async function unpauseBrain(site: string): Promise<void> {
  const { [site]: gone, ...rest } = await pausedSites();
  void gone;
  await chrome.storage.local.set({ [PAUSED_KEY]: rest });
}

/** The user's hiding threshold; the caller has already checked the range. */
export function setBrainThreshold(threshold: number): Promise<void> {
  const run = queue.then(async () => {
    const model = await loadBrain();
    await chrome.storage.local.set({ [BRAIN_KEY]: { ...model, threshold } });
  });
  queue = run.catch(() => undefined);
  return run;
}

export function importBrain(model: BrainModel): Promise<void> {
  const run = queue.then(() => chrome.storage.local.set({ [BRAIN_KEY]: model }));
  queue = run.catch(() => undefined);
  return run;
}

export async function pauseBrain(site: string): Promise<void> {
  const now = Date.now();
  // Expired entries are dropped here, so the map never grows past the sites paused this week.
  const kept = Object.fromEntries(Object.entries(await pausedSites()).filter(([, t]) => t > now));
  await chrome.storage.local.set({ [PAUSED_KEY]: { ...kept, [site]: now + BRAIN_PAUSE_MS } });
}
