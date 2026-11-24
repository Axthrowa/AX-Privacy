// Offscreen document for AX-Brain layer 3: Chrome exposes the Prompt API to documents, not to the
// service worker, so the worker sends its questions here.
import {
  createJudge,
  type LanguageModelApi,
  type NanoQuestion,
} from '../engines/brain/nano-judge.ts';

const NANO_TARGET = 'ax-nano';

const judge = createJudge((globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel);

chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
  // Only the extension's own worker; content scripts' messages reach extension documents too.
  if (sender.id !== chrome.runtime.id || sender.tab || typeof msg !== 'object' || msg === null) {
    return;
  }
  const m = msg as { target?: unknown; type?: unknown; q?: NanoQuestion };
  if (m.target !== NANO_TARGET) return;
  if (m.type === 'availability') {
    void judge.availability().then(reply);
    return true;
  }
  if (m.type === 'judge' && m.q) {
    void judge.judge(m.q).then(reply);
    return true;
  }
});
