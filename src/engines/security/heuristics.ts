import { parse } from 'tldts';
import { L } from '../../shared/i18n.ts';

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
    | 'insecure-password'
    | 'password-elsewhere'
    | 'support-scam';
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
      text: L(
        `Adreste "@" öncesi kullanıcı bilgisi var; açılan site aslında ${host}.`,
        `The address has user info before "@"; the site that opens is really ${host}.`,
      ),
    });
  }
  if (isPublicIp(host)) {
    findings.push({
      id: 'ip-host',
      severity: 'low',
      text: L(
        'Site alan adı yerine doğrudan IP adresiyle açılmış.',
        'The site was opened by IP address instead of a domain name.',
      ),
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
        text: L(
          `"${decoded}" Latin harflerine benzeyen başka alfabe harfleri içeriyor (${ascii}).`,
          `"${decoded}" contains letters from another alphabet that look Latin (${ascii}).`,
        ),
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
        text: L(
          `Alan adı "${brand}" adına çok benziyor ama ${domain} resmi adresi değil.`,
          `The domain looks very much like "${brand}", but ${domain} is not its official address.`,
        ),
      });
    } else if (name !== brand && tokens.includes(brand)) {
      findings.push({
        id: 'brand-in-name',
        severity: 'low',
        text: L(
          `Alan adı "${brand}" marka adını içeriyor; resmi adresi değil.`,
          `The domain contains the brand name "${brand}"; it is not the official address.`,
        ),
      });
    }
  }

  const sub = p.subdomain ? skeleton(p.subdomain).split(/[.-]/) : [];
  const inSub = Object.keys(BRANDS).find((b) => sub.includes(b) && !isOfficial(b, domain));
  if (inSub) {
    findings.push({
      id: 'brand-subdomain',
      severity: 'medium',
      text: L(
        `"${inSub}" yalnızca alt alan adında geçiyor; asıl site ${domain}.`,
        `"${inSub}" appears only in a subdomain; the real site is ${domain}.`,
      ),
    });
  }
  return findings;
}

const ORDER: RiskLevel[] = ['none', 'low', 'medium', 'high'];

const SCAM_PHRASES = [
  /virus|malware|trojan|spyware|vir[uü]s|zararl[ıi] yaz[ıi]l[ıi]m/i,
  /(windows|microsoft|apple)\s*(defender|security|support|destek)/i,
  /(computer|pc|browser) (has been |is )?(blocked|locked|infected)|bilgisayar[ıi]n[ıi]z (engellendi|kilitlendi)/i,
  /call\s*(now|immediately|toll[- ]free|support)|hemen\s*aray[ıi]n|destek hatt[ıi]/i,
  /do not (close|restart|shut down)|kapatmay[ıi]n|yeniden ba[sş]latmay[ıi]n/i,
  /error\s*(code|#)\s*[:#]?\s*[0-9a-z]{3,}|hata kodu/i,
];
/** Toll-free and international support numbers as scam pages print them. */
const PHONE = /\+?\d[\d\s().-]{8,}\d/;

/**
 * A fake "your computer is infected, call this number" page: a phone number plus at least two
 * scam phrases. Text only; a real support page rarely talks about infections and blocked PCs.
 */
export function isSupportScam(text: string): boolean {
  if (!PHONE.test(text)) return false;
  let hits = 0;
  for (const phrase of SCAM_PHRASES) if (phrase.test(text) && ++hits >= 2) return true;
  return false;
}

/**
 * Host a password form on `pageUrl` sends to, when that is another site; null otherwise.
 * Phishing kits post stolen passwords to a server of their own.
 */
export function passwordTarget(pageUrl: string, action: string): string | null {
  let page: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(action, pageUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  const site = (h: string) => parse(h, { allowPrivateDomains: true }).domain ?? h;
  return site(target.hostname) === site(page.hostname) ? null : target.hostname;
}

export function assessRisk(
  url: string | null,
  page: {
    insecurePassword: boolean;
    bypassed: boolean;
    passwordTarget?: string | null;
    supportScam?: boolean;
  },
): RiskReport {
  const findings = url ? analyzeUrl(url) : [];
  if (page.bypassed) {
    findings.unshift({
      id: 'warning-bypassed',
      severity: 'high',
      text: L(
        'Bu site bir güvenlik listesinde; uyarıya rağmen açtınız.',
        'This site is on a security list; you opened it despite the warning.',
      ),
    });
  }
  if (page.insecurePassword) {
    findings.push({
      id: 'insecure-password',
      severity: 'medium',
      text: L(
        'Sayfada şifre alanı var ama bağlantı şifrelenmemiş (http).',
        'The page has a password field but the connection is not encrypted (http).',
      ),
    });
  }
  if (page.supportScam) {
    findings.unshift({
      id: 'support-scam',
      severity: 'high',
      text: L(
        'Sahte teknik destek uyarısı: bilgisayarınızda virüs olduğunu söyleyip telefon numarası veriyor. Numarayı aramayın, sekmeyi kapatın.',
        'Fake tech support alert: it claims your computer is infected and gives a phone number. Do not call it; close the tab.',
      ),
    });
  }
  if (page.passwordTarget) {
    findings.push({
      id: 'password-elsewhere',
      // Single sign-on also does this, so it is a reason to look, not a verdict.
      severity: 'low',
      text: L(
        `Bu sayfadaki şifre formu başka bir siteye gönderiliyor: ${page.passwordTarget}. Tanımadığınız bir adrese şifrenizi girmeyin.`,
        `The password form on this page sends to another site: ${page.passwordTarget}. Do not enter your password if you do not recognise it.`,
      ),
    });
  }
  const level = findings.reduce<RiskLevel>(
    (worst, f) => (ORDER.indexOf(f.severity) > ORDER.indexOf(worst) ? f.severity : worst),
    'none',
  );
  return { level, findings };
}
