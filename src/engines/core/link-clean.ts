/**
 * Links through a tracking redirect carry their real target in a parameter. Reading it locally means
 * the tracker's server is never asked. DNR cannot do this: it has no way to decode the parameter.
 */
export interface LinkRule {
  include: string[];
  exclude: string[];
  param: string;
  base64?: boolean;
}

/** Match pattern (`*://*.host/path*`) as a RegExp; the scheme and any `*` are wildcards. */
export function patternToRegExp(pattern: string): RegExp {
  const m = /^(\*|https?):\/\/(\*\.)?([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return /$^/;
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  const scheme = m[1] === '*' ? 'https?' : (m[1] ?? 'https');
  const host = (m[2] ? '(?:[^/]*\\.)?' : '') + escape(m[3] ?? '');
  // Match patterns ignore the port.
  return new RegExp('^' + scheme + '://' + host + '(?::\\d+)?' + escape(m[4] ?? '/') + '$', 'i');
}

function decode(value: string, base64: boolean | undefined): string | null {
  if (!base64) return value;
  try {
    return atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return null;
  }
}

/** Where the link really goes, or null if it is not a known redirect or the target looks wrong. */
export function realTarget(href: string, rules: readonly LinkRule[]): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const rule of rules) {
    const value = url.searchParams.get(rule.param);
    if (!value || !rule.include.some((p) => patternToRegExp(p).test(href))) continue;
    if (rule.exclude.some((p) => patternToRegExp(p).test(href))) continue;
    const decoded = decode(value, rule.base64);
    if (!decoded) continue;
    try {
      const target = new URL(decoded);
      // Never a script or data URL, and a redirect to itself is not a redirect.
      if (/^https?:$/.test(target.protocol) && target.hostname !== url.hostname) return target.href;
    } catch {
      // Not an absolute URL: this rule does not apply here.
    }
  }
  return null;
}
