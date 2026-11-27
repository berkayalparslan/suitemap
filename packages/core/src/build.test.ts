import { describe, expect, it } from 'vitest';
import { buildDocument, validateDocument, type RawExtraction, type RawTest } from './index.js';

const GEN = '2026-01-01T00:00:00.000Z';

const test = (title: string, over: Partial<RawTest> = {}): RawTest => ({
  kind: 'test',
  title,
  location: { file: 'x', line: 1, column: 1 },
  tags: [],
  annotations: [],
  expectedStatus: 'passed',
  timeout: 30000,
  retries: 0,
  repeatEachIndex: 0,
  ...over,
});

const project = (id: string, dependencies: string[] = []) => ({
  id,
  name: id,
  dependencies,
  testDir: 'tests',
});

function raw(over: Partial<RawExtraction> = {}): RawExtraction {
  return {
    framework: 'playwright',
    frameworkVersion: '1.42.1',
    configFile: 'playwright.config.ts',
    rootDir: '/repo',
    projects: [],
    conditionals: [],
    warnings: [],
    ...over,
  };
}

const twoProjects = (): RawExtraction =>
  raw({
    projects: [
      {
        project: project('webkit'),
        files: [
          {
            path: 'tests/auth/login.spec.ts',
            children: [
              {
                kind: 'describe',
                title: 'Login',
                mode: 'serial',
                tags: ['@auth'],
                annotations: [{ type: 'slow', origin: 'describe' }],
                children: [
                  test('works', {
                    tags: [
                      { name: '@auth', origin: 'describe' },
                      { name: '@smoke', origin: 'title' },
                    ],
                    annotations: [
                      { type: 'slow', origin: 'describe' },
                      { type: '_internal', origin: 'declaration' },
                    ],
                  }),
                ],
              },
            ],
          },
        ],
      },
      {
        project: project('chromium', ['setup']),
        files: [
          {
            path: 'tests/auth/login.spec.ts',
            children: [
              {
                kind: 'describe',
                title: 'Login',
                mode: 'serial',
                tags: ['@auth'],
                annotations: [{ type: 'slow', origin: 'describe' }],
                children: [
                  test('works', {
                    nativeId: 'abc',
                    tags: [
                      { name: '@auth', origin: 'describe' },
                      { name: '@smoke', origin: 'title' },
                    ],
                    annotations: [
                      { type: 'slow', origin: 'describe' },
                      { type: 'fixme', description: 'JIRA-1', origin: 'declaration' },
                    ],
                    expectedStatus: 'skipped',
                  }),
                ],
              },
            ],
          },
        ],
      },
      { project: project('setup'), files: [] },
    ],
  });

describe('buildDocument', () => {
  const doc = buildDocument(twoProjects(), { generatedAt: GEN });

  it('merges one test across projects into one Test and one instance per project', () => {
    expect(doc.tests).toHaveLength(1);
    expect(doc.tests[0]!.id).toBe('tests/auth/login.spec.ts › Login › works');
    expect(doc.instances.map((i) => i.id)).toEqual([
      'tests/auth/login.spec.ts › Login › works [chromium#0]',
      'tests/auth/login.spec.ts › Login › works [webkit#0]',
    ]);
    expect(doc.instances[0]!.playwrightId).toBe('abc');
    expect(doc.instances[0]!.expectedStatus).toBe('skipped');
  });

  it('is independent of project order', () => {
    const r = twoProjects();
    r.projects.reverse();
    expect(buildDocument(r, { generatedAt: GEN })).toEqual(doc);
  });

  it('creates the folder chain, rooted at "."', () => {
    expect(doc.folders.map((f) => [f.id, f.parentId])).toEqual(
      [
        ['tests', '.'],
        ['tests/auth', 'tests'],
        ['.', undefined],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(doc.files[0]).toEqual({
      id: 'tests/auth/login.spec.ts',
      path: 'tests/auth/login.spec.ts',
      folderId: 'tests/auth',
    });
  });

  it('keeps one describe with its own tags and annotations', () => {
    expect(doc.describes).toEqual([
      {
        id: 'tests/auth/login.spec.ts › Login',
        title: 'Login',
        fileId: 'tests/auth/login.spec.ts',
        mode: 'serial',
        tags: ['@auth'],
        annotations: [{ type: 'slow', origin: 'describe' }],
      },
    ]);
    expect(doc.tests[0]!.describeId).toBe(doc.describes[0]!.id);
  });

  it('counts distinct tests per tag and annotation type; flags built-ins and hidden', () => {
    expect(doc.tags).toEqual([
      { name: '@auth', testCount: 1 },
      { name: '@smoke', testCount: 1 },
    ]);
    expect(doc.annotationTypes).toEqual([
      { type: '_internal', builtIn: false, testCount: 1 },
      { type: 'fixme', builtIn: true, testCount: 1 },
      { type: 'slow', builtIn: true, testCount: 1 },
    ]);
    const hidden = doc.instances
      .flatMap((i) => i.annotations)
      .filter((a) => a.type === '_internal');
    expect(hidden).toEqual([{ type: '_internal', origin: 'declaration', hidden: true }]);
  });

  it('keeps repeatEach runs as separate instances of one test', () => {
    const r = raw({
      projects: [
        {
          project: project('p'),
          files: [
            {
              path: 'a.spec.ts',
              children: [test('t', { repeatEachIndex: 0 }), test('t', { repeatEachIndex: 1 })],
            },
          ],
        },
      ],
    });
    const d = buildDocument(r, { generatedAt: GEN });
    expect(d.tests).toHaveLength(1);
    expect(d.instances.map((i) => i.id)).toEqual(['a.spec.ts › t [p#0]', 'a.spec.ts › t [p#1]']);
  });

  it('warns and drops a colliding instance instead of throwing', () => {
    const r = raw({
      projects: [
        { project: project('p'), files: [{ path: 'a.spec.ts', children: [test('t'), test('t')] }] },
      ],
    });
    const d = buildDocument(r, { generatedAt: GEN });
    expect(d.instances).toHaveLength(1);
    expect(d.warnings.map((w) => w.code)).toEqual(['duplicate-instance']);
  });

  it('warns when a describe has different modes across projects', () => {
    const mk = (id: string, mode: 'serial' | 'parallel') => ({
      project: project(id),
      files: [
        {
          path: 'a.spec.ts',
          children: [
            {
              kind: 'describe' as const,
              title: 'D',
              mode,
              tags: [],
              annotations: [],
              children: [test('t')],
            },
          ],
        },
      ],
    });
    const d = buildDocument(raw({ projects: [mk('a', 'serial'), mk('b', 'parallel')] }), {
      generatedAt: GEN,
    });
    expect(d.describes[0]!.mode).toBe('serial');
    expect(d.warnings.map((w) => w.code)).toEqual(['describe-mode-differs']);
  });

  it('resolves conditional scopes to ids and degrades with a warning when it cannot', () => {
    const r = twoProjects();
    const loc = (line: number) => ({ file: 'tests/auth/login.spec.ts', line, column: 3 });
    r.conditionals = [
      {
        type: 'skip',
        form: 'body',
        condition: "browserName === 'webkit'",
        refs: ['browserName'],
        location: loc(10),
        scope: { file: 'tests/auth/login.spec.ts', testTitlePath: ['Login', 'works'] },
        appliesToProjects: ['webkit'],
        source: 'scan',
        confidence: 'static',
      },
      {
        type: 'fixme',
        form: 'describe-callback',
        refs: [],
        location: loc(5),
        scope: { file: 'tests/auth/login.spec.ts', describePath: ['Login'] },
        appliesToProjects: 'unknown',
        source: 'reporter',
        confidence: 'inferred',
      },
      {
        type: 'skip',
        form: 'body',
        refs: [],
        location: loc(20),
        scope: { file: 'tests/auth/login.spec.ts', testTitlePath: ['Login', 'gone'] },
        appliesToProjects: 'unknown',
        source: 'scan',
        confidence: 'opaque',
      },
      {
        type: 'skip',
        form: 'file-callback',
        refs: [],
        location: { file: 'nope.spec.ts', line: 1, column: 1 },
        scope: { file: 'nope.spec.ts' },
        appliesToProjects: 'unknown',
        source: 'reporter',
        confidence: 'opaque',
      },
    ];
    const d = buildDocument(r, { generatedAt: GEN });
    expect(d.conditionals.map((c) => c.scope)).toEqual([
      { describeId: 'tests/auth/login.spec.ts › Login' },
      { testId: 'tests/auth/login.spec.ts › Login › works' },
      { fileId: 'tests/auth/login.spec.ts' },
    ]);
    expect(d.warnings.map((w) => w.code).sort()).toEqual([
      'conditional-unknown-file',
      'conditional-unknown-test',
    ]);
    expect(validateDocument(d).ok).toBe(true);
  });

  it('produces a document that validates', () => {
    const res = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(res.ok).toBe(true);
  });
});

describe('validateDocument', () => {
  const doc = buildDocument(twoProjects(), { generatedAt: GEN });

  it('rejects the wrong shape with readable paths', () => {
    const bad = { ...doc, schemaVersion: 2 };
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]).toContain('schemaVersion');
  });

  it('rejects dangling references', () => {
    const bad = structuredClone(doc);
    bad.instances[0]!.projectId = 'nope';
    const res = validateDocument(bad);
    expect(res).toEqual({
      ok: false,
      issues: [expect.stringContaining('unknown reference "nope"')],
    });
  });

  it('rejects duplicate ids', () => {
    const bad = structuredClone(doc);
    bad.tests.push(bad.tests[0]!);
    const res = validateDocument(bad);
    expect(res.ok).toBe(false);
  });
});
