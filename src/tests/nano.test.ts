import { describe, expect, it } from 'vitest';
import { createJudge, type LanguageModelApi } from '../engines/brain/nano-judge.ts';

function fake(availability = 'available') {
  const prompts: string[] = [];
  const session = {
    prompt: async (input: string) => {
      prompts.push(input);
      return input.includes('Casino') ? 'true' : 'false';
    },
    clone: async () => session,
    destroy: () => undefined,
  };
  const api = {
    availability: async () => availability,
    create: async () => session,
  } as unknown as LanguageModelApi;
  return { api, prompts };
}

const q = (text: string) => ({ text, hosts: ['bet.net'], width: 300, height: 250 });

describe('AX-Brain layer 3: Gemini Nano judge', () => {
  it('answers nothing without the Prompt API', async () => {
    const judge = createJudge(undefined);
    expect(await judge.availability()).toBe('unavailable');
    expect(await judge.judge(q('Casino bonus'))).toBeNull();
  });

  it('asks once per distinct question and caches the answer', async () => {
    const { api, prompts } = fake();
    const judge = createJudge(api);
    expect(await judge.judge(q('Casino bonus'))).toBe(true);
    expect(await judge.judge(q('Casino bonus'))).toBe(true);
    expect(await judge.judge(q('Sports news'))).toBe(false);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('Links to: bet.net');
  });

  it('stays silent until the model is downloaded', async () => {
    const { api, prompts } = fake('downloadable');
    const judge = createJudge(api);
    expect(await judge.availability()).toBe('downloadable');
    expect(await judge.judge(q('Casino bonus'))).toBeNull();
    expect(prompts).toHaveLength(0);
  });
});
