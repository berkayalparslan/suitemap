// The only module that reads Playwright's underscore (internal) fields. Everything else in this
// package goes through these accessors (ADR 0004 "Consequences", ADR 0007).
//
// Contract of every accessor: check that the field exists and has the expected shape, and return
// `undefined` (never throw) when it does not, after calling `report(field, message)` once per call.
// Callers decide the fallback and de-duplicate the warning. Fields read here exist on Playwright
// 1.42.1 and 1.65.1 (docs/playwright-adapter.md); `_modifiers`, `_hooks` and `TestCase.fn` are read
// as source text only: they are never called.
import type { Suite, TestCase } from '@playwright/test/reporter';

/** Called with the internal field name and a human-readable reason when a field cannot be trusted. */
export type Report = (field: string, message: string) => void;

export type DescribeMode = 'default' | 'parallel' | 'serial';

/** An annotation as stored in `_staticAnnotations` (`location` is ignored). */
export interface StaticAnnotation {
  type: string;
  description?: string;
}

const describeValue = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

/**
 * `Suite._parallelMode`: 'none' (unset) | 'default' (explicit `configure({ mode: 'default' })`) |
 * 'parallel' | 'serial'. 'none' and 'default' both map to 'default'.
 */
export function readParallelMode(suite: Suite, report: Report): DescribeMode | undefined {
  const value = (suite as { _parallelMode?: unknown })._parallelMode;
  if (value === 'none' || value === 'default') return 'default';
  if (value === 'parallel' || value === 'serial') return value;
  report(
    '_parallelMode',
    value === undefined
      ? 'Suite._parallelMode is missing'
      : `Suite._parallelMode has an unexpected value (${describeValue(value)}${typeof value === 'string' ? ` "${value}"` : ''})`,
  );
  return undefined;
}

/** `Suite._tags`: tags declared in the describe's `{ tag }` details (not the title). */
export function readSuiteTags(suite: Suite, report: Report): string[] | undefined {
  const value = (suite as { _tags?: unknown })._tags;
  if (Array.isArray(value) && value.every((t) => typeof t === 'string')) return [...value];
  report(
    '_tags',
    value === undefined
      ? 'Suite._tags is missing'
      : `Suite._tags is not an array of strings (${describeValue(value)})`,
  );
  return undefined;
}

/** `Suite._staticAnnotations`: annotations declared on the describe itself (own, not inherited). */
export function readSuiteAnnotations(suite: Suite, report: Report): StaticAnnotation[] | undefined {
  const value = (suite as { _staticAnnotations?: unknown })._staticAnnotations;
  if (
    Array.isArray(value) &&
    value.every(
      (a) =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as { type?: unknown }).type === 'string' &&
        ['undefined', 'string'].includes(typeof (a as { description?: unknown }).description),
    )
  )
    return value.map((a: { type: string; description?: string }) => ({
      type: a.type,
      ...(a.description === undefined ? {} : { description: a.description }),
    }));
  report(
    '_staticAnnotations',
    value === undefined
      ? 'Suite._staticAnnotations is missing'
      : `Suite._staticAnnotations is not an array of { type: string, description?: string } (${describeValue(value)})`,
  );
  return undefined;
}

/** `TestCase._only`: true for `test.only(...)` (the test itself, not an enclosing `describe.only`). */
export function readTestOnly(test: TestCase, report: Report): boolean | undefined {
  const value = (test as { _only?: unknown })._only;
  if (typeof value === 'boolean') return value;
  report(
    '_only',
    value === undefined
      ? 'TestCase._only is missing'
      : `TestCase._only is not a boolean (${describeValue(value)})`,
  );
  return undefined;
}

/** Where a function sits and what Playwright says about it (the source is not evaluated). */
export interface FunctionSource {
  source: string;
  location?: { file: string; line: number; column: number };
}

export interface ModifierEntry extends FunctionSource {
  /** skip | fixme | fail | slow */
  type: string;
  description?: string;
}

export interface HookEntry extends FunctionSource {
  /** beforeAll | afterAll | beforeEach | afterEach */
  type: string;
}

const sourceOf = (fn: unknown): string | undefined =>
  typeof fn === 'function' ? Function.prototype.toString.call(fn) : undefined;

const locationOf = (v: unknown): FunctionSource['location'] => {
  const l = v as { file?: unknown; line?: unknown; column?: unknown } | null | undefined;
  return l &&
    typeof l.file === 'string' &&
    typeof l.line === 'number' &&
    typeof l.column === 'number'
    ? { file: l.file, line: l.line, column: l.column }
    : undefined;
};

/**
 * `Suite._modifiers`: describe- and file-level `skip/fixme/fail/slow` calls (`test.skip(cb, reason)`,
 * `test.describe` bodies). Entries without a usable `type` or `fn` are dropped and reported.
 */
export function readSuiteModifiers(suite: Suite, report: Report): ModifierEntry[] | undefined {
  const value = (suite as { _modifiers?: unknown })._modifiers;
  if (!Array.isArray(value)) {
    report(
      '_modifiers',
      value === undefined
        ? 'Suite._modifiers is missing'
        : `Suite._modifiers is not an array (${describeValue(value)})`,
    );
    return undefined;
  }
  const out: ModifierEntry[] = [];
  let bad = false;
  for (const m of value as {
    type?: unknown;
    description?: unknown;
    fn?: unknown;
    location?: unknown;
  }[]) {
    const source = sourceOf(m?.fn);
    if (typeof m?.type !== 'string' || source === undefined) {
      bad = true;
      continue;
    }
    const location = locationOf(m.location);
    out.push({
      type: m.type,
      source,
      ...(typeof m.description === 'string' ? { description: m.description } : {}),
      ...(location ? { location } : {}),
    });
  }
  if (bad)
    report(
      '_modifiers',
      'Suite._modifiers has entries without a string `type` and a function `fn`',
    );
  return out;
}

/** `Suite._hooks`: beforeAll/afterAll/beforeEach/afterEach registered on this suite. */
export function readSuiteHooks(suite: Suite, report: Report): HookEntry[] | undefined {
  const value = (suite as { _hooks?: unknown })._hooks;
  if (!Array.isArray(value)) {
    report(
      '_hooks',
      value === undefined
        ? 'Suite._hooks is missing'
        : `Suite._hooks is not an array (${describeValue(value)})`,
    );
    return undefined;
  }
  const out: HookEntry[] = [];
  let bad = false;
  for (const h of value as { type?: unknown; fn?: unknown; location?: unknown }[]) {
    const source = sourceOf(h?.fn);
    if (typeof h?.type !== 'string' || source === undefined) {
      bad = true;
      continue;
    }
    const location = locationOf(h.location);
    out.push({ type: h.type, source, ...(location ? { location } : {}) });
  }
  if (bad) report('_hooks', 'Suite._hooks has entries without a string `type` and a function `fn`');
  return out;
}

/** `TestCase.fn`: the test body (not in the public types). */
export function readTestFn(test: TestCase, report: Report): string | undefined {
  const value = (test as { fn?: unknown }).fn;
  const source = sourceOf(value);
  if (source !== undefined) return source;
  report(
    'fn',
    value === undefined
      ? 'TestCase.fn is missing'
      : `TestCase.fn is not a function (${describeValue(value)})`,
  );
  return undefined;
}
