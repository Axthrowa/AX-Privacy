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

async function resetTabBadgeToDefault(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: null });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0284c7' }).catch(() => {});
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
 * Enables Chrome's native DNR action badge count and sets default badge styling
 */
async function initActionOptions() {
  try {
    if (chrome.declarativeNetRequest?.setExtensionActionOptions) {
      await chrome.declarativeNetRequest.setExtensionActionOptions({
        displayActionCountAsBadgeText: true
      });
    }
    if (chrome.action?.setBadgeBackgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ color: '#0284c7' });
    }
  } catch (err) {
    console.warn('[AX-Privacy background] initActionOptions error:', err);
  }
}

/**
 * Synchronize static DNR rulesets based on user settings
 */
async function syncRulesets() {
  try {
    const data = await chrome.storage.local.get(['adBlock', 'urlClean']);
    const adBlock = data.adBlock !== undefined ? data.adBlock : true;
    const urlClean = data.urlClean !== undefined ? data.urlClean : true;

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

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds
    });
  } catch (err) {
    console.error('[AX-Privacy background] syncRulesets error:', err);
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
  }
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
    if (caretIdx !== -1) {
      d = d.slice(0, caretIdx);
    }
    const slashIdx = d.indexOf('/');
    if (slashIdx !== -1) {
      d = d.slice(0, slashIdx);
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

// Tab navigation monitoring
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || (changeInfo.status === 'complete' && tab?.url)) {
    analyzeTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) {
      analyzeTab(activeInfo.tabId, tab.url);
    }
  } catch {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  tabThreats.delete(tabId);
  await clearTabAlerted(tabId);
});

// Debug rule matched listener for local statistics fallback
if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
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
            if (key === 'adBlock' || key === 'urlClean') {
              await syncRulesets();
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

    sendResponse({ success: false, error: 'Unhandled message type' });
    return false;
  } catch (err) {
    sendResponse({ success: false, error: err.message });
    return false;
  }
});

// Exports for unit testing
export {
  parseFilterLine,
  parseFilterContent,
  validateCustomFilterUrl,
  deriveFilterListName,
  allocateDynamicRules,
  updateAllFilterLists,
  getStaticDomains,
  syncWhitelistRules,
  toggleDomainWhitelist
};
