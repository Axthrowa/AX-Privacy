import { parse } from 'tldts';

export type Severity = 'high' | 'medium' | 'low';
export type RiskLevel = Severity | 'none';

export interface Finding {
  id:
    | 'warning-bypassed'
    | 'homograph'
    | 'lookalike'
    | 'brand-subdomain'
    | 'brand-in-name'
    | 'userinfo'
    | 'ip-host'
    | 'insecure-password';
  severity: Severity;
  text: string;
}

export interface RiskReport {
  /** Worst finding; 'none' means nothing was found, not that the site is safe. */
  level: RiskLevel;
  findings: Finding[];
}

/**
 * Brands phishing pages commonly imitate, keyed by the name a lookalike would copy, with the
 * registrable domains the brand really uses. Heuristic only: a match is a reason to look twice.
 */
export const BRANDS: Readonly<Record<string, readonly string[]>> = {
  google: ['google.com', 'google.com.tr', 'youtube.com', 'gmail.com'],
  youtube: ['youtube.com', 'google.com'],
  gmail: ['gmail.com', 'google.com'],
  paypal: ['paypal.com', 'paypal.me'],
  apple: ['apple.com', 'icloud.com'],
  icloud: ['icloud.com', 'apple.com'],
  microsoft: ['microsoft.com', 'live.com', 'office.com', 'microsoftonline.com'],
  outlook: ['outlook.com', 'live.com', 'office.com'],
  amazon: ['amazon.com', 'amazon.com.tr'],
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  whatsapp: ['whatsapp.com', 'whatsapp.net'],
  netflix: ['netflix.com'],
  steamcommunity: ['steamcommunity.com', 'steampowered.com'],
  steampowered: ['steampowered.com', 'steamcommunity.com'],
  binance: ['binance.com', 'binance.tr'],
  coinbase: ['coinbase.com'],
  metamask: ['metamask.io'],
  ziraatbank: ['ziraatbank.com.tr'],
  garantibbva: ['garantibbva.com.tr'],
  akbank: ['akbank.com'],
  isbank: ['isbank.com.tr'],
  yapikredi: ['yapikredi.com.tr'],
  halkbank: ['halkbank.com.tr'],
  vakifbank: ['vakifbank.com.tr'],
  enpara: ['enpara.com'],
  edevlet: ['turkiye.gov.tr'],
  trendyol: ['trendyol.com'],
  hepsiburada: ['hepsiburada.com'],
  sahibinden: ['sahibinden.com'],
};

/** Cyrillic and Greek letters drawn like Latin ones, plus digits used as letters. */
const CONFUSABLE: Readonly<Record<string, string>> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ԁ: 'd',
  ӏ: 'l',
  ԛ: 'q',
  ԝ: 'w',
  ɡ: 'g',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '5': 's',
};

const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

const BASE = 36;
function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / 700) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - 1) * 26) >> 1) {
    d = Math.floor(d / (BASE - 1));
    k += BASE;
  }
  return k + Math.floor((BASE * d) / (d + 38));
}

/** RFC 3492 decoding of one label without its `xn--` prefix; null if malformed. */
export function punycodeDecode(input: string): string | null {
  const b = input.lastIndexOf('-');
  const out = b >= 0 ? [...input.slice(0, b)].map((c) => c.charCodeAt(0)) : [];
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let idx = b >= 0 ? b + 1 : 0; idx < input.length;) {
    const old = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (idx >= input.length) return null;
      const c = input.charCodeAt(idx++);
      const digit =
        c >= 48 && c <= 57
          ? c - 22
          : c >= 65 && c <= 90
            ? c - 65
            : c >= 97 && c <= 122
              ? c - 97
              : BASE;
      if (digit >= BASE) return null;
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const len = out.length + 1;
    bias = adapt(i - old, len, old === 0);
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

const skeleton = (s: string) => [...s].map((c) => CONFUSABLE[c] ?? c).join('');

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const isOfficial = (brand: string, domain: string) => BRANDS[brand]?.includes(domain) ?? false;

function isPublicIp(host: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host.startsWith('[') && host !== '[::1]';
  const [a = 0, b = 0] = host.split('.').map(Number);
  return !(
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Local checks of the address alone; nothing is looked up or sent anywhere. */
export function analyzeUrl(url: string): Finding[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return [];
  const findings: Finding[] = [];
  const host = u.hostname;

  if (u.username || u.password) {
    findings.push({
      id: 'userinfo',
      severity: 'medium',
      text: `Adreste "@" öncesi kullanıcı bilgisi var; açılan site aslında ${host}.`,
    });
  }
  if (isPublicIp(host)) {
    findings.push({
      id: 'ip-host',
      severity: 'low',
      text: 'Site alan adı yerine doğrudan IP adresiyle açılmış.',
    });
    return findings;
  }

  const p = parse(host, { allowPrivateDomains: true });
  const domain = p.domain ?? host;
  const label = p.domainWithoutSuffix ?? '';

  for (const ascii of host.split('.')) {
    if (!ascii.startsWith('xn--')) continue;
    const decoded = punycodeDecode(ascii.slice(4));
    if (!decoded) continue;
    const scripts = SCRIPTS.filter((re) => re.test(decoded)).length;
    const lookalikeOnly = [...decoded].every((c) => /[a-z0-9-]/.test(c) || c in CONFUSABLE);
    if (scripts > 1 || lookalikeOnly) {
      findings.push({
        id: 'homograph',
        severity: 'medium',
        text: `"${decoded}" Latin harflerine benzeyen başka alfabe harfleri içeriyor (${ascii}).`,
      });
      break;
    }
  }

  const plain = label.includes('xn--')
    ? label
        .split('.')
        .map((l) => (l.startsWith('xn--') ? (punycodeDecode(l.slice(4)) ?? l) : l))
        .join('.')
    : label;
  const name = skeleton(plain);
  const tokens = name.split(/[-.]/);
  for (const brand of Object.keys(BRANDS)) {
    if (isOfficial(brand, domain)) continue;
    // Same first letter keeps real words out ("finance" is not a "binance" typo).
    const typo =
      name !== brand &&
      brand.length >= 6 &&
      name[0] === brand[0] &&
      editDistanceAtMostOne(name, brand);
    if (plain !== brand && (name === brand || typo)) {
      findings.push({
        id: 'lookalike',
        severity: 'medium',
        text: `Alan adı "${brand}" adına çok benziyor ama ${domain} resmi adresi değil.`,
      });
    } else if (name !== brand && tokens.includes(brand)) {
      findings.push({
        id: 'brand-in-name',
        severity: 'low',
        text: `Alan adı "${brand}" marka adını içeriyor; resmi adresi değil.`,
      });
    }
  }

  const sub = p.subdomain ? skeleton(p.subdomain).split(/[.-]/) : [];
  const inSub = Object.keys(BRANDS).find((b) => sub.includes(b) && !isOfficial(b, domain));
  if (inSub) {
    findings.push({
      id: 'brand-subdomain',
      severity: 'medium',
      text: `"${inSub}" yalnızca alt alan adında geçiyor; asıl site ${domain}.`,
    });
  }
  return findings;
}

const ORDER: RiskLevel[] = ['none', 'low', 'medium', 'high'];

export function assessRisk(
  url: string | null,
  page: { insecurePassword: boolean; bypassed: boolean },
): RiskReport {
  const findings = url ? analyzeUrl(url) : [];
  if (page.bypassed) {
    findings.unshift({
      id: 'warning-bypassed',
      severity: 'high',
      text: 'Bu site bir güvenlik listesinde; uyarıya rağmen açtınız.',
    });
  }
  if (page.insecurePassword) {
    findings.push({
      id: 'insecure-password',
      severity: 'medium',
      text: 'Sayfada şifre alanı var ama bağlantı şifrelenmemiş (http).',
    });
  }
  const level = findings.reduce<RiskLevel>(
    (worst, f) => (ORDER.indexOf(f.severity) > ORDER.indexOf(worst) ? f.severity : worst),
    'none',
  );
  return { level, findings };
}
