// Isolated-world half of miner-guard.ts: passes its verdict to the background, once per frame.
import { send } from '../shared/messages.ts';

let sent = 0;
document.addEventListener('ax-miner', (e) => {
  if (!(e instanceof CustomEvent) || sent >= 2) return;
  const verdict = e.detail as unknown;
  if (verdict !== 'stop' && verdict !== 'warn') return;
  sent++;
  void send('security/miner', { stopped: verdict === 'stop' }).catch(() => undefined);
});
