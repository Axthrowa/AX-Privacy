import { parse } from 'tldts';
import { L } from '../../shared/i18n.ts';
import POPULAR_LIST from './brands.json' with { type: 'json' };
import { govClaim, officialGov } from './official.ts';
import { BRANDS } from './page-checks.ts';

export { BRANDS, isSupportScam, passwordTarget } from './page-checks.ts';
export { officialGov } from './official.ts';

export type Severity = 'high' | 'medium' | 'low';
export type RiskLevel = Severity | 'none';

export interface Finding {
  id:
    | 'warning-bypassed'
    | 'homograph'
    | 'fake-gov'
    | 'lookalike'
    | 'lookalike-popular'
    | 'login-brand'
    | 'brand-subdomain'
    | 'brand-in-name'
    | 'userinfo'
    | 'ip-host'
    | 'insecure-password'
    | 'password-elsewhere'
    | 'support-scam'
    | 'miner-stopped'
    | 'miner-suspected';
  severity: Severity;
  text: string;
}

export interface RiskReport {
  /** Worst finding; 'none' means nothing was found, not that the site is safe. */
  level: RiskLevel;
  findings: Finding[];
  /** Government zone or domain of an official site ("gov.tr"); null for every other site. */
  official: string | null;
}

/** Signs of a fake site strong enough to stop a sign-in until the user says otherwise. */
const LOGIN_BLOCKERS: ReadonlySet<Finding['id']> = new Set([
  'warning-bypassed',
  'homograph',
  'fake-gov',
  'lookalike',
  'login-brand',
  'brand-subdomain',
  'userinfo',
  'support-scam',
]);

/** Findings that should keep the user from typing a password on the page. */
export const loginBlockers = (r: RiskReport): Finding[] =>
  r.findings.filter((f) => LOGIN_BLOCKERS.has(f.id));

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

/** Edit distance of a and b, or max + 1 once it is known to be larger. */
export function editDistanceWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * About 5,000 widely used sites (scripts/brands.ts) with their real domains, by name length. A new
 * domain one or two letters away from one of them is a common phishing trick.
 */
const POPULAR = new Map<string, readonly string[]>(POPULAR_LIST as [string, string[]][]);
const POPULAR_BY_LENGTH = new Map<number, string[]>();
for (const label of POPULAR.keys()) {
  const list = POPULAR_BY_LENGTH.get(label.length) ?? [];
  list.push(label);
  POPULAR_BY_LENGTH.set(label.length, list);
}

/** Two edits only for longer names: short ones are two letters from many real words. */
const allowedEdits = (length: number) => (length >= 9 ? 2 : 1);

/** The popular site `name` imitates, or null. Known sites never imitate each other. */
export function popularLookalike(name: string, domain: string): string | null {
  if (name.length < 6 || POPULAR.has(name) || name in BRANDS) return null;
  const max = allowedEdits(name.length);
  for (let len = name.length - max; len <= name.length + max; len++) {
    for (const brand of POPULAR_BY_LENGTH.get(len) ?? []) {
      // Same first letter keeps real words out, as for the hand-picked brands.
      if (brand[0] !== name[0] || POPULAR.get(brand)?.includes(domain)) continue;
      const bound = Math.min(max, allowedEdits(brand.length));
      if (editDistanceWithin(name, brand, bound) <= bound) {
        return brand;
      }
    }
  }
  return null;
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

  // Government zones are closed registries: the address cannot imitate anyone.
  if (officialGov(host)) return findings;

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
  const gov = govClaim(skeleton(host));
  if (gov) {
    findings.push({
      id: 'fake-gov',
      severity: 'high',
      text: L(
        `Adres kendini devlet sitesi gibi gösteriyor ("${gov}") ama ${domain} bir devlet alan adı değil. Resmi devlet siteleri gov.tr gibi yalnız devletin alabildiği uzantılarda olur. Kimlik, şifre veya kart bilgisi girmeyin.`,
        `The address presents itself as a government site ("${gov}"), but ${domain} is not a government domain. Official government sites use zones only a government can register, such as gov.uk or gov.tr. Do not enter your ID, password or card details.`,
      ),
    });
  }
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

  if (!findings.some((f) => f.id === 'lookalike' || f.id === 'brand-in-name')) {
    const like = popularLookalike(name, domain);
    if (like) {
      findings.push({
        id: 'lookalike-popular',
        // Thousands of names: a near miss is a reason to check the address, not a verdict.
        severity: 'low',
        text: L(
          `Alan adı yaygın bir siteye ("${like}") çok benziyor; doğru adreste olduğunuzdan emin olun.`,
          `The domain looks very much like a popular site ("${like}"); make sure you are on the right address.`,
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

export function assessRisk(
  url: string | null,
  page: {
    insecurePassword: boolean;
    bypassed: boolean;
    passwordTarget?: string | null;
    supportScam?: boolean;
    miner?: 'stopped' | 'seen' | null;
    loginBrand?: string | null;
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
  if (page.loginBrand) {
    findings.unshift({
      id: 'login-brand',
      severity: 'high',
      text: L(
        `Bu giriş sayfası kendini "${page.loginBrand}" olarak tanıtıyor ama adresi onun sitelerinden biri değil. Şifrenizi girmeyin.`,
        `This sign-in page presents itself as "${page.loginBrand}", but its address is none of that brand's sites. Do not enter your password.`,
      ),
    });
  }
  if (page.miner === 'stopped') {
    findings.push({
      id: 'miner-stopped',
      severity: 'high',
      text: L(
        'Bu sayfa işlemcinizle kripto para kazıyordu; AX Privacy kazıyıcıyı durdurdu.',
        'This page was mining cryptocurrency with your processor; AX Privacy stopped the miner.',
      ),
    });
  } else if (page.miner === 'seen') {
    findings.push({
      id: 'miner-suspected',
      // Video editors and games also run a worker per core with WebAssembly.
      severity: 'low',
      text: L(
        'Bu sayfa her işlemci çekirdeğinde bir iş parçacığı ve WebAssembly çalıştırıyor. Video düzenleyici ya da oyun değilse kripto kazıyor olabilir; fan sesi artıyorsa sekmeyi kapatın.',
        'This page runs a worker on every processor core with WebAssembly. Unless it is a video editor or a game, it may be mining cryptocurrency; close the tab if your fan speeds up.',
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
  const host = url ? safeHost(url) : null;
  return { level, findings, official: host ? officialGov(host) : null };
}

/** Over plain http the page may not come from the official server, so it is not called official. */
function safeHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}
