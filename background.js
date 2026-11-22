/**
 * AX-Privacy Background Service Worker (Manifest V3 - v2.1.0)
 * Features:
 *   - Native Chrome DNR Action Count Badge (tab-specific live network blocked counter)
 *   - Local Threat Analysis Engine with RFC 3492 Punycode decoder (Turkish domain false-positive immunity)
 *   - Full frame & subresource dynamic whitelisting via allowAllRequests (priority: 1000)
 *   - Persistent session alerting state in chrome.storage.session (survives Service Worker sleep/restart)
 *   - Zero-leak local security alerting with strict error handling
 */

const DEFAULT_SETTINGS = {
  adBlock: true,
  urlClean: true,
  cosmeticFilter: true,
  threatShield: true,
  twitchShield: true,
  twitchProxyUrl: '',
  youtubeShield: true,
  popupShield: true,
  whitelist: [],
  customFilterLists: [],
  filterUpdateStatus: {
    lastUpdated: null,
    totalRules: 0,
    status: 'idle',
    lastError: null
  },
  totalBlocked: 0
};

// In-memory threat map: tabId -> threat object
const tabThreats = new Map();

/**
 * chrome.storage.session Helpers for alerted tabs persistence across Service Worker restarts
 */
async function getAlertedTabs() {
  try {
    const data = await chrome.storage.session.get('alertedTabs');
    return Array.isArray(data.alertedTabs) ? data.alertedTabs : [];
  } catch (err) {
    console.warn('[AX-Privacy background] getAlertedTabs error:', err);
    return [];
  }
}

async function markTabAlerted(tabId) {
  try {
    const list = await getAlertedTabs();
    if (!list.includes(tabId)) {
      list.push(tabId);
      await chrome.storage.session.set({ alertedTabs: list });
    }
  } catch (err) {
    console.warn('[AX-Privacy background] markTabAlerted error:', err);
  }
}

async function clearTabAlerted(tabId) {
  try {
    const list = await getAlertedTabs();
    const idx = list.indexOf(tabId);
    if (idx !== -1) {
      list.splice(idx, 1);
      await chrome.storage.session.set({ alertedTabs: list });
    }
  } catch (err) {
    console.warn('[AX-Privacy background] clearTabAlerted error:', err);
  }
}

const tabBlockedCounts = new Map();

function formatBadgeCount(count) {
  if (!count || count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

async function updateTabBadge(tabId) {
  if (!tabId || typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
  try {
    const isAlerted = (await getAlertedTabs()).includes(tabId);
    if (isAlerted) return; // '!' threat alert has absolute precedence

    const count = tabBlockedCounts.get(tabId) || 0;
    const text = formatBadgeCount(count);
    await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0284c7' }).catch(() => {});
  } catch {}
}

async function resetTabBadgeToDefault(tabId) {
  if (!tabId || typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
  try {
    const isAlerted = (await getAlertedTabs()).includes(tabId);
    if (isAlerted) return;

    const count = tabBlockedCounts.get(tabId) || 0;
    const text = formatBadgeCount(count);
    await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0284c7' }).catch(() => {});
  } catch (err) {
    console.warn('[AX-Privacy background] resetTabBadgeToDefault error:', err);
  }
}

async function clearAllAlertedTabs() {
  try {
    const list = await getAlertedTabs();
    for (const tabId of list) {
      await resetTabBadgeToDefault(tabId);
    }
    await chrome.storage.session.remove('alertedTabs');
  } catch (err) {
    console.warn('[AX-Privacy background] clearAllAlertedTabs error:', err);
  }
}

/**
 * Lightweight RFC 3492 Punycode Decoder (Zero External Dependencies)
 */
function decodePunycodeLabel(input) {
  const base = 36;
  const tmin = 1;
  const tmax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128;

  function adapt(delta, numpoints, firsttime) {
    let k = 0;
    delta = firsttime ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numpoints);
    while (delta > ((base - tmin) * tmax) >> 1) {
      delta = Math.floor(delta / (base - tmin));
      k += base;
    }
    return k + Math.floor(((base - tmin + 1) * delta) / (delta + skew));
  }

  const output = [];
  let n = initialN;
  let i = 0;
  let bias = initialBias;

  let basic = input.lastIndexOf('-');
  if (basic > 0) {
    for (let j = 0; j < basic; ++j) {
      output.push(input.charCodeAt(j));
    }
  } else {
    basic = 0;
  }

  let index = basic > 0 ? basic + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (index >= input.length) return null;
      const c = input.charCodeAt(index++);
      let digit;
      if (c >= 48 && c <= 57) digit = c - 22; // 0-9 -> 26-35
      else if (c >= 65 && c <= 90) digit = c - 65; // A-Z -> 0-25
      else if (c >= 97 && c <= 122) digit = c - 97; // a-z -> 0-25
      else return null;

      i += digit * w;
      const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, n);
    i++;
  }

  return String.fromCodePoint(...output);
}

/**
 * Decodes all xn-- labels in a hostname to Unicode
 */
function decodeHostname(hostname) {
  if (!hostname || !hostname.includes('xn--')) return hostname;
  return hostname
    .split('.')
    .map((part) => {
      if (part.toLowerCase().startsWith('xn--')) {
        const decoded = decodePunycodeLabel(part.slice(4));
        return decoded || part;
      }
      return part;
    })
    .join('.');
}

/**
 * Initializes extension badge settings with capped formatting and default styling
 */
async function initActionOptions() {
  if (typeof chrome === 'undefined') return;
  try {
    if (chrome.declarativeNetRequest?.setExtensionActionOptions) {
      // Strictly disable native unthrottled DNR counter to prevent runaway 10000+ badge numbers
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: false
      });
    }
    if (chrome.action?.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: '#0284c7' });
    }
    if (chrome.action?.setBadgeText) {
      await chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }
    if (chrome.tabs?.query) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          await resetTabBadgeToDefault(tab.id);
        }
      }
    }
  } catch (err) {
    console.warn('[AX-Privacy background] initActionOptions error:', err);
  }
}

// Immediately enforce action badge settings upon service worker spin-up
if (typeof chrome !== 'undefined') {
  initActionOptions().catch(() => {});
}

/**
 * Synchronize static DNR rulesets based on user settings
 */
async function syncRulesets() {
  try {
    const data = await chrome.storage.local.get(['adBlock', 'urlClean', 'popupShield']);
    const adBlock = data.adBlock !== undefined ? data.adBlock : true;
    const urlClean = data.urlClean !== undefined ? data.urlClean : true;
    const popupShield = data.popupShield !== undefined ? data.popupShield : true;

    const enableRulesetIds = [];
    const disableRulesetIds = [];

    if (adBlock) {
      enableRulesetIds.push('ruleset_ads');
    } else {
      disableRulesetIds.push('ruleset_ads');
    }

    if (urlClean) {
      enableRulesetIds.push('ruleset_url_clean');
    } else {
      disableRulesetIds.push('ruleset_url_clean');
    }

    if (popupShield) {
      enableRulesetIds.push('ruleset_popups');
    } else {
      disableRulesetIds.push('ruleset_popups');
    }

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds
    });
    await syncYouTubeRules();
  } catch (err) {
    console.error('[AX-Privacy background] syncRulesets error:', err);
  }
}

/**
 * Synchronize dynamic rules for YouTube infrastructure exemption (priority: 1000)
 * Ensures DNR static/dynamic block rules never block YouTube's main UI, player, or streaming endpoints.
 * Range: IDs 4001..4010
 */
async function syncYouTubeRules() {
  try {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateDynamicRules) {
      return;
    }
    const { youtubeShield = true } = await chrome.storage.local.get('youtubeShield');
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingYouTubeRuleIds = existingRules
      .filter((r) => r.id >= 4000 && r.id < 5000)
      .map((r) => r.id);

    const newRules = [];
    if (youtubeShield) {
      newRules.push({
        id: 4001,
        priority: 1000,
        action: {
          type: 'allow'
        },
        condition: {
          requestDomains: [
            'youtube.com',
            'googlevideo.com',
            'ytimg.com',
            'ggpht.com',
            'youtubei.googleapis.com'
          ]
        }
      });
      newRules.push({
        id: 4002,
        priority: 1000,
        action: {
          type: 'allow'
        },
        condition: {
          initiatorDomains: ['youtube.com'],
          requestDomains: [
            'youtube.com',
            'googlevideo.com',
            'ytimg.com',
            'ggpht.com',
            'youtubei.googleapis.com'
          ]
        }
      });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingYouTubeRuleIds,
      addRules: newRules
    });
  } catch (err) {
    console.error('[AX-Privacy background] syncYouTubeRules error:', err);
  }
}

/**
 * Synchronize dynamic whitelist rules using allowAllRequests (priority: 1000)
 * Completely allows all subsequent sub-frames and embedded third-party requests on whitelisted domains.
 */
async function syncWhitelistRules(whitelist) {
  try {
    const list = whitelist || (await chrome.storage.local.get('whitelist')).whitelist || [];
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    // Strict ID Isolation: Only remove and modify Whitelist rules in 5000..9999 range
    const existingRuleIds = existingRules
      .filter((r) => r.id >= 5000 && r.id < 10000)
      .map((r) => r.id);

    const newRules = [];
    list.forEach((domain, index) => {
      const clean = domain.trim().toLowerCase();
      if (!clean) return;

      newRules.push({
        id: 5000 + index,
        priority: 1000,
        action: {
          type: 'allowAllRequests'
        },
        condition: {
          requestDomains: [clean],
          resourceTypes: ['main_frame']
        }
      });
    });

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: newRules
    });
  } catch (err) {
    console.error('[AX-Privacy background] syncWhitelistRules error:', err);
  }
}

/**
 * Toggle whitelist for a specific domain
 */
async function toggleDomainWhitelist(domain) {
  const clean = domain.trim().toLowerCase();
  const { whitelist = [] } = await chrome.storage.local.get('whitelist');
  const index = whitelist.indexOf(clean);
  let isWhitelistedNow = false;

  if (index === -1) {
    whitelist.push(clean);
    isWhitelistedNow = true;
  } else {
    whitelist.splice(index, 1);
    isWhitelistedNow = false;
  }

  await chrome.storage.local.set({ whitelist });
  await syncWhitelistRules(whitelist);
  return isWhitelistedNow;
}

/**
 * Multi-Format Filter Parser & Priority Delta Engine (v2.5.0)
 * Supports:
 *   1. Adblock Plus / uBO: ||ads.example.com^ (skips @@, ##, #@#, $document, $popup)
 *   2. Hosts format: 0.0.0.0 ads.example.com / 127.0.0.1 ads.example.com
 *   3. Plain domain lists: ads.example.com
 */
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IP_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const EXCLUDED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'localdomain',
  'lan',
  'home.arpa',
  '0.0.0.0',
  '127.0.0.1',
  'example.com',
  'example.org',
  'example.net'
]);

const MAX_FILTER_BYTES = 15 * 1024 * 1024; // 15 MB threshold
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

const DEFAULT_LIVE_SOURCES = [
  {
    id: 'builtin_easylist',
    name: 'EasyList',
    url: 'https://v.firebog.net/hosts/Easylist.txt'
  },
  {
    id: 'builtin_easyprivacy',
    name: 'EasyPrivacy',
    url: 'https://v.firebog.net/hosts/Easyprivacy.txt'
  },
  {
    id: 'builtin_adguard_turkish',
    name: 'AdGuard Turkish',
    url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_13_Turkish/filter.txt'
  }
];

const PROTECTED_INFRASTRUCTURE = [
  'twimg.com',
  'twitter.com',
  'x.com',
  't.co',
  'instagram.com',
  'cdninstagram.com',
  'facebook.com',
  'fbcdn.net',
  'youtube.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
  'youtubei.googleapis.com',
  'storage.googleapis.com',
  'googleusercontent.com',
  'blogger.googleusercontent.com',
  'gstatic.com',
  'cloudflare.com',
  'cloudflare.net',
  'jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'wp.com',
  'wordpress.com',
  'discord.com',
  'discordapp.com',
  'github.com',
  'githubusercontent.com',
  'githubassets.com',
  'apple.com',
  'icloud.com',
  'microsoft.com',
  'azureedge.net',
  // Major Turkish & Global E-Commerce & Comparison Platforms
  'akakce.com',
  'cimri.com',
  'hepsiburada.com',
  'trendyol.com',
  'n11.com',
  'pazarama.com',
  'sahibinden.com',
  'gittigidiyor.com',
  'amazon.com.tr',
  'amazon.com',
  'ebay.com',
  'aliexpress.com',
  'yemeksepeti.com',
  'getir.com',
  'migros.com.tr',
  'carrefoursa.com',
  'sokmarket.com.tr',
  'a101.com.tr',
  'bim.com.tr',
  // Turkish News, Media, Forum & Community Platforms
  'donanimhaber.com',
  'eksisozluk.com',
  'technopat.net',
  'webtekno.com',
  'shiftdelete.net',
  'onedio.com',
  'kizlarsoruyor.com',
  'memurlar.net',
  'hurriyet.com.tr',
  'milliyet.com.tr',
  'sozcu.com.tr',
  'haberturk.com',
  'cumhuriyet.com.tr',
  'sabah.com.tr',
  'ensonhaber.com',
  'ntv.com.tr',
  'cnnturk.com',
  'trthaber.com',
  'aa.com.tr',
  // Video & Streaming Publishers
  'dizibox.live',
  'dizibox.tv',
  'dizigom.tv',
  // Turkish Government & E-Services
  'turkiye.gov.tr',
  'enabiz.gov.tr',
  'meb.gov.tr',
  'gib.gov.tr',
  'osym.gov.tr',
  'yok.gov.tr',
  // Turkish Banks & Payment Systems
  'bkm.com.tr',
  'bkmexpress.com.tr',
  'iyzico.com',
  'paytr.com',
  'garantibbva.com.tr',
  'isbank.com.tr',
  'akbank.com',
  'yapikredi.com.tr',
  'ziraatbank.com.tr',
  'halkbank.com.tr',
  'vakifbank.com.tr',
  'qnbfinansbank.com',
  'enpara.com',
  'papara.com',
  'param.com.tr',
  'teb.com.tr',
  'denizbank.com',
  'kuveytturk.com.tr',
  'albaraka.com.tr',
  'turkiyefinans.com.tr'
];

function parseFilterLine(line) {
  if (!line || typeof line !== 'string') return null;
  let d = line.trim();
  if (!d) return null;

  // Skip comments and metadata
  if (d.startsWith('!') || d.startsWith('#') || d.startsWith('[') || d.startsWith(';')) {
    return null;
  }

  // Skip exception rules (starts with @@)
  if (d.startsWith('@@')) {
    return null;
  }

  // Skip cosmetic and element hiding rules (##, #@#, #?#)
  if (d.includes('##') || d.includes('#@#') || d.includes('#?#')) {
    return null;
  }

  // Skip page-breaking directives ($document, $popup, $csp, $badfilter)
  if (/\$(?:document|popup|csp|badfilter)\b/i.test(d)) {
    return null;
  }

  // Hosts format: "0.0.0.0 domain" or "127.0.0.1 domain"
  const hostsMatch = d.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([^\s#]+)/);
  if (hostsMatch) {
    d = hostsMatch[1];
  }

  // ABP filter format: "||domain.com^" or "||domain.com^$third-party"
  if (d.startsWith('||')) {
    d = d.slice(2);
    const caretIdx = d.indexOf('^');
    const slashIdx = d.indexOf('/');
    // CRITICAL: If there is a slash before caret, or a slash with no caret,
    // this is a URL path rule (e.g. "||dizibox.live/r/", "||airlinehaber.com/storage/*/*.gif").
    // Stripping the path turns legitimate publisher websites into blocked ad networks!
    // Path rules MUST NEVER be converted to domain-level blocks.
    if (slashIdx !== -1 && (caretIdx === -1 || slashIdx < caretIdx)) {
      return null;
    }
    if (caretIdx !== -1) {
      d = d.slice(0, caretIdx);
    }
  }

  // Strip trailing paths, $ options, and trailing dots
  d = d.replace(/[/:^$].*$/, '').replace(/\.+$/, '').trim().toLowerCase();

  // Strip port if present
  d = d.replace(/:\d+$/, '');

  if (d.length < 3 || d.length > 253) return null;
  if (IP_REGEX.test(d)) return null;
  if (EXCLUDED_HOSTS.has(d)) return null;
  if (!DOMAIN_REGEX.test(d)) return null;

  // Critical Web Infrastructure & Essential Platform Exemptions:
  // Never block essential CDNs, media endpoints, fonts, or social infrastructure
  if (PROTECTED_INFRASTRUCTURE.some((p) => d === p || d.endsWith('.' + p))) {
    return null;
  }

  return d;
}

function parseFilterContent(content) {
  const domains = new Set();
  if (!content || typeof content !== 'string') return domains;

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const d = parseFilterLine(lines[i]);
    if (d) {
      domains.add(d);
    }
  }
  return domains;
}

function validateCustomFilterUrl(rawUrl, existingLists = []) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'Lütfen geçerli bir filtre listesi URL\'si giriniz.' };
  }
  const trimmed = rawUrl.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Geçersiz URL formatı. Lütfen tam bir web adresi giriniz.' };
  }

  if (parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Güvenlik nedeniyle yalnızca https:// protokolüne sahip filtre listeleri kabul edilir (http, file, javascript ve data protokolleri engellenmiştir).'
    };
  }

  // Normalize URL for duplicate checking
  const normalized = (parsedUrl.origin + parsedUrl.pathname).toLowerCase().replace(/\/+$/, '') + parsedUrl.search;

  const isDuplicate = existingLists.some((item) => {
    try {
      const itemUrl = new URL(item.url);
      const itemNormalized = (itemUrl.origin + itemUrl.pathname).toLowerCase().replace(/\/+$/, '') + itemUrl.search;
      return itemNormalized === normalized;
    } catch {
      return item.url === trimmed;
    }
  });

  if (isDuplicate) {
    return { valid: false, error: 'Bu filtre listesi URL\'si zaten ekli.' };
  }

  if (existingLists.length >= 10) {
    return { valid: false, error: 'En fazla 10 adet özel filtre listesi ekleyebilirsiniz.' };
  }

  return { valid: true, url: trimmed, normalized };
}

function deriveFilterListName(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      let lastSegment = segments[segments.length - 1];
      lastSegment = lastSegment.replace(/\.(txt|list|filter|filters|rules|hosts)$/i, '');
      if (lastSegment.length > 0) {
        return lastSegment.slice(0, 30);
      }
    }
    return parsed.hostname.replace(/^www\./i, '').slice(0, 30);
  } catch {
    return 'Özel Liste';
  }
}

async function fetchFilterListWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/plain, text/*, */*'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_FILTER_BYTES) {
      throw new Error('Liste boyutu çok büyük (>15 MB)');
    }

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      let totalBytes = 0;
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_FILTER_BYTES) {
          controller.abort();
          throw new Error('Liste boyutu çok büyük (>15 MB)');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } else {
      const text = await res.text();
      if (text.length > MAX_FILTER_BYTES) {
        throw new Error('Liste boyutu çok büyük (>15 MB)');
      }
      return text;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('İndirme zaman aşımına uğradı (15s)');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

let staticDomainsCache = null;

async function getStaticDomains() {
  if (staticDomainsCache && staticDomainsCache.size > 0) {
    return staticDomainsCache;
  }

  const set = new Set();
  try {
    let text = null;
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      const url = chrome.runtime.getURL('rules/ads_trackers.json');
      const res = await fetch(url);
      if (res.ok) {
        text = await res.text();
      }
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const filePath = path.resolve(process.cwd(), 'rules', 'ads_trackers.json');
      text = await fs.readFile(filePath, 'utf8').catch(() => null);
    }

    if (text) {
      const rules = JSON.parse(text);
      for (let i = 0; i < rules.length; i++) {
        const uf = rules[i]?.condition?.urlFilter;
        if (uf && uf.startsWith('||')) {
          const dom = uf.slice(2).replace(/\^.*$/, '').toLowerCase();
          if (dom) set.add(dom);
        }
      }
    }
  } catch (err) {
    console.warn('[AX-Privacy background] getStaticDomains warning:', err?.message);
  }
  staticDomainsCache = set;
  return set;
}

let cosmeticRulesCache = null;

async function getCosmeticRules() {
  if (cosmeticRulesCache && Object.keys(cosmeticRulesCache).length > 0) {
    return cosmeticRulesCache;
  }

  try {
    let text = null;
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      const url = chrome.runtime.getURL('rules/cosmetic_rules.json');
      const res = await fetch(url);
      if (res.ok) text = await res.text();
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const filePath = path.resolve(process.cwd(), 'rules', 'cosmetic_rules.json');
      text = await fs.readFile(filePath, 'utf8').catch(() => null);
    }
    if (text) {
      cosmeticRulesCache = JSON.parse(text);
    }
  } catch (err) {
    console.warn('[AX-Privacy background] getCosmeticRules warning:', err?.message);
  }
  return cosmeticRulesCache || {};
}

/**
 * Priority Delta Engine for DNR Dynamic Rules
 * Deduplicates against static rules (rules/ads_trackers.json).
 * Prioritizes custom active lists before EasyList / EasyPrivacy.
 * Generates rule IDs strictly >= 10000.
 */
function allocateDynamicRules({
  customLists = [],
  customListParsedMap = new Map(),
  defaultSourcesParsed = [],
  staticDomains = new Set(),
  maxQuota = 29000
}) {
  const addedDomains = new Set();
  const listRuleCounts = new Map();

  // 1. Prioritize Enabled Custom Lists
  for (const list of customLists) {
    if (!list.enabled) {
      listRuleCounts.set(list.id, 0);
      continue;
    }
    const domains = customListParsedMap.get(list.id) || [];
    let count = 0;
    for (const dom of domains) {
      if (!staticDomains.has(dom) && !addedDomains.has(dom)) {
        if (addedDomains.size < maxQuota) {
          addedDomains.add(dom);
          count++;
        }
      }
    }
    listRuleCounts.set(list.id, count);
  }

  // 2. Remaining quota goes to Default Live Sources (EasyList & EasyPrivacy)
  for (const dom of defaultSourcesParsed) {
    if (addedDomains.size >= maxQuota) break;
    if (!staticDomains.has(dom) && !addedDomains.has(dom)) {
      addedDomains.add(dom);
    }
  }

  // 3. Compile DNR dynamic rules with IDs strictly >= 10000
  const rules = [];
  let ruleId = 10000;
  for (const dom of addedDomains) {
    rules.push({
      id: ruleId++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: `||${dom}^`,
        resourceTypes: ['script', 'image', 'sub_frame', 'xmlhttprequest', 'ping']
      }
    });
  }

  return {
    rules,
    listRuleCounts,
    totalRules: rules.length,
    totalDomains: addedDomains.size
  };
}

let isUpdatingFilters = false;

async function updateAllFilterLists() {
  if (isUpdatingFilters) {
    console.log('[AX-Privacy background] Filter update already in progress');
    return { inProgress: true };
  }
  isUpdatingFilters = true;

  try {
    const data = await chrome.storage.local.get(['customFilterLists', 'filterUpdateStatus']);
    const customLists = Array.isArray(data.customFilterLists)
      ? data.customFilterLists.map((l) => ({ ...l }))
      : [];

    const staticDomains = await getStaticDomains();
    const dynamicCapacity = (typeof chrome !== 'undefined' && chrome.declarativeNetRequest?.MAX_NUMBER_OF_DYNAMIC_RULES)
      ? Math.max(1000, chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES - 1000)
      : 29000;

    const customListParsedMap = new Map();

    // 1. Download & parse each custom list with partial error resilience
    for (const item of customLists) {
      if (!item.enabled) {
        item.lastStatus = 'idle';
        item.lastError = null;
        customListParsedMap.set(item.id, []);
        continue;
      }

      try {
        const text = await fetchFilterListWithTimeout(item.url);
        const parsedSet = parseFilterContent(text);
        item.lastStatus = 'ok';
        item.lastError = null;
        customListParsedMap.set(item.id, Array.from(parsedSet));
      } catch (err) {
        console.warn(`[AX-Privacy background] Custom list failed: ${item.name} (${item.url}) - ${err.message}`);
        item.lastStatus = 'error';
        item.lastError = err.message || 'İndirme hatası';
        customListParsedMap.set(item.id, []);
      }
    }

    // 2. Fetch default live sources (EasyList & EasyPrivacy)
    const defaultSourcesParsed = [];
    for (const source of DEFAULT_LIVE_SOURCES) {
      try {
        const text = await fetchFilterListWithTimeout(source.url);
        const parsedSet = parseFilterContent(text);
        for (const dom of parsedSet) {
          defaultSourcesParsed.push(dom);
        }
      } catch (err) {
        console.warn(`[AX-Privacy background] Default source ${source.name} failed:`, err.message);
      }
    }

    // 3. Allocate dynamic rules with custom lists prioritized
    const allocation = allocateDynamicRules({
      customLists,
      customListParsedMap,
      defaultSourcesParsed,
      staticDomains,
      maxQuota: dynamicCapacity
    });

    // Update rule counts on custom list objects
    for (const item of customLists) {
      if (item.enabled) {
        item.ruleCount = allocation.listRuleCounts.get(item.id) || 0;
      } else {
        item.ruleCount = 0;
      }
    }

    // 4. Update DeclarativeNetRequest dynamic rules (strictly ID >= 10000)
    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest?.updateDynamicRules) {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules
        .filter((r) => r.id >= 10000)
        .map((r) => r.id);

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: allocation.rules
      });
    }

    const newStatus = {
      lastUpdated: Date.now(),
      totalRules: allocation.totalRules,
      status: 'ok',
      lastError: null
    };

    await chrome.storage.local.set({
      customFilterLists: customLists,
      filterUpdateStatus: newStatus
    });

    return {
      success: true,
      customFilterLists: customLists,
      filterUpdateStatus: newStatus,
      totalRules: allocation.totalRules
    };
  } catch (err) {
    console.error('[AX-Privacy background] updateAllFilterLists critical error:', err);
    const newStatus = {
      lastUpdated: Date.now(),
      totalRules: 0,
      status: 'error',
      lastError: err.message
    };
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      await chrome.storage.local.set({ filterUpdateStatus: newStatus }).catch(() => {});
    }
    return { success: false, error: err.message };
  } finally {
    isUpdatingFilters = false;
  }
}

/**
 * Local threat analysis engine (100% on-device, zero external telemetry)
 * Accurately handles Turkish Punycode domains and flags real mixed-script homographs.
 */
function evaluateUrlThreat(urlString) {
  if (!urlString) return { level: 'safe', threat: null };

  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { level: 'safe', threat: null };
  }

  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();

  // Internal schemes
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { level: 'safe', threat: null, isSystem: true, domain: hostname };
  }

  // Localhost / private addresses are safe
  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost');

  // 1. Unencrypted HTTP connection (except localhost) -> warning
  if (protocol === 'http:' && !isLocalhost) {
    return {
      level: 'warning',
      type: 'insecure_http',
      title: 'Güvensiz Bağlantı (HTTP)',
      message:
        'Bu site şifrelenmemiş HTTP bağlantısı kullanıyor. İletilen kişisel veriler ve parolalar ağdaki üçüncü şahıslar tarafından izlenebilir.',
      domain: hostname
    };
  }

  // 2. Punycode / Homograph (xn--) Analysis
  if (hostname.includes('xn--')) {
    const decodedHost = decodeHostname(hostname);

    // Standard ASCII + Turkish Latin characters
    const TURKISH_ASCII_REGEX = /^[a-zA-Z0-9\-\.çÇğĞıIİiöÖşŞüÜâÂîÎûÛ]+$/;
    if (TURKISH_ASCII_REGEX.test(decodedHost)) {
      // 100% legitimate Turkish or standard ASCII domain -> SAFE, no warning
    } else {
      // Check for mixed-script attacks (e.g., Latin mixed with Cyrillic or Greek)
      const hasLatin = /[a-zA-Z]/.test(decodedHost);
      const hasCyrillicOrGreek = /[\u0400-\u04FF\u0370-\u03FF]/.test(decodedHost);

      if (hasLatin && hasCyrillicOrGreek) {
        return {
          level: 'danger',
          type: 'homograph_punycode',
          title: 'Homograf / Taklit Alan Adı Tehdidi',
          message: `Bu alan adı güvenilir siteleri taklit etmek amacıyla Latin ve Kiril/Yunan harflerini karıştıran sahte bir alfabe tekniği kullanıyor (${decodedHost}). Şifre veya kart bilgilerinizi girmeyiniz.`,
          domain: hostname
        };
      }

      // Other international IDN domains (non-mixed, non-Turkish) -> warning level
      return {
        level: 'warning',
        type: 'international_idn',
        title: 'Uluslararası Alan Adı (IDN)',
        message: `Bu web sitesi uluslararası karakterli bir alan adı kullanmaktadır (${decodedHost}). Ziyaret etmek istediğiniz doğru site olduğundan emin olunuz.`,
        domain: hostname
      };
    }
  }

  // 3. Excessive subdomains or phishing patterns -> danger
  const isRawIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
  if (isRawIp && !isLocalhost) {
    return {
      level: 'danger',
      type: 'raw_ip_access',
      title: 'Doğrudan IP Adresi ile Erişim',
      message:
        'Bu web sitesine alan adı yerine doğrudan IP adresi üzerinden bağlanılıyor. Güvenilir olmayan sunucu veya oltalama altyapısı olabilir.',
      domain: hostname
    };
  }

  const labels = hostname.split('.');
  if (labels.length > 4) {
    return {
      level: 'danger',
      type: 'excessive_subdomains',
      title: 'Aşırı Alt Alan Adı Seviyesi',
      message:
        'Bu web sitesi olağandışı sayıda alt alan adı katmanına sahip. Oltalama (phishing) amacıyla yapılandırılmış alan adlarında sık görülür.',
      domain: hostname
    };
  }

  // Phishing brand spoofing detection in subdomains
  const suspiciousKeywords = [
    'login',
    'verify',
    'verification',
    'secure',
    'security',
    'account',
    'banking',
    'update',
    'auth',
    'signin',
    'support',
    'portal'
  ];
  const targetBrands = [
    'paypal',
    'google',
    'apple',
    'netflix',
    'microsoft',
    'binance',
    'amazon',
    'garanti',
    'ziraat',
    'akbank',
    'isbank',
    'yapikredi'
  ];

  for (const brand of targetBrands) {
    if (hostname.includes(brand)) {
      const isOfficial =
        hostname === `${brand}.com` ||
        hostname.endsWith(`.${brand}.com`) ||
        hostname === `${brand}.com.tr` ||
        hostname.endsWith(`.${brand}.com.tr`) ||
        hostname === `${brand}.net` ||
        hostname.endsWith(`.${brand}.net`);

      if (!isOfficial) {
        for (const kw of suspiciousKeywords) {
          if (hostname.includes(kw)) {
            return {
              level: 'danger',
              type: 'phishing_pattern',
              title: 'Oltalama (Phishing) Kalıbı Tespit Edildi',
              message: `Bu alan adı (${hostname}), ${brand.toUpperCase()} ve "${kw}" kalıbını taklit ediyor olabilir. Şifre veya kart bilgilerinizi girmeyiniz.`,
              domain: hostname
            };
          }
        }
      }
    }
  }

  // High-risk scam TLDs combined with financial, login, crypto or gov keywords (Malwarebytes Guard Parity)
  const highRiskTlds = ['.top', '.xyz', '.buzz', '.click', '.rest', '.icu', '.tk', '.ml', '.ga', '.cf', '.gq', '.work'];
  const hasHighRiskTld = highRiskTlds.some((tld) => hostname.endsWith(tld));
  if (hasHighRiskTld) {
    const scamKeywords = ['bank', 'crypto', 'wallet', 'login', 'secure', 'support', 'claim', 'airdrop', 'free', 'odeme', 'fatura', 'turkiye'];
    for (const sk of scamKeywords) {
      if (hostname.includes(sk)) {
        return {
          level: 'danger',
          type: 'scam_domain_pattern',
          title: 'Şüpheli Sahte/Dolandırıcılık Alan Adı',
          message: `Bu web sitesi yüksek riskli alan adı uzantısı ve "${sk}" kalıbı içermektedir (${hostname}). Sahte veya zararlı içerik barındırıyor olabilir.`,
          domain: hostname
        };
      }
    }
  }

  return { level: 'safe', threat: null, domain: hostname };
}

/**
 * Analyze active tab and update extension badge with priority preservation
 * Uses chrome.storage.session to survive Service Worker restarts
 */
async function analyzeTab(tabId, url) {
  try {
    const { threatShield = true } = await chrome.storage.local.get('threatShield');
    const alertedList = await getAlertedTabs();
    const isAlerted = alertedList.includes(tabId);

    if (!threatShield) {
      tabThreats.delete(tabId);
      if (isAlerted) {
        await resetTabBadgeToDefault(tabId);
        await clearTabAlerted(tabId);
      }
      return;
    }

    const threat = evaluateUrlThreat(url);
    tabThreats.set(tabId, threat);

    if (threat.level === 'danger') {
      await markTabAlerted(tabId);
      await chrome.action.setBadgeText({ tabId, text: '!' }).catch(() => {});
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' }).catch(() => {});
      chrome.tabs
        .sendMessage(tabId, {
          type: 'AX_SECURITY_ALERT',
          level: 'danger',
          title: threat.title,
          message: threat.message,
          domain: threat.domain
        })
        .catch(() => {});
    } else if (threat.level === 'warning') {
      await markTabAlerted(tabId);
      await chrome.action.setBadgeText({ tabId, text: '!' }).catch(() => {});
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#f59e0b' }).catch(() => {});
      chrome.tabs
        .sendMessage(tabId, {
          type: 'AX_SECURITY_ALERT',
          level: 'warning',
          title: threat.title,
          message: threat.message,
          domain: threat.domain
        })
        .catch(() => {});
    } else {
      // Safe page: Only reset badge override if this tab was previously alerted,
      // restoring Chrome's native DNR action count and resetting background color to blue (#0284c7)!
      if (isAlerted) {
        await resetTabBadgeToDefault(tabId);
        await clearTabAlerted(tabId);
      }
    }
  } catch {
    // Suppress errors for closed tabs
  }
}

// Lifecycle events
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(async () => {
    try {
      const current = await chrome.storage.local.get(null);
      const updated = {};
      for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
        if (current[key] === undefined) {
          updated[key] = val;
        }
      }
      if (Object.keys(updated).length > 0) {
        await chrome.storage.local.set(updated);
      }
      await initActionOptions();
      await syncWhitelistRules();
      await syncRulesets();
      updateAllFilterLists().catch((err) => {
        console.warn('[AX-Privacy background] Initial filter update notice:', err?.message);
      });
    } catch (err) {
      console.error('[AX-Privacy background] onInstalled error:', err);
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup?.addListener) {
  chrome.runtime.onStartup.addListener(async () => {
    try {
      await initActionOptions();
      await syncWhitelistRules();
      await syncRulesets();
      updateAllFilterLists().catch((err) => {
        console.warn('[AX-Privacy background] Initial filter update notice:', err?.message);
      });
    } catch (err) {
      console.error('[AX-Privacy background] onStartup error:', err);
    }
  });
}

// Tab navigation monitoring
// Monitored newly opened tabs: tabId -> { openerTabId, createdAt }
const monitoredTabs = new Map();

function cleanStaleMonitoredTabs() {
  const now = Date.now();
  for (const [id, data] of monitoredTabs.entries()) {
    if (now - data.createdAt > 1200) {
      monitoredTabs.delete(id);
    }
  }
}

// User-intent tracking: openerTabId -> Array<{ targetHost: string, targetRoot: string, href: string, expiresAt: number }>
const trustedIntents = new Map();

// Track recent user new-tab clicks (middle-click, ctrl-click, target=_blank) per openerTabId
const lastUserNewTabClicks = new Map(); // openerTabId -> { timestamp: number, targetHost: string, targetRoot: string, href: string, isMiddleClick: boolean }

// Track recent trusted user interactions per tabId (within 3000ms)
const lastUserInteractionMap = new Map(); // tabId -> timestamp

function recordUserInteraction(tabId, timestamp = Date.now()) {
  if (!tabId || typeof tabId !== 'number') return;
  lastUserInteractionMap.set(tabId, timestamp);
}

function hasRecentUserInteraction(tabId, store = lastUserInteractionMap, maxAgeMs = 3000) {
  if (!tabId || !store) return false;
  const now = Date.now();
  if (store.has(tabId)) {
    const ts = store.get(tabId);
    if (now - ts <= maxAgeMs) {
      return true;
    }
  }
  return false;
}

function cleanStaleTrustedIntents(store = trustedIntents) {
  const now = Date.now();
  for (const [id, list] of store.entries()) {
    const valid = list.filter((item) => item.expiresAt > now);
    if (valid.length > 0) {
      store.set(id, valid);
    } else {
      store.delete(id);
    }
  }
  for (const [tabId, clickData] of lastUserNewTabClicks.entries()) {
    if (now - clickData.timestamp > 4000) {
      lastUserNewTabClicks.delete(tabId);
    }
  }
  for (const [tabId, ts] of lastUserInteractionMap.entries()) {
    if (now - ts > 4000) {
      lastUserInteractionMap.delete(tabId);
    }
  }
}

function recordTrustedIntent(openerTabId, targetHost, href = '', store = trustedIntents, extra = {}) {
  if (!openerTabId || !targetHost) return;
  const now = Date.now();
  const cleanHost = targetHost.toLowerCase().trim();
  const targetRoot = getRootDomain(cleanHost);
  const entry = {
    targetHost: cleanHost,
    targetRoot,
    href: href ? href.trim() : '',
    expiresAt: now + 4000 // Valid for 4000ms
  };

  const existing = store.get(openerTabId) || [];
  const valid = existing.filter((item) => item.expiresAt > now);
  valid.push(entry);
  store.set(openerTabId, valid);

  lastUserNewTabClicks.set(openerTabId, {
    timestamp: now,
    targetHost: cleanHost,
    targetRoot,
    href: href ? href.trim() : '',
    isMiddleClick: Boolean(extra.isMiddleClick || extra.button === 1)
  });
}

function hasValidTrustedIntent(openerTabId, targetHost, tabUrl = '', store = trustedIntents) {
  if (!openerTabId) return false;
  const now = Date.now();
  const cleanTarget = targetHost ? targetHost.toLowerCase().trim() : '';
  const targetRoot = getRootDomain(cleanTarget);

  let matched = false;

  if (store && store.has(openerTabId)) {
    const intents = store.get(openerTabId);
    const valid = [];

    for (const item of intents) {
      if (item.expiresAt > now) {
        if (!matched) {
          const itemRoot = item.targetRoot || getRootDomain(item.targetHost);
          if (
            (cleanTarget && (cleanTarget === item.targetHost || cleanTarget.endsWith('.' + item.targetHost))) ||
            (targetRoot && itemRoot && targetRoot === itemRoot)
          ) {
            matched = true;
            continue; // Consume the intent
          }
          if (
            tabUrl &&
            item.href &&
            (tabUrl === item.href || tabUrl.startsWith(item.href) || item.href.startsWith(tabUrl))
          ) {
            matched = true;
            continue; // Consume the intent
          }
        }
        valid.push(item);
      }
    }

    if (valid.length > 0) {
      store.set(openerTabId, valid);
    } else {
      store.delete(openerTabId);
    }
  }

  // Fallback: If user recently performed a new-tab click on this opener (within 4000ms)
  // and destination is not an ad network, allow it! (Handles middle-clicks, shorteners, redirects)
  if (!matched && lastUserNewTabClicks.has(openerTabId)) {
    const clickData = lastUserNewTabClicks.get(openerTabId);
    if (now - clickData.timestamp <= 4000) {
      matched = true;
    }
  }

  return matched;
}

const POPUNDER_MALVERTISING_PATHS = [
  '/afu.php',
  '/ntfc.php',
  'in-page-push',
  'popunder',
  '/direct-link',
  '/redirect.php',
  'click.php',
  'go.php?url=',
  'open.php?zone=',
  'ad.php?',
  '/vignette/',
  'delivery/impressions'
];

const POPUNDER_AD_NETWORKS = [
  'monetag.com',
  'propellerads.com',
  'adsterra.com',
  'hilltopads.net',
  'clickadu.com',
  'exoclick.com',
  'popads.net',
  'popcash.net',
  'tsyndicate.com',
  'trafficstars.com',
  'onclickalgo.com',
  'rollerads.com',
  'richads.com',
  'juicyads.com',
  'trafee.com',
  'yllix.com',
  'evadav.com',
  'twinred.com',
  'trafficjunky.com',
  'admaven.com',
  'ad-maven.com',
  'bidvertiser.com',
  'clickraine.com',
  'galaksion.com',
  'vignetteads.com',
  'alwingulla.com',
  'deloplen.com',
  'gloaphoo.net',
  'coomeeno.com',
  'onclickperformance.com',
  'adxad.com',
  'tubecorporate.com',
  'bidgear.com',
  'adkernel.com',
  'adtrue.com',
  'directrev.com',
  'infolinks.com',
  'ero-advertising.com',
  'trafficfactory.biz',
  'zeroredirect.com',
  'zeroredirect1.com',
  'zeroredirect2.com',
  'trafficholder.com',
  'clickaine.com',
  'doublepimp.com',
  'plugrush.com',
  'rtmark.net',
  'popmyads.com',
  'cpmleader.com',
  'popmytraffic.com',
  'popunder.net',
  'adxpansion.com',
  'adxpansion.net',
  'advertises.ru',
  'popcorn-vod.tv',
  'trafficjunky.net',
  'servenobid.com',
  'onclickads.net',
  'adbooth.com',
  'adbuffs.com',
  'clicky.com',
  'wigetmedia.com',
  'fidelity-media.com',
  'clicksor.net',
  'clicksor.com',
  'adfox.ru',
  'adversal.com',
  'buzzcity.com',
  'chitika.com',
  'revenuehits.com'
];

const LEGITIMATE_HOST_WHITELIST = new Set([
  'github.com',
  'google.com',
  'www.google.com',
  'youtube.com',
  'www.youtube.com',
  'wikipedia.org',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'linkedin.com',
  'discord.com',
  'spotify.com',
  'netflix.com',
  'amazon.com',
  'amazon.com.tr',
  'twitch.tv',
  'apple.com',
  'microsoft.com',
  'whatsapp.com',
  'telegram.org',
  // E-Commerce & Comparison Platforms
  'akakce.com',
  'cimri.com',
  'hepsiburada.com',
  'trendyol.com',
  'n11.com',
  'pazarama.com',
  'sahibinden.com',
  'gittigidiyor.com',
  'ebay.com',
  'aliexpress.com',
  'yemeksepeti.com',
  'getir.com',
  'migros.com.tr',
  // Community & Portals
  'donanimhaber.com',
  'eksisozluk.com',
  'technopat.net',
  'webtekno.com',
  // E-Devlet & Public
  'turkiye.gov.tr',
  'enabiz.gov.tr'
]);

const TRUSTED_AUTH_PAYMENT_DOMAINS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'github.com',
  'discord.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'stripe.com',
  'checkout.stripe.com',
  'paypal.com',
  'www.paypal.com',
  'paypalobjects.com',
  'iyzico.com',
  'sandbox-api.iyzico.com',
  'paytr.com',
  'bkmexpress.com.tr'
];

function isAuthOrPaymentUrl(targetUrlStr) {
  try {
    const u = new URL(targetUrlStr);
    const host = u.hostname.toLowerCase();
    const root = getRootDomain(host);
    const isDomainMatch = TRUSTED_AUTH_PAYMENT_DOMAINS.some(
      (d) => host === d || host.endsWith('.' + d) || root === d
    );
    if (isDomainMatch) return true;

    const fullPath = (u.pathname + u.search).toLowerCase();
    if (
      fullPath.includes('/oauth') ||
      fullPath.includes('/3dsecure') ||
      fullPath.includes('/3d-secure') ||
      fullPath.includes('/authorize') ||
      fullPath.includes('response_type=code')
    ) {
      return true;
    }
  } catch {}
  return false;
}

const TRUSTED_OPENER_FEEDS = new Set([
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yandex.com',
  'yandex.com.tr',
  'yahoo.com',
  'search.yahoo.com',
  'reddit.com',
  'x.com',
  'twitter.com',
  'instagram.com',
  'facebook.com',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
  'youtube.com',
  'github.com',
  'linkedin.com',
  'wikipedia.org',
  'discord.com',
  'spotify.com',
  'twitch.tv',
  'whatsapp.com',
  'telegram.org',
  'akakce.com',
  'cimri.com'
]);

function isTrustedFeedOpener(openerHost) {
  if (!openerHost) return false;
  const root = getRootDomain(openerHost.toLowerCase());
  return TRUSTED_OPENER_FEEDS.has(root) || TRUSTED_OPENER_FEEDS.has(openerHost.toLowerCase());
}

function getRootDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return '';
  const clean = hostname.trim().toLowerCase();
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  const secondToLast = parts[parts.length - 2];
  if (['com', 'co', 'gov', 'org', 'edu', 'net'].includes(secondToLast) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isPopunderAdUrl(urlStr, openerHost = '') {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const trimmed = urlStr.trim();
  if (
    trimmed === 'about:blank' ||
    trimmed.startsWith('chrome://') ||
    trimmed.startsWith('edge://') ||
    trimmed.startsWith('brave://') ||
    trimmed.startsWith('javascript:')
  ) {
    return false;
  }

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }

  const targetHost = u.hostname.toLowerCase();
  const openerRoot = getRootDomain(openerHost);
  const targetRoot = getRootDomain(targetHost);

  // If same root domain as opener, NEVER treat as pop-under
  if (openerRoot && targetRoot && openerRoot === targetRoot) {
    return false;
  }

  // If target root is an explicitly legitimate platform, never close
  if (LEGITIMATE_HOST_WHITELIST.has(targetRoot) || LEGITIMATE_HOST_WHITELIST.has(targetHost)) {
    return false;
  }

  const targetPath = u.pathname.toLowerCase();
  const targetQuery = u.search.toLowerCase();

  // 1. Direct match on known pop-under ad network domains
  if (POPUNDER_AD_NETWORKS.some((net) => targetHost === net || targetHost.endsWith('.' + net))) {
    return true;
  }

  // 2. Specific malvertising path signatures
  if (POPUNDER_MALVERTISING_PATHS.some((p) => targetPath.includes(p) || targetQuery.includes(p))) {
    return true;
  }

  // 3. Monetag / Propeller /4/ + 7+ digit zone ID pattern
  if (/\/4\/\d{7,}/.test(targetPath) || /\/4\/\d{7,}/.test(targetQuery)) {
    return true;
  }

  // 4. Query signatures for click hijackers
  const hasZone = targetQuery.includes('zoneid=') || targetQuery.includes('zone_id=');
  const hasClickId = targetQuery.includes('click_id=') || targetQuery.includes('clickid=');
  if (hasZone && hasClickId) {
    return true;
  }

  const hasSubId = targetQuery.includes('subid=') || targetQuery.includes('sub_id=');
  const hasOfferId = targetQuery.includes('offer_id=') || targetQuery.includes('offerid=');
  if (hasSubId && hasOfferId) {
    return true;
  }

  const hasAffId = targetQuery.includes('affid=') || targetQuery.includes('aff_id=');
  const hasCampId = targetQuery.includes('campaign_id=') || targetQuery.includes('campaignid=');
  if (hasAffId && hasCampId) {
    return true;
  }

  return false;
}

function isVignetteCandidate(el) {
  if (!el) return false;
  if (el.hasPasswordInput || el.hasVideo || el.hasAuthKeywords) return false;

  // Pattern 1: Max-Z-Index Fullscreen Ad Iframe
  if (el.tagName === 'IFRAME') {
    const z = parseInt(el.style?.zIndex || '0', 10);
    if (z >= 9999999 || z >= 2147483000) {
      const w = el.rect?.width || 0;
      const h = el.rect?.height || 0;
      if (w >= 300 && h >= 300) {
        return true;
      }
    }
  }

  const z = parseInt(el.style?.zIndex || '0', 10);
  const text = (el.text || '').toLowerCase();
  const isFixed = el.style?.position === 'fixed';

  // Pattern 2: Fake Loading / Tap-To-Continue Bait text
  if (isFixed && z >= 99999) {
    const baitPhrases = [
      'devam etmek için dokunun',
      'devam etmek için tıklayın',
      'tap to continue',
      'click to continue',
      'press allow',
      'bildirimlere izin ver'
    ];
    const hasBaitPhrase = baitPhrases.some((b) => text.includes(b));
    const hasProgress =
      /\d{1,3}\s*%/i.test(text) &&
      (text.includes('yükleniyor') || text.includes('loading') || text.includes('dokunun') || text.includes('continue'));
    if (hasBaitPhrase || hasProgress) {
      return true;
    }

    // Pattern 3: Giant Empty / Transparent Click Curtain
    const w = el.rect?.width || 0;
    const h = el.rect?.height || 0;
    if (w >= 600 && h >= 400 && text.trim().length === 0 && !el.hasRealInputs) {
      return true;
    }
  }

  return false;
}

function shouldBlockNewTab({
  openerTabId,
  openerUrl = '',
  tabUrl = '',
  intentsStore = trustedIntents,
  whitelist = [],
  popupShield = true,
  interactionsStore = lastUserInteractionMap
}) {
  if (!popupShield) {
    return { block: false, reason: 'shield_disabled' };
  }

  // User initiated (manual new tab, bookmarks, omnibox) without programmatic opener
  if (typeof openerTabId !== 'number' || openerTabId <= 0) {
    return { block: false, reason: 'user_initiated_no_opener' };
  }

  if (!tabUrl || typeof tabUrl !== 'string') {
    return { block: false, reason: 'empty_url' };
  }

  const trimmedTab = tabUrl.trim();
  if (
    trimmedTab === 'about:blank' ||
    trimmedTab.startsWith('chrome://') ||
    trimmedTab.startsWith('edge://') ||
    trimmedTab.startsWith('brave://') ||
    trimmedTab.startsWith('chrome-extension://') ||
    trimmedTab.startsWith('javascript:')
  ) {
    return { block: false, reason: 'non_http_protocol' };
  }

  let targetUrlObj;
  try {
    targetUrlObj = new URL(trimmedTab);
  } catch {
    return { block: false, reason: 'invalid_url' };
  }

  const targetHost = targetUrlObj.hostname.toLowerCase();
  let openerHost = '';
  if (openerUrl) {
    try {
      openerHost = new URL(openerUrl).hostname.toLowerCase();
    } catch {}
  }

  // Opener is in user whitelist
  if (openerHost && whitelist.some((w) => openerHost === w || openerHost.endsWith('.' + w))) {
    return { block: false, reason: 'opener_whitelisted' };
  }

  // Same root domain navigation is legitimate
  const openerRoot = getRootDomain(openerHost);
  const targetRoot = getRootDomain(targetHost);
  if (openerRoot && targetRoot && openerRoot === targetRoot) {
    return { block: false, reason: 'same_site' };
  }

  // Exception 1: Explicit user intent verified in content script
  if (hasValidTrustedIntent(openerTabId, targetHost, trimmedTab, intentsStore)) {
    return { block: false, reason: 'trusted_user_intent' };
  }

  // Exception 2: Target is authentication or payment gateway
  if (isAuthOrPaymentUrl(trimmedTab)) {
    return { block: false, reason: 'auth_or_payment_gateway' };
  }

  // Exception 3: Opener is search engine or social media feed
  if (isTrustedFeedOpener(openerHost)) {
    return { block: false, reason: 'trusted_opener_feed' };
  }

  // Global platform whitelist (Google, GitHub, etc.)
  if (LEGITIMATE_HOST_WHITELIST.has(targetRoot) || LEGITIMATE_HOST_WHITELIST.has(targetHost)) {
    return { block: false, reason: 'legitimate_platform_whitelist' };
  }

  // Check recent trusted user interaction in opener tab (within 3000ms)
  const hasRecentTrustedAction = hasRecentUserInteraction(openerTabId, interactionsStore, 3000);

  // Known pop-under / malvertising signatures are blocked immediately
  if (isPopunderAdUrl(trimmedTab, openerHost)) {
    return { block: true, reason: 'known_popunder_ad_signature' };
  }

  // If user interacted recently on the opener tab, preserve the tab!
  if (hasRecentTrustedAction) {
    return { block: false, reason: 'recent_user_interaction' };
  }

  // Block rotating/random cross-site pop-under domains with no user interaction
  return { block: true, reason: 'unsolicited_cross_site_tab' };
}

async function checkAndNeutralizeTab(tabId, url, openerTabId) {
  try {
    if (typeof openerTabId !== 'number' || openerTabId <= 0) {
      monitoredTabs.delete(tabId);
      return;
    }

    // Never close tabs older than 1200ms
    if (monitoredTabs.has(tabId)) {
      const data = monitoredTabs.get(tabId);
      if (Date.now() - data.createdAt > 1200) {
        monitoredTabs.delete(tabId);
        return;
      }
    }

    const { popupShield = true, whitelist = [] } = await chrome.storage.local.get(['popupShield', 'whitelist']);
    if (!popupShield) {
      monitoredTabs.delete(tabId);
      return;
    }

    // Safety check 1: If tab is currently active/focused by user, NEVER close it!
    try {
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab && currentTab.active) {
        monitoredTabs.delete(tabId);
        return;
      }
    } catch {
      monitoredTabs.delete(tabId);
      return;
    }

    let openerUrl = '';
    try {
      const openerTab = await chrome.tabs.get(openerTabId);
      if (openerTab?.url) {
        openerUrl = openerTab.url;
      }
    } catch {}

    let decision = shouldBlockNewTab({
      openerTabId,
      openerUrl,
      tabUrl: url,
      intentsStore: trustedIntents,
      whitelist,
      popupShield,
      interactionsStore: lastUserInteractionMap
    });

    if (decision.block) {
      // If decision is 'unsolicited_cross_site_tab', provide a 150ms grace period
      // to allow in-flight IPC messages from content.js before closing!
      if (decision.reason === 'unsolicited_cross_site_tab') {
        await new Promise((resolve) => setTimeout(resolve, 150));

        let currentUrl = url;
        try {
          const freshTab = await chrome.tabs.get(tabId);
          if (!freshTab || freshTab.active) {
            monitoredTabs.delete(tabId);
            return;
          }
          if (freshTab.url && freshTab.url !== 'about:blank') {
            currentUrl = freshTab.url;
          }
        } catch {
          monitoredTabs.delete(tabId);
          return;
        }

        decision = shouldBlockNewTab({
          openerTabId,
          openerUrl,
          tabUrl: currentUrl,
          intentsStore: trustedIntents,
          whitelist,
          popupShield,
          interactionsStore: lastUserInteractionMap
        });

        if (!decision.block) {
          monitoredTabs.delete(tabId);
          return;
        }
      }

      // Safety check 2: Re-verify tab is NOT active before closing
      try {
        const tabToRemove = await chrome.tabs.get(tabId);
        if (tabToRemove && tabToRemove.active) {
          monitoredTabs.delete(tabId);
          return;
        }
      } catch {
        monitoredTabs.delete(tabId);
        return;
      }

      console.info(
        `[AX-Background] Pop-up/under reklam sekmesi engellendi ve kapatıldı (${tabId}, reason: ${decision.reason}):`,
        url
      );
      await chrome.tabs.remove(tabId).catch(() => {});
      if (openerTabId) {
        await chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
      }
      const { totalBlocked = 0 } = await chrome.storage.local.get('totalBlocked');
      await chrome.storage.local.set({ totalBlocked: totalBlocked + 1 }).catch(() => {});
      monitoredTabs.delete(tabId);
    } else {
      monitoredTabs.delete(tabId);
    }
  } catch (err) {
    console.warn('[AX-Privacy background] checkAndNeutralizeTab error:', err);
    monitoredTabs.delete(tabId);
  }
}

const checkAndNeutralizePopunderTab = checkAndNeutralizeTab;

if (typeof chrome !== 'undefined' && chrome.tabs?.onCreated?.addListener) {
  chrome.tabs.onCreated.addListener((tab) => {
    try {
      if (tab?.id && typeof tab.openerTabId === 'number' && tab.openerTabId > 0) {
        cleanStaleMonitoredTabs();
        cleanStaleTrustedIntents();
        monitoredTabs.set(tab.id, {
          openerTabId: tab.openerTabId,
          createdAt: Date.now()
        });
        if (tab.url && tab.url !== 'about:blank') {
          checkAndNeutralizeTab(tab.id, tab.url, tab.openerTabId);
        }
      }
    } catch {}
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated?.addListener) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
      tabBlockedCounts.delete(tabId);
      resetTabBadgeToDefault(tabId);
    }
    const urlToCheck = changeInfo.url || tab?.url;
    if (urlToCheck) {
      analyzeTab(tabId, urlToCheck);
    }
    if (monitoredTabs.has(tabId) && urlToCheck && urlToCheck !== 'about:blank') {
      const data = monitoredTabs.get(tabId);
      if (Date.now() - data.createdAt <= 1200) {
        checkAndNeutralizeTab(tabId, urlToCheck, data.openerTabId);
      } else {
        monitoredTabs.delete(tabId);
      }
    }
  });
}

// Ultra-early navigation interception (fires before page response or DOM initialization)
if (typeof chrome !== 'undefined' && chrome.webNavigation?.onBeforeNavigate?.addListener) {
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    try {
      if (details && details.frameId === 0 && details.tabId && details.url && details.url !== 'about:blank') {
        tabBlockedCounts.delete(details.tabId);
        resetTabBadgeToDefault(details.tabId);
        if (monitoredTabs.has(details.tabId)) {
          const data = monitoredTabs.get(details.tabId);
          if (Date.now() - data.createdAt <= 1200) {
            checkAndNeutralizeTab(details.tabId, details.url, data.openerTabId);
          } else {
            monitoredTabs.delete(details.tabId);
          }
        }
      }
    } catch (err) {
      console.warn('[AX-Privacy background] webNavigation.onBeforeNavigate error:', err);
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated?.addListener) {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      monitoredTabs.delete(activeInfo.tabId);
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab?.url) {
        analyzeTab(activeInfo.tabId, tab.url);
      }
    } catch {}
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    tabBlockedCounts.delete(tabId);
    monitoredTabs.delete(tabId);
    tabThreats.delete(tabId);
    trustedIntents.delete(tabId);
    lastUserNewTabClicks.delete(tabId);
    lastUserInteractionMap.delete(tabId);
    await clearTabAlerted(tabId);
  });
}

// Debug rule matched listener for local statistics fallback
if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  try {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async () => {
      try {
        const { totalBlocked = 0 } = await chrome.storage.local.get('totalBlocked');
        await chrome.storage.local.set({ totalBlocked: totalBlocked + 1 });
      } catch {}
    });
  } catch {}
}

// Central message bus wrapped in try/catch to eliminate Unchecked runtime.lastError
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!message || typeof message !== 'object') {
      sendResponse({ success: false, error: 'Invalid message' });
      return false;
    }

    if (message.type === 'GET_STATE' || message.type === 'GET_TAB_STATE') {
      (async () => {
        try {
          const stored = await chrome.storage.local.get(null);
          const settings = {};
          for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
            settings[key] = stored[key] !== undefined ? stored[key] : defaultVal;
          }
          const tabId = message.tabId || sender.tab?.id;
          const threat = tabId ? tabThreats.get(tabId) || { level: 'safe' } : { level: 'safe' };
          sendResponse({
            success: true,
            settings,
            threat,
            customFilterLists: settings.customFilterLists || [],
            filterUpdateStatus: settings.filterUpdateStatus || null
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'ADD_CUSTOM_FILTER_LIST') {
      (async () => {
        try {
          const { url, name } = message;
          const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
          const validation = validateCustomFilterUrl(url, customFilterLists);
          if (!validation.valid) {
            sendResponse({ success: false, error: validation.error });
            return;
          }

          const listName = (name && typeof name === 'string' && name.trim())
            ? name.trim().slice(0, 30)
            : deriveFilterListName(url);

          const newItem = {
            id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: listName,
            url: validation.url,
            enabled: true,
            ruleCount: 0,
            lastStatus: 'idle',
            lastError: null
          };

          const updatedLists = [...customFilterLists, newItem];
          await chrome.storage.local.set({ customFilterLists: updatedLists });

          updateAllFilterLists().catch((err) => {
            console.warn('[AX-Privacy background] Background update failed after add:', err);
          });

          sendResponse({
            success: true,
            list: newItem,
            customFilterLists: updatedLists
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'TOGGLE_CUSTOM_FILTER_LIST') {
      (async () => {
        try {
          const { id, enabled } = message;
          const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
          const idx = customFilterLists.findIndex((l) => l.id === id);
          if (idx === -1) {
            sendResponse({ success: false, error: 'Filtre listesi bulunamadı' });
            return;
          }

          customFilterLists[idx].enabled = !!enabled;
          await chrome.storage.local.set({ customFilterLists });

          updateAllFilterLists().catch((err) => {
            console.warn('[AX-Privacy background] Background update failed after toggle:', err);
          });

          sendResponse({ success: true, customFilterLists });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'REMOVE_CUSTOM_FILTER_LIST') {
      (async () => {
        try {
          const { id } = message;
          const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
          const updatedLists = customFilterLists.filter((l) => l.id !== id);
          await chrome.storage.local.set({ customFilterLists: updatedLists });

          updateAllFilterLists().catch((err) => {
            console.warn('[AX-Privacy background] Background update failed after remove:', err);
          });

          sendResponse({ success: true, customFilterLists: updatedLists });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'UPDATE_FILTER_LISTS') {
      (async () => {
        try {
          const result = await updateAllFilterLists();
          const { customFilterLists = [], filterUpdateStatus = null } = await chrome.storage.local.get([
            'customFilterLists',
            'filterUpdateStatus'
          ]);
          sendResponse({
            success: true,
            customFilterLists,
            filterUpdateStatus,
            result
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'TOGGLE_WHITELIST') {
      (async () => {
        try {
          const { domain } = message;
          if (!domain) {
            sendResponse({ success: false, error: 'Domain missing' });
            return;
          }
          const isWhitelisted = await toggleDomainWhitelist(domain);
          sendResponse({ success: true, isWhitelisted });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'UPDATE_SETTINGS') {
      (async () => {
        try {
          const { key, value } = message;
          if (key in DEFAULT_SETTINGS) {
            await chrome.storage.local.set({ [key]: value });
            if (key === 'adBlock' || key === 'urlClean' || key === 'popupShield') {
              await syncRulesets();
            }
            if (key === 'youtubeShield') {
              await syncYouTubeRules();
            }
            if (key === 'threatShield' && !value) {
              await clearAllAlertedTabs();
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Unknown setting key' });
          }
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'INCREMENT_BLOCKED') {
      (async () => {
        try {
          const count = typeof message.count === 'number' ? message.count : 1;
          const tabId = sender.tab?.id;
          if (tabId) {
            const currentTabCount = (tabBlockedCounts.get(tabId) || 0) + count;
            tabBlockedCounts.set(tabId, currentTabCount);
            await updateTabBadge(tabId);
          }
          const { totalBlocked = 0 } = await chrome.storage.local.get('totalBlocked');
          await chrome.storage.local.set({ totalBlocked: totalBlocked + count });
          sendResponse({ success: true, totalBlocked: totalBlocked + count });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === 'GET_THREAT_STATUS') {
      const tabId = message.tabId || sender.tab?.id;
      const threat = tabId ? tabThreats.get(tabId) || { level: 'safe' } : { level: 'safe' };
      sendResponse({ success: true, threat });
      return false;
    }

    if (message.type === 'GET_COSMETIC_SELECTORS') {
      (async () => {
        try {
          const { cosmeticFilter = true, popupShield = true, whitelist = [] } =
            await chrome.storage.local.get(['cosmeticFilter', 'popupShield', 'whitelist']);

          let topHost = '';
          if (sender.tab?.url) {
            try {
              topHost = new URL(sender.tab.url).hostname.toLowerCase();
            } catch {}
          }
          const rawHost = (message.hostname || topHost).toLowerCase();

          // Whitelist inheritance: Whitelist top-level page and iframe subresources
          const isTopWhitelisted = topHost ? whitelist.some((w) => topHost === w || topHost.endsWith('.' + w)) : false;
          const isCurrentWhitelisted = rawHost ? whitelist.some((w) => rawHost === w || rawHost.endsWith('.' + w)) : false;
          const isWhitelisted = isTopWhitelisted || isCurrentWhitelisted;

          if (isWhitelisted || !cosmeticFilter) {
            sendResponse({
              success: true,
              whitelisted: isWhitelisted,
              cosmeticFilter,
              popupShield,
              genericSelectors: [],
              siteSelectors: [],
              selectors: []
            });
            return;
          }

          const rulesData = await getCosmeticRules();
          const genericList = Array.isArray(rulesData?.generic) ? rulesData.generic : [];
          const domainMap = rulesData?.domains || rulesData || {};

          const siteSelectorsSet = new Set();
          const checkHosts = [rawHost];
          if (topHost && topHost !== rawHost) {
            checkHosts.push(topHost);
          }

          for (const h of checkHosts) {
            if (!h) continue;
            // 1. Exact hostname match (e.g. www.netprime.me)
            if (Array.isArray(domainMap[h])) {
              for (const s of domainMap[h]) siteSelectorsSet.add(s);
            }
            // 2. Root domain match (e.g. www.netprime.me -> netprime.me)
            const parts = h.split('.');
            if (parts.length > 2) {
              const rootHost = parts.slice(-2).join('.');
              if (Array.isArray(domainMap[rootHost])) {
                for (const s of domainMap[rootHost]) siteSelectorsSet.add(s);
              }
            }
          }

          const siteSelectors = Array.from(siteSelectorsSet);
          const combined = Array.from(new Set([...genericList, ...siteSelectors]));

          sendResponse({
            success: true,
            whitelisted: false,
            cosmeticFilter,
            popupShield,
            genericSelectors: genericList,
            siteSelectors,
            selectors: combined
          });
        } catch (err) {
          sendResponse({
            success: false,
            error: err.message,
            whitelisted: false,
            cosmeticFilter: true,
            popupShield: true,
            genericSelectors: [],
            siteSelectors: [],
            selectors: []
          });
        }
      })();
      return true;
    }

    if (message.type === 'GET_FRAME_STATE') {
      (async () => {
        try {
          const { popupShield = true, whitelist = [] } = await chrome.storage.local.get(['popupShield', 'whitelist']);
          let topHost = '';
          if (sender.tab?.url) {
            try {
              topHost = new URL(sender.tab.url).hostname.toLowerCase();
            } catch {}
          }
          const rawHost = (message.hostname || topHost).toLowerCase();
          const isTopWhitelisted = topHost ? whitelist.some((w) => topHost === w || topHost.endsWith('.' + w)) : false;
          const isCurrentWhitelisted = rawHost ? whitelist.some((w) => rawHost === w || rawHost.endsWith('.' + w)) : false;
          sendResponse({
            success: true,
            whitelisted: isTopWhitelisted || isCurrentWhitelisted,
            popupShield
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message, whitelisted: false, popupShield: true });
        }
      })();
      return true;
    }

    if (message.type === 'AX_USER_INTERACTION') {
      const tabId = sender.tab?.id;
      if (tabId) {
        recordUserInteraction(tabId, message.ts || Date.now());
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      return false;
    }

    if (message.type === 'AX_TRUSTED_NEW_TAB') {
      const openerTabId = sender.tab?.id;
      if (openerTabId && message.targetHost) {
        recordUserInteraction(openerTabId, message.ts || Date.now());
        recordTrustedIntent(openerTabId, message.targetHost, message.href, trustedIntents, {
          isMiddleClick: message.isMiddleClick,
          button: message.button
        });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      return false;
    }

    sendResponse({ success: false, error: 'Unhandled message type' });
    return false;
  } catch (err) {
    sendResponse({ success: false, error: err.message });
    return false;
  }
});
}

// Exports for unit testing
export {
  parseFilterLine,
  parseFilterContent,
  validateCustomFilterUrl,
  deriveFilterListName,
  allocateDynamicRules,
  updateAllFilterLists,
  getStaticDomains,
  getCosmeticRules,
  syncWhitelistRules,
  syncYouTubeRules,
  toggleDomainWhitelist,
  getRootDomain,
  isPopunderAdUrl,
  isVignetteCandidate,
  evaluateUrlThreat,
  shouldBlockNewTab,
  recordTrustedIntent,
  hasValidTrustedIntent,
  lastUserNewTabClicks,
  lastUserInteractionMap,
  recordUserInteraction,
  hasRecentUserInteraction,
  TRUSTED_AUTH_PAYMENT_DOMAINS,
  TRUSTED_OPENER_FEEDS,
  PROTECTED_INFRASTRUCTURE,
  LEGITIMATE_HOST_WHITELIST,
  isTrustedFeedOpener
};
