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
  /** TestCase._only (default false). */
  only?: boolean;
  /** Overrides for internal fields, applied verbatim (to simulate absent or malformed ones). */
  raw?: Record<string, unknown>;
}

/** A test shaped like Playwright 1.42: no `type`. Newer versions add `type: 'test'`. */
const fakeTest = (
  t: FakeTest,
  titles: string[],
  file: string,
  modern: boolean,
  internals: boolean,
) =>
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
    ...(internals ? { _only: t.only ?? false, fn: async () => {} } : {}),
    ...t.raw,
  }) as unknown as TestCase;

interface FakeSuite {
  title: string;
  line?: number;
  children?: (FakeSuite | FakeTest)[];
  /** Suite._parallelMode (default 'none'). */
  mode?: string;
  /** Suite._tags: tags from the describe's `{ tag }` details. */
  ownTags?: string[];
  /** Suite._staticAnnotations. */
  ownAnnotations?: Record<string, unknown>[];
  raw?: Record<string, unknown>;
}

const isSuite = (c: FakeSuite | FakeTest): c is FakeSuite => 'children' in c;

function fakeSuite(
  s: FakeSuite,
  kind: string,
  depth: number,
  titles: string[],
  file: string,
  modern: boolean,
  internals: boolean,
): Suite {
  const kids = s.children ?? [];
  const innerTitles = kind === 'describe' ? [...titles, s.title] : titles;
  const suites = kids
    .filter(isSuite)
    .map((c) => fakeSuite(c, 'describe', depth + 1, innerTitles, file, modern, internals));
  const tests = kids
    .filter((c): c is FakeTest => !isSuite(c))
    .map((t) => fakeTest(t, innerTitles, file, modern, internals));
  const suite = {
    ...(modern ? { type: kind } : {}),
    title: s.title,
    location:
      s.line === undefined ? undefined : { file: `${BASE}/${file}`, line: s.line, column: 1 },
    suites,
    tests,
    allTests: (): TestCase[] => [...suites.flatMap((c) => c.allTests()), ...tests],
    ...(internals
      ? {
          _parallelMode: s.mode ?? 'none',
          _tags: s.ownTags ?? [],
          _staticAnnotations: s.ownAnnotations ?? [],
          _modifiers: [],
          _hooks: [],
        }
      : {}),
    ...s.raw,
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
  /** Config-level `tag`: newer Playwright puts it in every file suite's `_tags`. */
  fileTags?: string[];
  /** Overrides applied to every file suite of this project (e.g. `_modifiers`). */
  fileRaw?: Record<string, unknown>;
  files: Record<string, (FakeSuite | FakeTest)[]>;
}

function fakeRoot(
  projects: FakeProject[],
  modern: boolean,
  internals = true,
): { config: FullConfig; root: Suite } {
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
      fakeSuite(
        { title: file, line: undefined, children, ownTags: p.fileTags, raw: p.fileRaw },
        'file',
        2,
        [],
        file,
        modern,
        internals,
      ),
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
  const build = (projects: FakeProject[], internals = true) => {
    const { config, root } = fakeRoot(projects, modern, internals);
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
              title: 'ser',
              mode: 'serial',
              children: [
                {
                  title: 't',
                  annotations: [
                    ...(modern ? [{ type: 'serial' }] : []),
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

  it('reconstructs tag origin: title tokens, describe titles and describe { tag } details, deduping repeats', () => {
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'outer @d',
              ownTags: ['@viaDetails'],
              children: [
                {
                  title: 't @smoke',
                  // Playwright puts describe-title tokens and describe details tags on the test as well.
                  tags: ['@d', '@viaDetails', '@smoke', '@smoke', '@extra'],
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(doc.tests[0]?.tags).toEqual([
      { name: '@d', origin: 'describe' },
      { name: '@viaDetails', origin: 'describe' },
      { name: '@smoke', origin: 'title' },
      { name: '@extra', origin: 'details' },
    ]);
    expect(doc.describes[0]).toMatchObject({ tags: ['@viaDetails'] });
    expect(doc.warnings).toEqual([]);
  });

  it('gives config-level tags (file suite _tags) origin project, not describe', () => {
    const doc = build([
      {
        name: 'p',
        fileTags: ['@ci'],
        files: {
          // The file path itself contains an @token: it is not a describe title.
          'tests/@odd.spec.ts': [
            { title: 'top', tags: ['@ci'] },
            { title: 'g', children: [{ title: 't', tags: ['@ci', '@own'] }] },
          ],
        },
      },
    ]);
    const tagsOf = (title: string) => doc.tests.find((t) => t.title === title)?.tags;
    expect(tagsOf('top')).toEqual([{ name: '@ci', origin: 'project' }]);
    expect(tagsOf('t')).toEqual([
      { name: '@ci', origin: 'project' },
      { name: '@own', origin: 'details' },
    ]);
    expect(doc.warnings).toEqual([]);
  });

  it('reports describe mode (none -> default), own tags and own annotations', () => {
    const owner = { type: 'owner', description: 'team-a' };
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            { title: 'plain', children: [{ title: 't1' }] },
            { title: 'par', mode: 'parallel', children: [{ title: 't2' }] },
            {
              title: 'ser',
              mode: 'serial',
              ownAnnotations: [owner],
              children: [
                { title: 't3', annotations: modern ? [{ type: 'serial' }, owner] : [owner] },
              ],
            },
          ],
        },
      },
    ]);
    expect(doc.describes.map((d) => [d.title, d.mode])).toEqual([
      ['plain', 'default'],
      ['par', 'parallel'],
      ['ser', 'serial'],
    ]);
    expect(doc.describes[2]?.annotations).toEqual([{ ...owner, origin: 'describe' }]);
    expect(doc.warnings).toEqual([]);
  });

  it('splits inherited annotations (origin describe) from the test’s own and keeps the describe’s once', () => {
    const outer = { type: 'owner', description: 'team-a' };
    const inner = { type: 'issue', description: 'RBAC-7' };
    const own = { type: 'issue', description: 'RBAC-8' };
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'outer',
              ownAnnotations: [outer],
              children: [
                {
                  title: 'inner',
                  ownAnnotations: [inner],
                  children: [{ title: 't', annotations: [outer, inner, own] }],
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(doc.instances[0]?.annotations).toEqual([
      { ...outer, origin: 'describe' },
      { ...inner, origin: 'describe' },
      { ...own, origin: 'declaration' },
    ]);
    expect(doc.describes.map((d) => d.annotations.length)).toEqual([1, 1]);
    expect(doc.warnings).toEqual([]);
  });

  it('drops the synthetic serial marker only for a provably serial describe, keeping a user-declared serial', () => {
    const synthetic = { type: 'serial' };
    const user = { type: 'serial' };
    const owner = { type: 'owner', description: 'x' };
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'ser',
              mode: 'serial',
              ownAnnotations: [owner, user],
              // Newer Playwright: synthetic marker first, then the describe's own, then the test's own.
              children: [
                { title: 't', annotations: modern ? [synthetic, owner, user] : [owner, user] },
              ],
            },
            // Not serial: a description-less `serial` is the user's, not synthetic.
            {
              title: 'plain',
              ownAnnotations: [user],
              children: [{ title: 'u', annotations: [user] }],
            },
          ],
        },
      },
    ]);
    const byTitle = (t: string) =>
      doc.instances.find((i) => doc.tests.find((x) => x.id === i.testId)?.title === t);
    expect(byTitle('t')?.annotations).toEqual([
      { ...owner, origin: 'describe' },
      { ...user, origin: 'describe' },
    ]);
    expect(byTitle('u')?.annotations).toEqual([{ ...user, origin: 'describe' }]);
    expect(doc.warnings).toEqual([]);
  });

  it('keeps a user-declared serial on a nested serial describe (no marker on 1.42, markers on latest)', () => {
    const user = { type: 'serial' };
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'outer',
              mode: 'serial',
              children: [
                {
                  title: 'inner',
                  mode: 'serial',
                  ownAnnotations: [user],
                  children: [
                    {
                      title: 't',
                      annotations: modern ? [{ type: 'serial' }, { type: 'serial' }, user] : [user],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(doc.instances[0]?.annotations).toEqual([{ type: 'serial', origin: 'describe' }]);
    expect(doc.warnings).toEqual([]);
  });

  it('reads `only` from TestCase._only', () => {
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [{ title: 'focused', only: true }, { title: 'normal' }],
        },
      },
    ]);
    expect(doc.instances.map((i) => i.only)).toEqual([true, false]);
  });

  describe('when internals are unavailable', () => {
    const tree: FakeProject[] = [
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'g @d',
              mode: 'serial',
              ownTags: ['@viaDetails'],
              ownAnnotations: [{ type: 'owner', description: 'x' }],
              children: [
                {
                  title: 't',
                  tags: ['@d', '@viaDetails'],
                  annotations: [{ type: 'owner', description: 'x' }],
                  only: true,
                },
              ],
            },
          ],
        },
      },
    ];

    it('falls back to what the public API proves and warns once per field', () => {
      const doc = build(tree, false);
      expect(doc.describes[0]).toMatchObject({ mode: 'default', tags: [], annotations: [] });
      expect(doc.instances[0]?.only).toBeUndefined();
      expect(doc.instances[0]?.annotations).toEqual([
        { type: 'owner', description: 'x', origin: 'declaration' },
      ]);
      // Title tokens of describes are public; `{ tag }` details of a describe are not provable.
      expect(doc.tests[0]?.tags).toEqual([
        { name: '@d', origin: 'describe' },
        { name: '@viaDetails', origin: 'details' },
      ]);
      expect(
        doc.warnings.filter((w) => w.code === 'internal-field-unavailable').map((w) => w.where),
      ).toEqual([
        '_modifiers',
        '_hooks',
        '_parallelMode',
        '_tags',
        '_staticAnnotations',
        'fn',
        '_only',
      ]);
    });

    it('treats a malformed field as unavailable, per field, without throwing', () => {
      const bad = structuredClone(tree);
      const g = bad[0]!.files['tests/a.spec.ts']![0] as FakeSuite;
      g.raw = { _parallelMode: 'sideways', _tags: 'nope' };
      (g.children![0] as FakeTest).raw = { _only: 'yes' };
      const doc = build(bad);
      expect(doc.describes[0]).toMatchObject({ mode: 'default', tags: [] });
      // _staticAnnotations is still well-formed: the origin split still works.
      expect(doc.describes[0]?.annotations).toHaveLength(1);
      expect(doc.instances[0]?.only).toBeUndefined();
      expect(
        doc.warnings.filter((w) => w.code === 'internal-field-unavailable').map((w) => w.where),
      ).toEqual(['_parallelMode', '_tags', '_only']);
    });

    it('does not split annotations when the inherited prefix is not in the expected order', () => {
      const doc = build([
        {
          name: 'p',
          files: {
            'tests/a.spec.ts': [
              {
                title: 'g',
                ownAnnotations: [{ type: 'owner', description: 'x' }],
                children: [{ title: 't', annotations: [{ type: 'other' }] }],
              },
            ],
          },
        },
      ]);
      expect(doc.instances[0]?.annotations).toEqual([{ type: 'other', origin: 'declaration' }]);
      expect(doc.warnings.map((w) => w.code)).toContain('annotation-inheritance-mismatch');
    });
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

describe('review fixes', () => {
  it('names the unnamed project and strips secrets from baseURL', () => {
    const { config, root } = fakeRoot(
      [{ name: '', use: { baseURL: 'https://u:tok@staging.example.com/app?k=1#x' }, files: {} }],
      false,
    );
    const doc = extractDocument(config, root, GEN);
    expect(doc.projects[0]).toMatchObject({
      id: 'default',
      name: 'default',
      use: { baseURL: 'https://staging.example.com/app' },
    });
  });

  it.each(['admin:hunter2@staging.local:8080', 'ftp://h/x', 'not a url'])(
    'does not serialise unsafe baseURL %s',
    (baseURL) => {
      const { config, root } = fakeRoot([{ name: 'p', use: { baseURL }, files: {} }], false);
      const doc = extractDocument(config, root, GEN);
      expect(JSON.stringify(doc)).not.toContain('hunter2');
      expect(doc.projects[0]).not.toHaveProperty('use');
    },
  );

  it('keeps user-declared serial annotations when the describe is provably not serial', () => {
    const { config, root } = fakeRoot(
      [
        {
          name: 'p',
          files: {
            'tests/a.spec.ts': [
              {
                title: 't',
                annotations: [{ type: 'serial' }, { type: 'serial', description: 'mine' }],
              },
            ],
          },
        },
      ],
      false,
    );
    const doc = extractDocument(config, root, GEN);
    expect(doc.instances[0]?.annotations).toEqual([
      { type: 'serial', origin: 'declaration' },
      { type: 'serial', description: 'mine', origin: 'declaration' },
    ]);
  });

  it('without internals, still drops a description-less serial and keeps one with a description', () => {
    const { config, root } = fakeRoot(
      [
        {
          name: 'p',
          files: {
            'tests/a.spec.ts': [
              {
                title: 't',
                annotations: [{ type: 'serial' }, { type: 'serial', description: 'mine' }],
              },
            ],
          },
        },
      ],
      false,
      false,
    );
    const doc = extractDocument(config, root, GEN);
    expect(doc.instances[0]?.annotations).toEqual([
      { type: 'serial', description: 'mine', origin: 'declaration' },
    ]);
  });
});

describe('conditionals', () => {
  const loc = (line: number) => ({ file: `${BASE}/tests/a.spec.ts`, line, column: 1 });
  // Real functions whose toString() is the given source, like the ones Playwright loads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;
  const fnFrom = (params: string, body: string) => new AsyncFunction(params, body) as () => void;
  // A native function: its source is "function () { [native code] }", which cannot be parsed.
  const native = () => (() => {}).bind(null);
  const build = (projects: FakeProject[], modern = false) => {
    const { config, root } = fakeRoot(projects, modern);
    return extractDocument(config, root, GEN);
  };
  const tree = (over: Partial<FakeProject> = {}, tests: FakeTest[] = []): FakeProject => ({
    name: 'p',
    files: {
      'tests/a.spec.ts': [
        { title: 'g', line: 2, children: [{ title: 't', line: 3, ...tests[0] }] },
      ],
    },
    ...over,
  });

  it('attaches file modifiers, describe hooks and test bodies to their scopes', () => {
    const g: FakeSuite = {
      title: 'g',
      line: 2,
      raw: {
        _hooks: [
          {
            type: 'beforeEach',
            location: loc(4),
            fn: async ({ browserName }: { browserName: string }) => browserName,
          },
        ],
      },
      children: [
        {
          title: 't',
          line: 3,
          raw: {
            fn: async () => {
              /* test.skip(true) */
            },
          },
        },
      ],
    };
    const doc = build([
      {
        name: 'p',
        fileRaw: {
          _modifiers: [
            { type: 'skip', description: 'why', location: loc(1), fn: () => process.env.X },
          ],
        },
        files: { 'tests/a.spec.ts': [g] },
      },
    ]);
    expect(doc.conditionals).toMatchObject([
      {
        type: 'skip',
        form: 'file-callback',
        condition: 'process.env.X',
        refs: ['process.env.X'],
        reason: 'why',
        scope: { fileId: 'tests/a.spec.ts' },
        source: 'reporter',
        confidence: 'inferred',
      },
    ]);
  });

  it('wires a hook and a test body through to scope and form', () => {
    const hookFn = fnFrom('{ b }', '_test.test.skip(b === 1, "r");');
    const bodyFn = fnFrom('', '_test.test.info().annotations.push({ type: "x" });');
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            {
              title: 'g',
              line: 2,
              raw: { _hooks: [{ type: 'beforeEach', location: loc(4), fn: hookFn }] },
              children: [{ title: 't', line: 3, raw: { fn: bodyFn } }],
            },
          ],
        },
      },
    ]);
    expect(doc.conditionals).toMatchObject([
      // Sorted by source position: the test (line 3) before its describe's hook (line 4).
      {
        type: 'x',
        form: 'runtime-push',
        scope: { testId: 'tests/a.spec.ts › g › t' },
        confidence: 'static',
      },
      {
        type: 'skip',
        form: 'hook',
        scope: { describeId: 'tests/a.spec.ts › g' },
        confidence: 'static',
        source: 'scan',
      },
    ]);
  });

  it('lists a conditional once when the file is in several projects, and resolves project.name', () => {
    const fn = fnFrom('{}, ti', '_test.test.skip(ti.project.name === "b", "r");');
    const files = () => ({
      'tests/a.spec.ts': [{ title: 't', line: 3, raw: { fn } } as FakeTest],
    });
    const doc = build([
      { name: 'a', files: files() },
      { name: 'b', files: files() },
    ]);
    expect(doc.conditionals).toHaveLength(1);
    expect(doc.conditionals[0]).toMatchObject({ appliesToProjects: ['b'], confidence: 'static' });
  });

  it('an unparseable function warns once and becomes one opaque conditional of unknown type', () => {
    const bad = native();
    const doc = build([
      {
        name: 'a',
        files: { 'tests/a.spec.ts': [{ title: 't', line: 3, raw: { fn: bad } } as FakeTest] },
      },
      {
        name: 'b',
        files: { 'tests/a.spec.ts': [{ title: 't', line: 3, raw: { fn: bad } } as FakeTest] },
      },
    ]);
    expect(doc.conditionals).toMatchObject([
      {
        type: 'unknown',
        form: 'body',
        confidence: 'opaque',
        source: 'scan',
        refs: [],
        scope: { testId: 'tests/a.spec.ts › t' },
      },
    ]);
    expect(doc.conditionals[0]!.condition).toBeUndefined();
    expect(doc.warnings.filter((w) => w.code === 'conditional-parse-failed')).toHaveLength(1);
  });

  it('an unparseable modifier keeps its type and reason', () => {
    const bad = native();
    const doc = build([
      tree({
        fileRaw: { _modifiers: [{ type: 'fixme', description: 'why', location: loc(1), fn: bad }] },
      }),
    ]);
    expect(doc.conditionals).toMatchObject([
      {
        type: 'fixme',
        form: 'file-callback',
        reason: 'why',
        confidence: 'opaque',
        source: 'reporter',
      },
    ]);
    expect(doc.warnings.map((w) => w.code)).toContain('conditional-parse-failed');
  });

  it("compares project.name with the raw name: the unnamed project matches ''", () => {
    const fn = fnFrom('{}, ti', '_test.test.skip(ti.project.name === "", "r");');
    const doc = build([
      {
        name: '',
        files: { 'tests/a.spec.ts': [{ title: 't', line: 3, raw: { fn } } as FakeTest] },
      },
    ]);
    expect(doc.conditionals[0]?.appliesToProjects).toEqual(['default']);
  });

  it('attaches a hook to the right one of two describes with the same title', () => {
    const hook = fnFrom('{ b }', '_test.test.skip(b === 1);');
    const doc = build([
      {
        name: 'p',
        files: {
          'tests/a.spec.ts': [
            { title: 'g', line: 2, children: [{ title: 't1', line: 3 }] },
            {
              title: 'g',
              line: 6,
              raw: { _hooks: [{ type: 'beforeEach', location: loc(7), fn: hook }] },
              children: [{ title: 't2', line: 8 }],
            },
          ],
        },
      },
    ]);
    expect(doc.conditionals).toMatchObject([{ scope: { describeId: 'tests/a.spec.ts › g#2' } }]);
    expect(doc.warnings).toEqual([]);
  });

  it('missing fields warn once each and the rest of the extraction is unaffected', () => {
    const { config, root } = fakeRoot([tree()], false, false);
    const doc = extractDocument(config, root, GEN);
    expect(doc.conditionals).toEqual([]);
    const fields = doc.warnings
      .filter((w) => w.code === 'internal-field-unavailable')
      .map((w) => w.where);
    expect(fields).toEqual(expect.arrayContaining(['_modifiers', '_hooks', 'fn']));
    expect(new Set(fields).size).toBe(fields.length);
    expect(doc.tests).toHaveLength(1);
  });
});
