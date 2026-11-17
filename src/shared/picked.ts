import { L } from './i18n.ts';
/** Hiding rules in the custom box that apply to this site: what the element picker wrote. */
export function hidingRulesFor(site: string, customRules: string): string[] {
  return customRules.split(/\r?\n/).filter((line) => {
    const at = line.indexOf('##');
    if (at <= 0) return false;
    const host = line.slice(0, at);
    return host === site || host.endsWith(`.${site}`);
  });
}

export interface ReportFacts {
  version: string;
  browser: string;
  site: string | null;
  enabled: boolean;
  paused: boolean;
  lists: readonly string[];
  customRules: number;
  userLists: number;
  matched: number | null;
  /** Dengeli, Sıkı or Özel. */
  privacyProfile: string;
  /** What the breakage wizard found, when it ran. */
  fixedBy?: string;
}

/**
 * Text for a problem report, shown to and copied by the user; nothing is sent. Only the site's name
 * goes in, never the page address, which can carry personal details.
 */
export function problemReport(f: ReportFacts): string {
  return [
    `AX Privacy ${f.version}`,
    `${L('Tarayıcı', 'Browser')}: ${f.browser}`,
    `Site: ${f.site ?? L('yok', 'none')}`,
    `${L('Koruma', 'Protection')}: ${f.enabled && !f.paused ? L('açık', 'on') : L('kapalı', 'off')}`,
    `${L('Gizlilik profili', 'Privacy profile')}: ${f.privacyProfile}`,
    `${L('Listeler', 'Lists')}: ${f.lists.join(', ')}`,
    `${L('Özel kural', 'Custom rules')}: ${f.customRules}, ${L('kullanıcı listesi', 'user lists')}: ${f.userLists}`,
    `${L('Bu sayfadaki kural eşleşmesi', 'Rule matches on this page')}: ${f.matched ?? L('bilinmiyor', 'unknown')}`,
    ...(f.fixedBy ? [`${L('Sihirbaz sonucu', 'Wizard result')}: ${f.fixedBy}`] : []),
    `${L('Sorun', 'Problem')}: `,
  ].join('\n');
}
