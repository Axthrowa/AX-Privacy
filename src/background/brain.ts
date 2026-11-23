import { normalizeModel, train, type BrainModel } from '../engines/brain/brain.ts';

/** Same key as the v4 JS line, so a model trained there carries over. */
export const BRAIN_KEY = 'axBrainModel';

export async function loadBrain(): Promise<BrainModel> {
  return normalizeModel((await chrome.storage.local.get(BRAIN_KEY))[BRAIN_KEY]);
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialized so two quick picks cannot overwrite each other's update. */
export function trainBrain(features: number[]): Promise<void> {
  const run = queue.then(async () => {
    const model = train(features, 1, await loadBrain());
    await chrome.storage.local.set({ [BRAIN_KEY]: model });
  });
  queue = run.catch(() => undefined);
  return run;
}
