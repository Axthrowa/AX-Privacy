import type { ConsentMessage } from '../shared/messages.ts';
import type { ConsentReport } from '../shared/types.ts';

/**
 * The consent script handles rules and page checks itself (see content/consent.ts); only a found
 * banner and the opt-out result come here, for the tab report and stats.
 */
export async function handleConsent(
  msg: ConsentMessage,
  ctx: { tabId: number },
  record: (tabId: number, report: ConsentReport) => Promise<void>,
): Promise<null> {
  if (msg.type === 'popupFound') await record(ctx.tabId, { cmp: msg.cmp, result: null });
  if (msg.type === 'optOutResult') await record(ctx.tabId, { cmp: msg.cmp, result: msg.result });
  return null;
}
