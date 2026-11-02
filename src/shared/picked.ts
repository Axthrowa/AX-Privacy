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
}

/**
 * Text for a problem report, shown to and copied by the user; nothing is sent. Only the site's name
 * goes in, never the page address, which can carry personal details.
 */
export function problemReport(f: ReportFacts): string {
  return [
    `AX Privacy ${f.version}`,
    `Tarayıcı: ${f.browser}`,
    `Site: ${f.site ?? 'yok'}`,
    `Koruma: ${f.enabled && !f.paused ? 'açık' : 'kapalı'}`,
    `Listeler: ${f.lists.join(', ')}`,
    `Özel kural: ${f.customRules}, kullanıcı listesi: ${f.userLists}`,
    `Bu sayfadaki kural eşleşmesi: ${f.matched ?? 'bilinmiyor'}`,
    'Sorun: ',
  ].join('\n');
}
