import { CosmeticFilter, parseFilter } from '@ghostery/adblocker';
import { compileFilter } from '../engines/adblock/network.ts';
import type { RejectedLine } from '../shared/types.ts';

const REASONS: Record<string, string> = {
  syntax: 'Söz dizimi hatası',
  'too-broad': 'Çok geniş: bir alan adı ya da adres kalıbı gerekli',
  'document-block': 'Sayfayı tamamen engelleme ($document) Aşama 5’te',
  'non-ascii': 'Adres kalıbında ASCII dışı karakter',
  domain: 'Alan adı listesinde joker (*) veya regex desteklenmez',
  to: '$to listesinde joker (*) veya regex desteklenmez',
  denyallow: '$denyallow biçimi desteklenmez',
  redirect: '$redirect istisnaları desteklenmez',
  'redirect-rule': '$redirect-rule MV3 DNR ile ifade edilemez',
  popup: '$popup başka türlerle birlikte kullanılamaz',
  types: 'Hiç kaynak türü kalmadı',
  method: 'Bilinmeyen HTTP yöntemi',
  removeparam: '$removeparam yalnızca tam parametre adıyla desteklenir (regex ve "tümü" değil)',
  'removeparam-exception':
    '$removeparam istisnası bir alan adı (||alan.adi^ veya domain=) gerektirir',
};

export function reasonText(reason: string): string {
  return REASONS[reason] ?? `Desteklenmeyen seçenek: $${reason}`;
}

/** Cosmetic lines that would make the engine emit arbitrary CSS or run scripts. */
export function cosmeticProblem(line: string): string | null {
  if (/[{}]/.test(line)) return 'Kural içinde { } kullanılamaz';
  const f = parseFilter(line);
  if (!(f instanceof CosmeticFilter)) return f ? null : 'Geçersiz gizleme kuralı';
  if (f.isHtmlFiltering()) return 'HTML filtreleme MV3’te desteklenmez';
  if (f.isScriptInject()) return '+js kuralları yalnızca gömülü listelerden çalışır';
  return null;
}

/**
 * The custom-rule line for a picked element, or null if the selector is unusable. A line break would
 * smuggle in further rules, so the picker's text can never become more than this one host-scoped rule.
 */
export function pickedRule(url: string | undefined, selector: string): string | null {
  if (!url || !selector || selector.length > 1024 || /[\r\n]/.test(selector)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const rule = `${u.hostname}##${selector}`;
  const compiled = compileFilter(rule, { allowRegex: true });
  return compiled.kind === 'cosmetic' && !cosmeticProblem(rule) ? rule : null;
}

export interface SplitRules {
  network: string[];
  cosmetic: string[];
  rejected: RejectedLine[];
}

/**
 * Sorts filter text into network lines (compiled to DNR) and cosmetic lines (fed to the cosmetic
 * engine). Network regexes pass here and are checked with `isRegexSupported` when applied.
 */
export function splitRules(text: string): SplitRules {
  const out: SplitRules = { network: [], cosmetic: [], rejected: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const res = compileFilter(line, { allowRegex: true });
    if (res.kind === 'comment') continue;
    if (res.kind === 'cosmetic') {
      const problem = cosmeticProblem(line);
      if (problem) out.rejected.push({ line, reason: problem });
      else out.cosmetic.push(line);
    } else if (res.kind === 'unsupported') {
      out.rejected.push({ line, reason: reasonText(res.reason) });
    } else {
      out.network.push(line);
    }
  }
  return out;
}

/** Drops cosmetic lines of a subscribed list that `cosmeticProblem` rejects. */
export function safeCosmeticLines(lines: readonly string[]): string[] {
  return lines.filter(
    (l) => compileFilter(l, { allowRegex: true }).kind === 'cosmetic' && !cosmeticProblem(l),
  );
}
