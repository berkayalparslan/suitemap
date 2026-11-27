// Turns Playwright's suite tree (from Reporter.onBegin) into the framework-neutral RawExtraction.
//
// Public Reporter API fields only. Anything that needs Playwright internals (_staticAnnotations,
// _tags, _only, _parallelMode, _modifiers, _hooks, TestCase.fn) is a TODO for the internals PR:
// those schema fields are left empty (never guessed) and a warning tells consumers so.
import path from 'node:path';
import {
  buildDocument,
  validateDocument,
  type Annotation,
  type BuildOptions,
  type Project,
  type RawDescribe,
  type RawExtraction,
  type RawFile,
  type RawNode,
  type RawProjectSuite,
  type RawTest,
  type SuitemapDocument,
  type TagRef,
  type Warning,
} from '@suitemap/core';
import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';

// `FullProject` is not exported by the 1.42 reporter types.
type FullProject = NonNullable<ReturnType<Suite['project']>>;

/** `use` keys that are safe to serialise (ADR 0004 decision 9). No env values, no storage state. */
const USE_ALLOW_LIST = ['browserName', 'viewport', 'baseURL', 'channel', 'headless'] as const;

type SuiteKind = 'root' | 'project' | 'file' | 'describe';

/**
 * `Suite.type` is missing on Playwright 1.42, so the kind is inferred from depth
 * (root > project > file > describe). The API value wins when it is a known kind.
 */
function suiteKind(suite: Suite, depth: number): SuiteKind {
  const api = (suite as { type?: unknown }).type;
  if (api === 'root' || api === 'project' || api === 'file' || api === 'describe') return api;
  return depth === 0 ? 'root' : depth === 1 ? 'project' : depth === 2 ? 'file' : 'describe';
}

/**
 * Children in declaration order. `Suite.entries()` gives that where it exists; on 1.42 it does not,
 * so suites and tests are merged and ordered by source position (stable for equal positions).
 */
function entriesOf(suite: Suite): (Suite | TestCase)[] {
  const entries = (suite as { entries?: () => (Suite | TestCase)[] }).entries;
  if (typeof entries === 'function') return entries.call(suite);
  const merged = [...suite.suites, ...suite.tests];
  if (merged.some((e) => e.location === undefined)) return merged;
  return merged.sort(
    (a, b) => a.location!.line - b.location!.line || a.location!.column - b.location!.column,
  );
}

// `TestCase.type` does not exist on 1.42; only suites have a `suites` array.
const isTest = (e: Suite | TestCase): e is TestCase => !Array.isArray((e as Suite).suites);

const regexSources = (value: RegExp | RegExp[] | null | undefined): string[] | undefined => {
  if (value === null || value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : [value]).map((r) => r.toString());
  // Playwright's default grep is /.*/ ("match everything"): not worth serialising.
  return list.length === 1 && list[0] === '/.*/' ? undefined : list;
};

const TITLE_TAG = /@\S+/g;
const tagTokens = (title: string) => title.match(TITLE_TAG) ?? [];

export interface ExtractionContext {
  /** Directory paths are made relative to: the config file's directory. */
  baseDir: string;
  warnings: Warning[];
  /** Warning codes already emitted once. */
  flags: Set<string>;
}

const warnOnce = (ctx: ExtractionContext, code: string, message: string) => {
  if (ctx.flags.has(code)) return;
  ctx.flags.add(code);
  ctx.warnings.push({ code, message });
};

const relPath = (ctx: ExtractionContext, p: string) =>
  path.relative(ctx.baseDir, p).split(path.sep).join('/');

function toProject(ctx: ExtractionContext, p: FullProject): Project {
  const use: Record<string, unknown> = {};
  const rawUse = (p.use ?? {}) as Record<string, unknown>;
  for (const key of USE_ALLOW_LIST) if (rawUse[key] !== undefined) use[key] = rawUse[key];
  const grep = regexSources(p.grep);
  const grepInvert = regexSources(p.grepInvert);
  return {
    id: p.name,
    name: p.name,
    dependencies: [...p.dependencies],
    ...(p.teardown === undefined ? {} : { teardown: p.teardown }),
    testDir: relPath(ctx, p.testDir) || '.',
    ...(grep === undefined ? {} : { grep }),
    ...(grepInvert === undefined ? {} : { grepInvert }),
    ...(Object.keys(use).length === 0 ? {} : { use }),
  };
}

/** Test tags with origin. Public fields only: see the TODO on `details` below. */
function toTags(ctx: ExtractionContext, t: TestCase, describeTitles: string[]): TagRef[] {
  const fromTitle = new Set(tagTokens(t.title));
  const fromDescribes = new Set(describeTitles.flatMap(tagTokens));
  const out: TagRef[] = [];
  const seen = new Set<string>();
  for (const name of t.tags) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (fromTitle.has(name)) out.push({ name, origin: 'title' });
    else if (fromDescribes.has(name)) out.push({ name, origin: 'describe' });
    else {
      // TODO(internals PR): describe-level `{ tag }` details are indistinguishable from the test's own
      // `{ tag }` details here; the describe's own tags are on the internal `_tags`.
      out.push({ name, origin: 'details' });
      if (describeTitles.length > 0)
        warnOnce(
          ctx,
          'tag-origin-approximate',
          'Tags declared in test.describe details cannot be told apart from the test’s own details tags without Playwright internals; both are reported with origin "details" for tests inside a describe.',
        );
    }
  }
  return out;
}

/** Annotations as Playwright reports them for this test. */
function toAnnotations(t: TestCase): Annotation[] {
  return (
    t.annotations
      // Playwright (newer versions only) adds a synthetic { type: 'serial' } to tests in a serial
      // describe. Describe mode is the source of truth, so drop it for a stable cross-version output.
      .filter((a) => a.type !== 'serial')
      // TODO(internals PR): split inherited describe annotations (origin "describe") from the test's
      // own (origin "declaration") using the describe's internal `_staticAnnotations`.
      .map((a) => ({
        type: a.type,
        ...(a.description === undefined ? {} : { description: a.description }),
        origin: 'declaration' as const,
      }))
  );
}

function toTest(ctx: ExtractionContext, t: TestCase, describeTitles: string[]): RawTest {
  return {
    kind: 'test',
    title: t.title,
    location: {
      file: relPath(ctx, t.location.file),
      line: t.location.line,
      column: t.location.column,
    },
    tags: toTags(ctx, t, describeTitles),
    annotations: toAnnotations(t),
    expectedStatus: t.expectedStatus,
    timeout: t.timeout,
    retries: t.retries,
    repeatEachIndex: t.repeatEachIndex,
    nativeId: t.id,
    // TODO(internals PR): `only` from the internal `_only`.
  };
}

function toNodes(ctx: ExtractionContext, suite: Suite, depth: number, titles: string[]): RawNode[] {
  const nodes: RawNode[] = [];
  for (const entry of entriesOf(suite)) {
    if (isTest(entry)) nodes.push(toTest(ctx, entry, titles));
    else {
      const describe: RawDescribe = {
        kind: 'describe',
        title: entry.title,
        // TODO(internals PR): `mode` from the internal `_parallelMode` ('none' -> 'default').
        mode: 'default',
        // TODO(internals PR): the describe's own tags/annotations from `_tags` / `_staticAnnotations`.
        tags: [],
        annotations: [],
        children: toNodes(ctx, entry, depth + 1, [...titles, entry.title]),
      };
      nodes.push(describe);
      warnOnce(
        ctx,
        'describe-internals-unavailable',
        'Describe mode, own tags and own annotations are not in the public Reporter API; describes are reported with mode "default" and no tags or annotations until the internals reader lands.',
      );
    }
  }
  return nodes;
}

function fileOf(suite: Suite): string | undefined {
  if (suite.location?.file) return suite.location.file;
  return suite.allTests()[0]?.location.file;
}

export function extractRaw(config: FullConfig, root: Suite): RawExtraction {
  const ctx: ExtractionContext = {
    baseDir: config.configFile ? path.dirname(config.configFile) : config.rootDir,
    warnings: [],
    flags: new Set(),
  };

  const projects: RawProjectSuite[] = [];
  for (const projectSuite of root.suites) {
    // The root's children are project suites; anything else is a shape this version did not promise.
    const project = suiteKind(projectSuite, 1) === 'project' ? projectSuite.project() : undefined;
    if (!project) {
      ctx.warnings.push({
        code: 'unexpected-suite',
        message: `Skipped a top-level suite that is not a project: "${projectSuite.title}".`,
      });
      continue;
    }
    const files: RawFile[] = [];
    for (const fileSuite of projectSuite.suites) {
      const file = fileOf(fileSuite);
      if (file === undefined) {
        ctx.warnings.push({
          code: 'file-without-location',
          message: `Skipped file suite "${fileSuite.title}" in project "${project.name}": no location.`,
        });
        continue;
      }
      files.push({ path: relPath(ctx, file), children: toNodes(ctx, fileSuite, 3, []) });
    }
    projects.push({ project: toProject(ctx, project), files });
  }

  return {
    framework: 'playwright',
    frameworkVersion: config.version,
    configFile: config.configFile ? relPath(ctx, config.configFile) : '',
    rootDir: ctx.baseDir,
    projects,
    // TODO(internals PR): conditionals from `_modifiers`, `_hooks` and `TestCase.fn` (ADR 0004).
    conditionals: [],
    warnings: ctx.warnings,
  };
}

/** Raw extraction -> validated document. Throws if the result violates the schema (a bug, not user error). */
export function extractDocument(
  config: FullConfig,
  root: Suite,
  options: BuildOptions = {},
): SuitemapDocument {
  const result = validateDocument(buildDocument(extractRaw(config, root), options));
  if (!result.ok)
    throw new Error(`Extracted document failed validation:\n${result.issues.join('\n')}`);
  return result.document;
}
