/** Environment for `!#if` directives (uBO/AdGuard syntax). Unknown tokens evaluate to false. */
export const CHROMIUM_MV3_ENV: Readonly<Record<string, boolean>> = {
  env_chromium: true,
  env_mv3: true,
  ext_ublock: true,
  ext_ubol: true,
  cap_user_stylesheet: true,
  true: true,
};

const INCLUDE_RE = /^!#include\s+(\S+)/;

export function includesOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = INCLUDE_RE.exec(line.trim());
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/** Evaluates `!`, `&&`, `||` and parentheses over env tokens. */
export function evalCondition(expr: string, env: Readonly<Record<string, boolean>>): boolean {
  const tokens = expr.match(/!|&&|\|\||\(|\)|[\w-]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const or = (): boolean => {
    let v = and();
    while (peek() === '||') {
      i++;
      v = and() || v;
    }
    return v;
  };
  const and = (): boolean => {
    let v = unary();
    while (peek() === '&&') {
      i++;
      v = unary() && v;
    }
    return v;
  };
  const unary = (): boolean => {
    const t = tokens[i++];
    if (t === '!') return !unary();
    if (t === '(') {
      const v = or();
      i++;
      return v;
    }
    return t !== undefined && env[t] === true;
  };
  return tokens.length > 0 && or();
}

/**
 * Applies `!#if/!#else/!#endif` and inlines `!#include` files (looked up by name in `includes`).
 * Returns the active filter lines.
 */
export function preprocess(
  text: string,
  env: Readonly<Record<string, boolean>> = CHROMIUM_MV3_ENV,
  includes: ReadonlyMap<string, string> = new Map(),
  depth = 0,
): string[] {
  const out: string[] = [];
  const stack: { active: boolean }[] = [];
  const active = () => stack.every((s) => s.active);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('!#if')) {
      stack.push({ active: evalCondition(line.slice(4), env) });
    } else if (line.startsWith('!#else')) {
      const top = stack.at(-1);
      if (top) top.active = !top.active;
    } else if (line.startsWith('!#endif')) {
      stack.pop();
    } else if (!active()) {
      continue;
    } else if (line.startsWith('!#include')) {
      const name = INCLUDE_RE.exec(line)?.[1];
      const included = name ? includes.get(name) : undefined;
      if (included !== undefined && depth < 3)
        out.push(...preprocess(included, env, includes, depth + 1));
    } else if (line) {
      out.push(line);
    }
  }
  return out;
}
