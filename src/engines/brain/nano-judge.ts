// AX-Brain layer 3 judge: asks a Prompt API model (Gemini Nano on the device) whether an unsure
// element is an ad. The API comes in as a parameter: Chrome exposes it to documents only, so the
// extension runs this in its offscreen document, and tests pass a fake.

/** What the page sends about an unsure element; already trimmed and checked. */
export interface NanoQuestion {
  text: string;
  hosts: string[];
  width: number;
  height: number;
}

export type NanoAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface Session {
  prompt(input: string, opts?: { responseConstraint?: unknown }): Promise<string>;
  clone(): Promise<Session>;
  destroy(): void;
}
export interface LanguageModelApi {
  availability(opts?: unknown): Promise<NanoAvailability>;
  create(opts?: unknown): Promise<Session>;
}

/** Same options for availability() and create(), as the API asks. */
export const NANO_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

const SYSTEM = [
  'You check fragments of web pages for an ad blocker.',
  'Answer true only when the fragment is an advertisement, a sponsored promotion, a casino or',
  'betting promo, a fake download or a fake "verify / allow notifications" prompt.',
  'Answer false for navigation, articles, comments, product listings of the site itself, cookie',
  'notices, sign-in forms and anything you are unsure about.',
].join(' ');

export function describeQuestion(q: NanoQuestion): string {
  return [
    `Text: ${q.text || '(none)'}`,
    `Links to: ${q.hosts.join(', ') || '(none)'}`,
    `Size: ${Math.round(q.width)}x${Math.round(q.height)} px`,
  ].join('\n');
}

/** Answers by question; a page re-renders the same ad many times. */
const MAX_CACHE = 500;

export function createJudge(api: LanguageModelApi | undefined) {
  let base: Promise<Session> | null = null;
  const cache = new Map<string, boolean>();
  let queue: Promise<unknown> = Promise.resolve();

  const availability = async (): Promise<NanoAvailability> => {
    if (!api) return 'unavailable';
    try {
      return await api.availability(NANO_OPTIONS);
    } catch {
      return 'unavailable';
    }
  };

  /**
   * true: an ad; false: not one; null: no answer (no model, error). One question at a time: the
   * on-device model handles a single prompt well and a queue of them badly.
   */
  const judge = (q: NanoQuestion): Promise<boolean | null> => {
    const input = describeQuestion(q);
    const known = cache.get(input);
    if (known !== undefined) return Promise.resolve(known);
    const run = queue.then(async (): Promise<boolean | null> => {
      if (!api || (await availability()) !== 'available') return null;
      base ??= api.create({
        initialPrompts: [{ role: 'system', content: SYSTEM }],
        ...NANO_OPTIONS,
      });
      // A clone per question, so answers never lean on earlier ones and the context stays small.
      const session = await (await base).clone();
      try {
        const raw = await session.prompt(input, { responseConstraint: { type: 'boolean' } });
        const answer = JSON.parse(raw) === true;
        if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
        cache.set(input, answer);
        return answer;
      } finally {
        session.destroy();
      }
    });
    queue = run.catch(() => undefined);
    return run.catch(() => {
      base = null;
      return null;
    });
  };

  return { availability, judge };
}
