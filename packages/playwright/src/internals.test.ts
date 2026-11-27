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
  readSuiteTags,
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
  it('reads _parallelMode: none -> default, parallel, serial', () => {
    const { calls, report } = collect();
    expect(readParallelMode(make(), report)).toBe('default');
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
