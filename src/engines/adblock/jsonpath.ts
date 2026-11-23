/**
 * The JSON query language of uBO's `json-edit` scriptlets, enough for what the lists use:
 *
 *   `$` or nothing     the root
 *   `.key` `..key`     a child, or that key anywhere below
 *   `.*`               every child of an object or array
 *   `[?.a.b op value]` keep nodes where the relative path matches (`==` `!=` `^=` `$=` `*=`),
 *                      or exists when there is no operator
 *   `=value` `+=value` assign a JSON value, or merge a JSON object (trusted rules only);
 *                      a query with neither deletes what it selects.
 */

type Node = Record<string, unknown> | unknown[];
interface Ref {
  parent: Node | null;
  key: string;
  value: unknown;
}

type Step =
  | { kind: 'child'; key: string }
  | { kind: 'deep'; key: string }
  | { kind: 'all' }
  | { kind: 'filter'; path: Step[]; op: string | null; value: unknown };

export interface JsonEdit {
  steps: Step[];
  action: 'delete' | 'set' | 'merge';
  value?: unknown;
}

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null;
const NAME = /^[^.[\]=+!^$*"' ]+/;
// Nested data from a page can be deep or cyclic once a page script holds it; walks stay bounded.
const MAX_DEPTH = 64;

function literal(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Parses steps from `q` at `i`, stopping at `]` (inside a filter) or an assignment. */
function parseSteps(q: string, start: number, inFilter: boolean): [Step[], number] | null {
  const steps: Step[] = [];
  let i = start;
  while (i < q.length) {
    const rest = q.slice(i);
    if (inFilter && /^(?:\]|==|!=|\^=|\$=|\*=)/.test(rest)) break;
    if (!inFilter && /^\+?=/.test(rest)) break;
    if (rest.startsWith('[?')) {
      const inner = parseSteps(q, i + 2, true);
      if (!inner) return null;
      const [path, after] = inner;
      let j = after;
      let op: string | null = null;
      let value: unknown;
      const opMatch = /^(==|!=|\^=|\$=|\*=)/.exec(q.slice(j));
      if (opMatch) {
        op = opMatch[1] ?? null;
        j += op?.length ?? 0;
        // A quoted value may contain `]`; find the bracket that closes the filter.
        let end = j;
        if (q[end] === '"') {
          end++;
          while (end < q.length && !(q[end] === '"' && q[end - 1] !== '\\')) end++;
          end++;
        } else {
          while (end < q.length && q[end] !== ']') end++;
        }
        value = literal(q.slice(j, end));
        j = end;
      }
      if (q[j] !== ']') return null;
      // A filter right at the start, or after a bare `.`, tests the root's children.
      if (steps.length === 0 || q[i - 1] === '.') steps.push({ kind: 'all' });
      steps.push({ kind: 'filter', path, op, value });
      i = j + 1;
      continue;
    }
    if (rest.startsWith('$') && i === start && !inFilter) {
      i++;
      continue;
    }
    if (rest.startsWith('..')) {
      const m = NAME.exec(rest.slice(2));
      if (!m) return null;
      steps.push({ kind: 'deep', key: m[0] });
      i += 2 + m[0].length;
      continue;
    }
    if (rest.startsWith('.*')) {
      steps.push({ kind: 'all' });
      i += 2;
      continue;
    }
    if (rest.startsWith('.[?')) {
      i++;
      continue;
    }
    if (rest.startsWith('.')) {
      const m = NAME.exec(rest.slice(1));
      if (!m) return null;
      steps.push({ kind: 'child', key: m[0] });
      i += 1 + m[0].length;
      continue;
    }
    return null;
  }
  return [steps, i];
}

export function parseJsonEdit(query: string): JsonEdit | null {
  const q = query.trim();
  if (!q) return null;
  const parsed = parseSteps(q, 0, false);
  if (!parsed) return null;
  const [steps, i] = parsed;
  const rest = q.slice(i);
  if (rest === '') return steps.length ? { steps, action: 'delete' } : null;
  if (rest.startsWith('+=')) {
    const value = literal(rest.slice(2));
    return isNode(value) && !Array.isArray(value) ? { steps, action: 'merge', value } : null;
  }
  if (rest.startsWith('=') && steps.length)
    return { steps, action: 'set', value: literal(rest.slice(1)) };
  return null;
}

function children(ref: Ref): Ref[] {
  const v = ref.value;
  if (!isNode(v)) return [];
  return Object.keys(v).map((key) => ({
    parent: v,
    key,
    value: (v as Record<string, unknown>)[key],
  }));
}

function deep(ref: Ref, key: string, out: Ref[], depth = 0): void {
  if (depth > MAX_DEPTH || !isNode(ref.value)) return;
  for (const child of children(ref)) {
    if (child.key === key) out.push(child);
    deep(child, key, out, depth + 1);
  }
}

function select(refs: Ref[], steps: readonly Step[]): Ref[] {
  let current = refs;
  for (const step of steps) {
    const next: Ref[] = [];
    for (const ref of current) {
      if (step.kind === 'all') next.push(...children(ref));
      else if (step.kind === 'deep') deep(ref, step.key, next);
      else if (step.kind === 'child') {
        const v = ref.value;
        if (isNode(v) && Object.hasOwn(v, step.key)) {
          next.push({ parent: v, key: step.key, value: (v as Record<string, unknown>)[step.key] });
        }
      } else if (passes(ref, step)) next.push(ref);
    }
    current = next;
  }
  return current;
}

function passes(ref: Ref, f: Extract<Step, { kind: 'filter' }>): boolean {
  const found = select([{ parent: null, key: '', value: ref.value }], f.path);
  if (f.op === null) return found.some((r) => r.value !== undefined);
  return found.some(({ value }) => {
    if (f.op === '==') return value === f.value;
    if (f.op === '!=') return value !== f.value;
    if (typeof value !== 'string' || typeof f.value !== 'string') return false;
    if (f.op === '^=') return value.startsWith(f.value);
    if (f.op === '$=') return value.endsWith(f.value);
    return value.includes(f.value);
  });
}

/** Applies `edit` to `root` in place; true when something changed. */
export function applyJsonEdit(root: unknown, edit: JsonEdit): boolean {
  const hits = select([{ parent: null, key: '', value: root }], edit.steps);
  if (hits.length === 0) return false;
  if (edit.action === 'merge') {
    for (const { value } of hits) {
      if (isNode(value) && !Array.isArray(value)) Object.assign(value, edit.value);
    }
    return true;
  }
  if (edit.action === 'set') {
    for (const { parent, key } of hits) {
      if (parent) (parent as Record<string, unknown>)[key] = structuredClone(edit.value);
    }
    return true;
  }
  // Deleting array items shifts the rest: remove from the highest index down.
  // The same item can be selected twice (`..a` under `..a`); each index goes once.
  const fromArrays = new Map<unknown[], Set<number>>();
  for (const { parent, key } of hits) {
    if (!Array.isArray(parent)) continue;
    const set = fromArrays.get(parent) ?? new Set<number>();
    set.add(Number(key));
    fromArrays.set(parent, set);
  }
  for (const [parent, indexes] of fromArrays) {
    for (const i of [...indexes].sort((a, b) => b - a)) parent.splice(i, 1);
  }
  for (const { parent, key } of hits) {
    if (parent && !Array.isArray(parent)) Reflect.deleteProperty(parent, key);
  }
  return true;
}
