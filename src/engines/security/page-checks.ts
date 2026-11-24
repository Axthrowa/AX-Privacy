// Checks that run on the page itself (content scripts): small on purpose, since every page loads
// them. The address checks with the big brand list live in heuristics.ts, in the background.

import { parse } from 'tldts';

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

/** Lower case, Turkish and other accents folded, so "Garanti BBVA Şube" reads "garanti bbva sube". */
const fold = (s: string) =>
  s.replace(/[İI]/g, 'i').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Brands a page names, as single words or two words written apart ("e-Devlet", "Garanti BBVA"). */
export function brandsNamed(text: string): string[] {
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const said = new Set(words);
  for (let i = 0; i + 1 < words.length; i++) said.add(`${words[i]}${words[i + 1]}`);
  return Object.keys(BRANDS).filter((b) => said.has(b));
}

/**
 * The brand a sign-in page claims to be (title, site name, logo) while its address is none of that
 * brand's domains; null when it names none or is one of them.
 */
export function loginBrandMismatch(pageUrl: string, text: string): string | null {
  let host: string;
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    return null;
  }
  const domain = parse(host, { allowPrivateDomains: true }).domain ?? host;
  const named = brandsNamed(text);
  // A real site of any brand it names (google.com saying "Google, YouTube") is fine.
  if (named.some((b) => BRANDS[b]?.includes(domain))) return null;
  return named[0] ?? null;
}
