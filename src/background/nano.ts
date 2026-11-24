// AX-Brain layer 3: when the page model is unsure (0.45–0.75), Chrome's on-device Gemini Nano is
// asked whether the element is an ad. Off by default; nothing leaves the device. The model runs
// in an offscreen document (`offscreen/nano.ts`): the Prompt API is not exposed to workers.

import type { NanoAvailability, NanoQuestion } from '../engines/brain/nano-judge.ts';

export type { NanoAvailability, NanoQuestion };

export const NANO_KEY = 'axBrainNano';
const NANO_TARGET = 'ax-nano';
const OFFSCREEN_URL = 'nano.html';

export async function nanoOn(): Promise<boolean> {
  return (await chrome.storage.local.get(NANO_KEY))[NANO_KEY] === true;
}

let opening: Promise<void> | null = null;
/** Firefox and older Chrome have no offscreen documents; then layer 3 has nothing to run on. */
async function ensureOffscreen(): Promise<boolean> {
  const off = (chrome as { offscreen?: typeof chrome.offscreen }).offscreen;
  if (!off) return false;
  opening ??= (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    });
    if (contexts.length === 0) {
      await off.createDocument({
        url: OFFSCREEN_URL,
        // No reason names a language model; DOM_PARSER is the nearest: page fragments are read.
        reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
        justification: 'Runs the on-device Prompt API (Gemini Nano) to judge page fragments.',
      });
    }
  })().finally(() => {
    opening = null;
  });
  try {
    await opening;
    return true;
  } catch {
    return false;
  }
}

async function ask<T>(msg: object, fallback: T): Promise<T> {
  if (!(await ensureOffscreen())) return fallback;
  try {
    const res = (await chrome.runtime.sendMessage({ target: NANO_TARGET, ...msg })) as
      T | undefined;
    return res ?? fallback;
  } catch {
    return fallback;
  }
}

export function nanoAvailability(): Promise<NanoAvailability> {
  return ask<NanoAvailability>({ type: 'availability' }, 'unavailable');
}

export async function setNano(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [NANO_KEY]: on });
  if (!on) await chrome.offscreen?.closeDocument().catch(() => undefined);
}

/** true: an ad; false: not one; null: off or no answer. */
export async function nanoJudge(q: NanoQuestion): Promise<boolean | null> {
  if (!(await nanoOn())) return null;
  return ask<boolean | null>({ type: 'judge', q }, null);
}
