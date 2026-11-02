export interface BuiltinList {
  /** Also the DNR static ruleset ID and the cosmetic engine file name. */
  id: string;
  name: string;
  category: 'ads' | 'privacy' | 'regional' | 'cookies' | 'security' | 'annoyances';
  url: string;
  homepage: string;
  license: string;
  defaultEnabled: boolean;
  /**
   * One hostname per line. 'domains': blocked outright, pages too (`||host^$all`).
   * 'hosts': only what a page loads from it (`||host^`).
   */
  format?: 'domains' | 'hosts';
  /** Ships `+js()` rules, compiled to `scriptlets/<id>.js`. */
  scriptlets?: true;
}

export const BUILTIN_LISTS: readonly BuiltinList[] = [
  {
    id: 'easylist',
    name: 'EasyList',
    category: 'ads',
    url: 'https://easylist.to/easylist/easylist.txt',
    homepage: 'https://easylist.to/',
    license: 'GPL-3.0-or-later / CC BY-SA 3.0',
    defaultEnabled: true,
  },
  {
    id: 'easyprivacy',
    name: 'EasyPrivacy',
    category: 'privacy',
    url: 'https://easylist.to/easylist/easyprivacy.txt',
    homepage: 'https://easylist.to/',
    license: 'GPL-3.0-or-later / CC BY-SA 3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    id: 'ublock',
    name: 'uBlock filters',
    category: 'ads',
    url: 'https://ublockorigin.github.io/uAssets/filters/filters.txt',
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    // Exceptions that undo what the ad lists break; the reason uBO rarely breaks sites.
    id: 'ublock-unbreak',
    name: 'uBlock Unbreak (site onarımı)',
    category: 'ads',
    url: 'https://ublockorigin.github.io/uAssets/filters/unbreak.txt',
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    id: 'ublock-quick-fixes',
    name: 'uBlock Quick fixes (güncel düzeltmeler)',
    category: 'ads',
    url: 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    id: 'brave-unbreak',
    name: 'Brave Unbreak (site onarımı)',
    category: 'ads',
    url: 'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-unbreak.txt',
    homepage: 'https://github.com/brave/adblock-lists',
    license: 'MPL-2.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    id: 'ublock-privacy',
    name: 'uBlock Privacy',
    category: 'privacy',
    url: 'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    id: 'pgl',
    name: "Peter Lowe's Ad and tracking server list",
    category: 'ads',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext',
    homepage: 'https://pgl.yoyo.org/adservers/',
    license: 'Ticari olmayan kullanım için ücretsiz',
    defaultEnabled: true,
    format: 'hosts',
  },
  {
    id: 'adguard-tr',
    name: 'AdGuard Türkçe filtresi',
    category: 'regional',
    url: 'https://filters.adtidy.org/extension/ublock/filters/13.txt',
    homepage: 'https://github.com/AdguardTeam/AdguardFilters',
    license: 'GPL-3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    id: 'adguard-urltracking',
    name: 'AdGuard URL Tracking (takip parametreleri)',
    category: 'privacy',
    url: 'https://filters.adtidy.org/extension/ublock/filters/17.txt',
    homepage: 'https://github.com/AdguardTeam/AdguardFilters',
    license: 'GPL-3.0',
    defaultEnabled: true,
  },
  {
    // Hiding or blocking a consent tool can also hide the page; off until the user opts in.
    id: 'easylist-cookie',
    name: 'EasyList Cookie List (çerez bildirimleri)',
    category: 'cookies',
    url: 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
    homepage: 'https://easylist.to/',
    license: 'GPL-3.0-or-later / CC BY-SA 3.0',
    defaultEnabled: false,
    scriptlets: true,
  },
  {
    // Newsletter and notification boxes: rules hide page parts, so it is off until asked for.
    id: 'adguard-popups',
    name: 'AdGuard Açılır Pencereler (bülten, bildirim kutuları)',
    category: 'annoyances',
    url: 'https://filters.adtidy.org/extension/ublock/filters/19.txt',
    homepage: 'https://github.com/AdguardTeam/AdguardFilters',
    license: 'GPL-3.0',
    defaultEnabled: false,
    scriptlets: true,
  },
  {
    id: 'ublock-badware',
    name: 'uBlock Badware risks (kötü amaçlı yazılım, dolandırıcılık)',
    category: 'security',
    url: 'https://ublockorigin.github.io/uAssets/filters/badware.txt',
    homepage: 'https://github.com/uBlockOrigin/uAssets',
    license: 'GPL-3.0',
    defaultEnabled: true,
    scriptlets: true,
  },
  {
    // Derived from URLhaus (abuse.ch), CC0. Only hosts that are malicious as a whole: the
    // ~107k single-URL entries exceed the static rule quota. The phishing-filter sibling is not
    // bundled: its OpenPhish data forbids redistribution and product use.
    id: 'urlhaus',
    name: 'Online Malicious URL Blocklist (URLhaus, alan adları)',
    category: 'security',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt',
    homepage: 'https://gitlab.com/malware-filter/urlhaus-filter',
    license: 'CC0-1.0 / MIT',
    defaultEnabled: true,
    format: 'domains',
  },
];

export const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_LISTS.map((l) => l.id));
