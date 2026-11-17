import { L } from '../shared/i18n.ts';
import { send } from '../shared/messages.ts';

type BraveNavigator = Navigator & { brave?: { isBrave(): Promise<boolean> } };

/** `navigator.brave` only exists in Brave; records the result if it changed. */
export async function detectBrave(known: boolean | null): Promise<boolean> {
  const isBrave = (await (navigator as BraveNavigator).brave?.isBrave()) === true;
  if (isBrave !== known) await send('env/brave', { isBrave });
  return isBrave;
}

export function browserLabel(isBrave: boolean | null): string {
  if (isBrave === null) return L('Henüz algılanmadı', 'Not detected yet');
  return isBrave
    ? 'Brave'
    : L('Brave değil (Chromium tabanlı veya Firefox)', 'Not Brave (Chromium-based or Firefox)');
}
