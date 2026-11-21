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
  whitelist: [],
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
    const existingRuleIds = existingRules.map((r) => r.id);

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
  } catch (err) {
    console.error('[AX-Privacy background] onInstalled error:', err);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await initActionOptions();
    await syncWhitelistRules();
    await syncRulesets();
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

    if (message.type === 'GET_STATE') {
      (async () => {
        try {
          const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
          const tabId = message.tabId || sender.tab?.id;
          const threat = tabId ? tabThreats.get(tabId) || { level: 'safe' } : { level: 'safe' };
          sendResponse({ success: true, settings, threat });
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
