import AutoConsent, { type BackgroundMessage } from '@duckduckgo/autoconsent';
import { send } from '../shared/messages.ts';

const HANDLED = new Set(['init', 'eval', 'popupFound', 'optOutResult', 'autoconsentDone']);

// Rules and config come from the background in reply to `init`, so nothing large is bundled here.
const consent: AutoConsent = new AutoConsent(async (msg) => {
  if (!HANDLED.has(msg.type)) return;
  const reply = await send('consent/msg', { msg: msg as never }).catch(() => null);
  if (reply) await consent.receiveMessageCallback(reply as BackgroundMessage);
});
