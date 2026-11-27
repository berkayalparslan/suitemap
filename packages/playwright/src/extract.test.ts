// Unit tests on hand-made suite trees: the shape differences between Playwright versions
// (docs/playwright-adapter.md, "Phase 0 checks") are simulated here, with no Playwright process.
import { describe, expect, it } from 'vitest';
import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';
import { extractDocument, extractRaw } from './extract.js';

const BASE = '/repo';
const GEN = { generatedAt: '2026-01-01T00:00:00.000Z' };

interface FakeTest {
  title: string;
  line?: number;
  tags?: string[];
  annotations?: Record<string, unknown>[];
  expectedStatus?: string;
}

/** A test shaped like Playwright 1.42: no `type`. Newer versions add `type: 'test'`. */
const fakeTest = (t: FakeTest, titles: string[], file: string, modern: boolean) =>
  ({
    ...(modern ? { type: 'test' } : {}),
    title: t.title,
    titlePath: () => ['', 'p', file, ...titles, t.title],
    location: { file: `${BASE}/${file}`, line: t.line ?? 1, column: 1 },
    tags: t.tags ?? [],
    annotations: t.annotations ?? [],
    expectedStatus: t.expectedStatus ?? 'passed',
    timeout: 30000,
    retries: 0,
    repeatEachIndex: 0,
    id: `id-${file}-${t.title}`,
  }) as unknown as TestCase;

interface FakeSuite {
  title: string;
  line?: number;
  children?: (FakeSuite | FakeTest)[];
}

const isSuite = (c: FakeSuite | FakeTest): c is FakeSuite => 'children' in c;

function fakeSuite(
  s: FakeSuite,
  kind: string,
  depth: number,
  titles: string[],
  file: string,
  modern: boolean,
): Suite {
  const kids = s.children ?? [];
  const innerTitles = kind === 'describe' ? [...titles, s.title] : titles;
  const suites = kids
    .filter(isSuite)
    .map((c) => fakeSuite(c, 'describe', depth + 1, innerTitles, file, modern));
  const tests = kids
    .filter((c): c is FakeTest => !isSuite(c))
    .map((t) => fakeTest(t, innerTitles, file, modern));
  const suite = {
    ...(modern ? { type: kind } : {}),
    title: s.title,
    location:
      s.line === undefined ? undefined : { file: `${BASE}/${file}`, line: s.line, column: 1 },
    suites,
    tests,
    allTests: (): TestCase[] => [...suites.flatMap((c) => c.allTests()), ...tests],
  } as unknown as Suite;
  if (modern)
    (suite as unknown as { entries: () => unknown[] }).entries = () =>
      kids.map((c) =>
        isSuite(c)
          ? suites[kids.filter(isSuite).indexOf(c)]
          : tests[kids.filter((k) => !isSuite(k)).indexOf(c)],
      );
  return suite;
}

interface FakeProject {
  name: string;
  dependencies?: string[];
  teardown?: string;
  grep?: RegExp | RegExp[];
  use?: Record<string, unknown>;
  files: Record<string, (FakeSuite | FakeTest)[]>;
}

function fakeRoot(projects: FakeProject[], modern: boolean): { config: FullConfig; root: Suite } {
  const projectSuites = projects.map((p) => {
    const fullProject = {
      name: p.name,
      dependencies: p.dependencies ?? [],
      teardown: p.teardown,
      testDir: `${BASE}/tests`,
      grep: p.grep ?? /.*/,
      grepInvert: null,
      use: p.use ?? {},
    };
    const fileSuites = Object.entries(p.files).map(([file, children]) =>
      fakeSuite({ title: file, line: undefined, children }, 'file', 2, [], file, modern),
    );
    // File suites carry no location on some versions: fileOf() falls back to the first test.
    return {
      ...(modern ? { type: 'project' } : {}),
      title: p.name,
      suites: fileSuites,
      tests: [],
      allTests: () => fileSuites.flatMap((f) => f.allTests()),
      project: () => fullProject,
    } as unknown as Suite;
  });
  const root = {
    ...(modern ? { type: 'root' } : {}),
    title: '',
    suites: projectSuites,
    tests: [],
  } as unknown as Suite;
  const config = {
    version: modern ? '1.65.1' : '1.42.1',
    configFile: `${BASE}/playwright.config.ts`,
    rootDir: `${BASE}/tests`,
  } as unknown as FullConfig;
  return { config, root };
}

describe.each([
  ['1.42-shaped suites (no Suite.type, no entries())', false],
  ['current-shaped suites', true],
])('%s', (_name, modern) => {
  const build = (projects: FakeProject[]) => {
    const { config, root } = fakeRoot(projects, modern);
    return extractDocument(config, root, GEN);
  };

  it('infers project/file/describe from depth and builds ids relative to the config directory', () => {
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [{ title: 'group', line: 2, children: [{ title: 't', line: 3 }] }],
        },
      },
    ]);
    expect(doc.files.map((f) => f.id)).toEqual(['tests/a.spec.ts']);
    expect(doc.describes.map((d) => d.id)).toEqual(['tests/a.spec.ts › group']);
    expect(doc.tests[0]?.id).toBe('tests/a.spec.ts › group › t');
    expect(doc.tests[0]?.describeId).toBe('tests/a.spec.ts › group');
    expect(doc.source.configFile).toBe('playwright.config.ts');
    expect(doc.projects[0]?.testDir).toBe('tests');
  });

  it('keeps declaration order of tests and describes', () => {
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            { title: 'first', line: 1 },
            { title: 'group', line: 2, children: [{ title: 'inner', line: 3 }] },
            { title: 'last', line: 6 },
          ],
        },
      },
    ]);
    expect(doc.tests.map((t) => t.title)).toEqual(['first', 'inner', 'last']);
  });

  it('is independent of project order', () => {
    const a = { name: 'a', files: { 'tests/x.spec.ts': [{ title: 't' }] } };
    const b = { name: 'b', dependencies: ['a'], files: { 'tests/x.spec.ts': [{ title: 't' }] } };
    expect(build([a, b])).toEqual(build([b, a]));
  });

  it('copies annotations as reported (no location needed), drops synthetic serial, flags hidden types', () => {
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 't',
              annotations: [
                { type: 'serial' },
                {
                  type: 'issue',
                  description: 'JIRA-1',
                  location: { file: 'x', line: 1, column: 1 },
                },
                { type: '_internal', description: 'tooling' },
                { type: 'skip' },
              ],
            },
          ],
        },
      },
    ]);
    expect(doc.instances[0]?.annotations).toEqual([
      { type: 'issue', description: 'JIRA-1', origin: 'declaration' },
      { type: '_internal', description: 'tooling', origin: 'declaration', hidden: true },
      { type: 'skip', origin: 'declaration' },
    ]);
  });

  it('reconstructs tag origin from title tokens and describe titles, deduping repeats', () => {
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'outer @d',
              children: [
                {
                  title: 't @smoke',
                  tags: ['@d', '@smoke', '@smoke', '@extra'],
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(doc.tests[0]?.tags).toEqual([
      { name: '@d', origin: 'describe' },
      { name: '@smoke', origin: 'title' },
      { name: '@extra', origin: 'details' },
    ]);
    expect(doc.warnings.map((w) => w.code)).toContain('tag-origin-approximate');
  });

  it('does not claim describe internals: mode is default, own tags and annotations are empty, and it warns', () => {
    const doc = build([
      { name: 'p', files: { 'tests/a.spec.ts': [{ title: 'g', children: [{ title: 't' }] }] } },
    ]);
    expect(doc.describes[0]).toMatchObject({ mode: 'default', tags: [], annotations: [] });
    expect(doc.instances[0]?.only).toBeUndefined();
    expect(doc.conditionals).toEqual([]);
    expect(doc.warnings.map((w) => w.code)).toContain('describe-internals-unavailable');
  });

  it('serialises project dependencies, teardown, grep (not the default) and allow-listed use only', () => {
    const doc = build([
      {
        name: 'p',
        dependencies: ['setup'],
        teardown: 'down',
        grep: /@smoke/,
        use: { browserName: 'webkit', storageState: 'secret.json', extraHTTPHeaders: { a: 'b' } },
        files: {},
      },
      { name: 'setup', files: {} },
      { name: 'down', files: {} },
    ]);
    const p = doc.projects.find((x) => x.id === 'p');
    expect(p).toMatchObject({
      dependencies: ['setup'],
      teardown: 'down',
      grep: ['/@smoke/'],
      use: { browserName: 'webkit' },
    });
    expect(doc.projects.find((x) => x.id === 'setup')).not.toHaveProperty('grep');
  });
});

describe('unexpected shapes become warnings, not crashes', () => {
  it('skips a top-level suite that is not a project', () => {
    const { config, root } = fakeRoot([{ name: 'p', files: {} }], false);
    (root.suites[0] as unknown as { project: () => undefined }).project = () => undefined;
    const raw = extractRaw(config, root);
    expect(raw.projects).toEqual([]);
    expect(raw.warnings.map((w) => w.code)).toEqual(['unexpected-suite']);
  });
});
