// Every hard case in fixtures/playwright-basic/tests/misc/conditionals.spec.ts maps to an explicit
// expected Conditional, with its confidence (ADR 0004, ADR 0008). Runs the real reporter, so it also
// runs in the Playwright version matrix: the result must be the same on 1.42 and latest.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Conditional, SuitemapDocument } from '@suitemap/core';
import { extract } from './run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const fixtureDir = path.resolve(pkgDir, '../../fixtures/playwright-basic');
const FILE = 'tests/misc/conditionals.spec.ts';
const T = (title: string) => ({ testId: `${FILE} › conditionals › ${title}` });
const D = { describeId: `${FILE} › conditionals` };

// Column is version-dependent (docs/playwright-adapter.md); everything else must match exactly.
type Expected = Omit<Conditional, 'id' | 'location'> & { line: number };

const EXPECTED: Record<string, Expected> = {
  'file-level callback': {
    type: 'skip',
    form: 'file-callback',
    condition: "browserName === 'firefox'",
    refs: ['browserName'],
    reason: 'file-level: no firefox',
    scope: { fileId: FILE },
    appliesToProjects: 'unknown',
    source: 'reporter',
    confidence: 'static',
    line: 12,
  },
  'beforeEach hook': {
    type: 'skip',
    form: 'hook',
    condition: "browserName === 'webkit'",
    refs: ['browserName'],
    reason: 'beforeEach: no webkit',
    scope: D,
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'static',
    line: 15,
  },
  'env var condition': {
    type: 'fixme',
    form: 'body',
    condition: "process.env.FEATURE_X === '1'",
    refs: ['process.env.FEATURE_X'],
    reason: 'needs feature x',
    scope: T('env var condition'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'inferred',
    line: 19,
  },
  'helper call': {
    type: 'unknown',
    form: 'body',
    condition: 'skipOnCI(_test.test)',
    refs: ['skipOnCI'],
    scope: T('helper call'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'opaque',
    line: 23,
  },
  'computed annotation type': {
    type: 'unknown',
    form: 'runtime-push',
    refs: ['kind'],
    reason: 'JIRA-9',
    scope: T('computed annotation type'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'opaque',
    line: 27,
  },
  'early return before conditional': {
    type: 'skip',
    form: 'body',
    condition: 'true',
    refs: [],
    reason: 'never reached on chromium',
    scope: T('early return before conditional'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'opaque',
    line: 31,
  },
  'project name condition': {
    type: 'slow',
    form: 'body',
    condition: "testInfo.project.name === 'webkit'",
    refs: ['project.name'],
    reason: 'slow project',
    scope: T('project name condition'),
    appliesToProjects: ['webkit'],
    source: 'scan',
    confidence: 'static',
    line: 36,
  },
  'testInfo modifier': {
    type: 'fail',
    form: 'body',
    condition: "process.platform === 'win32'",
    refs: ['process.platform'],
    reason: 'known bug on windows',
    scope: T('testInfo modifier'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'inferred',
    line: 40,
  },
  'guarded unconditional skip': {
    type: 'skip',
    form: 'body',
    condition: "browserName === 'firefox'",
    refs: ['browserName'],
    scope: T('guarded unconditional skip'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'static',
    line: 44,
  },
  'literal runtime annotation': {
    type: 'issue',
    form: 'runtime-push',
    refs: [],
    reason: 'JIRA-10',
    scope: T('literal runtime annotation'),
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'static',
    line: 50,
  },
  'afterEach hook': {
    type: 'slow',
    form: 'hook',
    refs: [],
    scope: D,
    appliesToProjects: 'unknown',
    source: 'scan',
    confidence: 'static',
    line: 54,
  },
};

describe('conditionals.spec.ts hard cases', () => {
  let doc: SuitemapDocument;
  let found: Conditional[];

  beforeAll(async () => {
    if (!existsSync(path.join(pkgDir, 'dist/reporter.js')))
      throw new Error('Run `pnpm build` first: the reporter is loaded from dist by Playwright.');
    doc = await extract({
      cwd: fixtureDir,
      generatedAt: '2026-01-01T00:00:00.000Z',
      env: { NODE_PATH: path.join(pkgDir, 'node_modules') },
    });
    found = doc.conditionals.filter((c) => c.location.file === FILE);
  }, 120_000);

  it.each(Object.entries(EXPECTED))('%s', (_name, expected) => {
    const { line, ...rest } = expected;
    const hit = found.filter((c) => c.location.line === line);
    expect(hit).toHaveLength(1);
    const { location, ...actual } = hit[0]!;
    // `id` is checked in core; undefined keys are ignored by toEqual.
    expect({ ...actual, id: undefined }).toEqual(rest);
    expect(location.file).toBe(FILE);
  });

  it('finds exactly these conditionals in the file, nothing else', () => {
    expect(found.map((c) => c.location.line).sort((a, b) => a - b)).toEqual(
      Object.values(EXPECTED)
        .map((e) => e.line)
        .sort((a, b) => a - b),
    );
  });

  it('lists a conditional once, although every project contains the file', () => {
    expect(new Set(doc.conditionals.map((c) => c.id)).size).toBe(doc.conditionals.length);
    expect(doc.warnings.filter((w) => w.code === 'conditional-parse-failed')).toEqual([]);
  });
});
