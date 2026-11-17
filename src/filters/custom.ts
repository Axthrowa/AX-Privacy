import { CosmeticFilter, parseFilter } from '@ghostery/adblocker';
import { compileFilter } from '../engines/adblock/network.ts';
import { L } from '../shared/i18n.ts';
import type { RejectedLine } from '../shared/types.ts';

const REASONS: Record<string, string> = {
  syntax: L('Söz dizimi hatası', 'Syntax error'),
  'too-broad': L(
    'Çok geniş: bir alan adı ya da adres kalıbı gerekli',
    'Too broad: a domain or address pattern is needed',
  ),
  'document-block': L(
    'Sayfayı tamamen engelleme ($document) özel kurallarda desteklenmez',
    'Blocking whole pages ($document) is not supported in custom rules',
  ),
  'non-ascii': L(
    'Adres kalıbında ASCII dışı karakter',
    'Non-ASCII character in the address pattern',
  ),
  domain: L(
    'Alan adı listesinde joker (*) veya regex desteklenmez',
    'Wildcards (*) or regex are not supported in the domain list',
  ),
  to: L(
    '$to listesinde joker (*) veya regex desteklenmez',
    'Wildcards (*) or regex are not supported in the $to list',
  ),
  denyallow: L('$denyallow biçimi desteklenmez', 'This $denyallow form is not supported'),
  redirect: L('$redirect istisnaları desteklenmez', '$redirect exceptions are not supported'),
  'redirect-rule': L(
    '$redirect-rule MV3 DNR ile ifade edilemez',
    '$redirect-rule cannot be expressed with MV3 DNR',
  ),
  popup: L(
    '$popup başka türlerle birlikte kullanılamaz',
    '$popup cannot be combined with other types',
  ),
  types: L('Hiç kaynak türü kalmadı', 'No resource type left'),
  method: L('Bilinmeyen HTTP yöntemi', 'Unknown HTTP method'),
  removeparam: L(
    '$removeparam yalnızca tam parametre adıyla desteklenir (regex ve "tümü" değil)',
    '$removeparam is supported only with an exact parameter name (not regex or "all")',
  ),
  'removeparam-exception': L(
    '$removeparam istisnası bir alan adı (||alan.adi^ veya domain=) gerektirir',
    'A $removeparam exception needs a domain (||domain.example^ or domain=)',
  ),
};

export function reasonText(reason: string): string {
  return REASONS[reason] ?? `${L('Desteklenmeyen seçenek', 'Unsupported option')}: $${reason}`;
}

/** Cosmetic lines that would make the engine emit arbitrary CSS or run scripts. */
export function cosmeticProblem(line: string): string | null {
  if (/[{}]/.test(line)) return L('Kural içinde { } kullanılamaz', '{ } cannot be used in a rule');
  const f = parseFilter(line);
  if (!(f instanceof CosmeticFilter))
    return f ? null : L('Geçersiz gizleme kuralı', 'Invalid hiding rule');
  if (f.isHtmlFiltering()) {
    return L('HTML filtreleme MV3’te desteklenmez', 'HTML filtering is not supported in MV3');
  }
  if (f.isScriptInject()) {
    return L(
      '+js kuralları yalnızca gömülü listelerden çalışır',
      '+js rules run only from the bundled lists',
    );
  }
  // A loaded resource would tell the list's author which page matched (and attribute values).
  // Backslash too: CSS escapes can spell `url(`.
  if (f.hasCustomStyle() && /url\(|image-set\(|image\(|src\(|\\/i.test(f.getStyle())) {
    return L('Kural dışarıdan kaynak yükleyemez', 'A rule cannot load outside resources');
  }
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
