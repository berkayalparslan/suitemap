// Unit tests for the internal-field accessors. The "1.42" and "latest" trees copy the field sets of
// Playwright's own Suite/TestCase classes on those versions (packages/playwright/node_modules/playwright
// lib/common/test.js on 1.42.1, lib/common/index.js on 1.65.1); only the fields the accessors read matter.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Suite, TestCase } from '@playwright/test/reporter';
import {
  readParallelMode,
  readSuiteAnnotations,
  readSuiteHooks,
  readSuiteModifiers,
  readSuiteTags,
  readTestFn,
  readTestOnly,
} from './internals.js';

const suite = (fields: Record<string, unknown>) => fields as unknown as Suite;
const test = (fields: Record<string, unknown>) => fields as unknown as TestCase;

/** Suite as constructed by 1.42.1: no `type`, no `entries()`. */
const suite142 = (over: Record<string, unknown> = {}) =>
  suite({
    title: 'g',
    _only: false,
    _hooks: [],
    _staticAnnotations: [],
    _tags: [],
    _modifiers: [],
    _parallelMode: 'none',
    ...over,
  });

/** Suite as constructed by 1.65.1: adds `_locks`, `_type`, public `type`/`entries()`. */
const suiteLatest = (over: Record<string, unknown> = {}) =>
  suite({
    title: 'g',
    type: 'describe',
    entries: () => [],
    _only: false,
    _locks: [],
    _staticAnnotations: [],
    _tags: [],
    _modifiers: [],
    _parallelMode: 'none',
    ...over,
  });

const trees = [
  ['1.42-shaped', suite142],
  ['latest-shaped', suiteLatest],
] as const;

const collect = () => {
  const calls: [string, string][] = [];
  return { calls, report: (field: string, message: string) => calls.push([field, message]) };
};

describe.each(trees)('%s suite', (_name, make) => {
  it('reads _parallelMode: none and explicit default -> default, parallel, serial', () => {
    const { calls, report } = collect();
    expect(readParallelMode(make(), report)).toBe('default');
    expect(readParallelMode(make({ _parallelMode: 'default' }), report)).toBe('default');
    expect(readParallelMode(make({ _parallelMode: 'parallel' }), report)).toBe('parallel');
    expect(readParallelMode(make({ _parallelMode: 'serial' }), report)).toBe('serial');
    expect(calls).toEqual([]);
  });

  it('reads _tags as a copy', () => {
    const { calls, report } = collect();
    const own = ['@a', '@b'];
    const read = readSuiteTags(make({ _tags: own }), report);
    expect(read).toEqual(['@a', '@b']);
    expect(read).not.toBe(own);
    expect(readSuiteTags(make(), report)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('reads _staticAnnotations, keeping type and description only', () => {
    const { calls, report } = collect();
    const read = readSuiteAnnotations(
      make({
        _staticAnnotations: [
          { type: 'skip', location: { file: 'x', line: 1, column: 1 } },
          { type: 'issue', description: 'A-1' },
        ],
      }),
      report,
    );
    expect(read).toEqual([{ type: 'skip' }, { type: 'issue', description: 'A-1' }]);
    expect(calls).toEqual([]);
  });
});

describe('absent fields (older or unknown Playwright)', () => {
  const bare = suite({ title: 'g' });

  it('return undefined and report each field, never throw', () => {
    const { calls, report } = collect();
    expect(readParallelMode(bare, report)).toBeUndefined();
    expect(readSuiteTags(bare, report)).toBeUndefined();
    expect(readSuiteAnnotations(bare, report)).toBeUndefined();
    expect(readTestOnly(test({ title: 't' }), report)).toBeUndefined();
    expect(calls.map(([f]) => f)).toEqual([
      '_parallelMode',
      '_tags',
      '_staticAnnotations',
      '_only',
    ]);
    expect(calls.every(([, m]) => m.includes('missing'))).toBe(true);
  });
});

describe('wrong shape', () => {
  it.each([['sideways'], [null], [1], [{}], ['']])('rejects _parallelMode %j', (value) => {
    const { calls, report } = collect();
    expect(readParallelMode(suite({ _parallelMode: value }), report)).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('_parallelMode');
  });

  it.each([['@a'], [null], [[1]], [['@a', null]], [{ length: 0 }]])('rejects _tags %j', (value) => {
    const { calls, report } = collect();
    expect(readSuiteTags(suite({ _tags: value }), report)).toBeUndefined();
    expect(calls.map(([f]) => f)).toEqual(['_tags']);
  });

  it.each([
    ['skip'],
    [null],
    [[null]],
    [['skip']],
    [[{ description: 'no type' }]],
    [[{ type: 1 }]],
    [[{ type: 'issue', description: 5 }]],
  ])('rejects _staticAnnotations %j', (value) => {
    const { calls, report } = collect();
    expect(readSuiteAnnotations(suite({ _staticAnnotations: value }), report)).toBeUndefined();
    expect(calls.map(([f]) => f)).toEqual(['_staticAnnotations']);
  });

  it.each([['true'], [1], [null], [{}]])('rejects _only %j', (value) => {
    const { calls, report } = collect();
    expect(readTestOnly(test({ _only: value }), report)).toBeUndefined();
    expect(calls.map(([f]) => f)).toEqual(['_only']);
  });
});

describe('TestCase._only', () => {
  it.each([
    ['1.42-shaped', { title: 't', _only: true, _staticAnnotations: [], _tags: [] }],
    ['latest-shaped', { title: 't', type: 'test', _only: true, _locks: [], _planAnnotations: [] }],
  ])('reads true and false on a %s test', (_n, fields) => {
    const { calls, report } = collect();
    expect(readTestOnly(test(fields), report)).toBe(true);
    expect(readTestOnly(test({ ...fields, _only: false }), report)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('encapsulation', () => {
  it('no source file other than internals.ts reads an underscore property', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'internals.ts')
      .filter((f) =>
        /\.\s*_[a-zA-Z]|as \{\s*_[a-zA-Z]/.test(readFileSync(path.join(dir, f), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});

describe('readSuiteModifiers / readSuiteHooks / readTestFn', () => {
  const fnA = ({ browserName }: { browserName: string }) => browserName === 'firefox';
  const loc = { file: '/r/a.spec.ts', line: 3, column: 5 };

  it.each(trees)(
    'reads modifiers and hooks as source text on a %s suite, without calling them',
    (_n, make) => {
      let called = false;
      const { calls, report } = collect();
      const s = make({
        _modifiers: [{ type: 'skip', description: 'why', location: loc, fn: fnA }],
        _hooks: [
          {
            type: 'beforeEach',
            location: loc,
            fn: () => {
              called = true;
            },
          },
        ],
      });
      expect(readSuiteModifiers(s, report)).toEqual([
        { type: 'skip', description: 'why', location: loc, source: fnA.toString() },
      ]);
      expect(readSuiteHooks(s, report)).toEqual([
        { type: 'beforeEach', location: loc, source: expect.stringContaining('called = true') },
      ]);
      expect(called).toBe(false);
      expect(calls).toEqual([]);
    },
  );

  it('keeps entries without description or location', () => {
    const { calls, report } = collect();
    expect(
      readSuiteModifiers(suite142({ _modifiers: [{ type: 'slow', fn: () => 1 }] }), report),
    ).toEqual([{ type: 'slow', source: expect.any(String) }]);
    expect(calls).toEqual([]);
  });

  it('reports and returns undefined when the field is missing or not an array', () => {
    const { calls, report } = collect();
    expect(readSuiteModifiers(suite({ title: 'g' }), report)).toBeUndefined();
    expect(readSuiteHooks(suite({ _hooks: 'x' }), report)).toBeUndefined();
    expect(calls.map(([f]) => f)).toEqual(['_modifiers', '_hooks']);
  });

  it('drops malformed entries, keeps the good ones, and reports once', () => {
    const { calls, report } = collect();
    const s = suite142({
      _modifiers: [
        { type: 'skip', fn: () => 1 },
        { type: 3, fn: () => 1 },
        { type: 'fixme' },
        null,
      ],
    });
    expect(readSuiteModifiers(s, report)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('_modifiers');
  });

  it('reads TestCase.fn as source, reports when absent or not a function', () => {
    const { calls, report } = collect();
    expect(readTestFn(test({ fn: async () => 42 }), report)).toContain('42');
    expect(readTestFn(test({}), report)).toBeUndefined();
    expect(readTestFn(test({ fn: 'x' }), report)).toBeUndefined();
    expect(calls.map(([f]) => f)).toEqual(['fn', 'fn']);
  });
});
