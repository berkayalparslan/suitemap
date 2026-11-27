// The only module that reads Playwright's underscore (internal) fields. Everything else in this
// package goes through these accessors (ADR 0004, "Internal field risk").
//
// Contract of every accessor: check that the field exists and has the expected shape, and return
// `undefined` (never throw) when it does not, after calling `report(field, message)` once per call.
// Callers decide the fallback and de-duplicate the warning. Fields read here exist on Playwright
// 1.42.1 and 1.65.1 (docs/playwright-adapter.md); `_modifiers`, `_hooks` and `TestCase.fn` are not
// read yet.
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

/** `Suite._parallelMode`: 'none' (unset) | 'parallel' | 'serial'. 'none' maps to 'default'. */
export function readParallelMode(suite: Suite, report: Report): DescribeMode | undefined {
  const value = (suite as { _parallelMode?: unknown })._parallelMode;
  if (value === 'none') return 'default';
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
