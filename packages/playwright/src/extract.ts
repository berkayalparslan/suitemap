// Turns Playwright's suite tree (from Reporter.onBegin) into the framework-neutral RawExtraction.
//
// Public Reporter API plus the describe/test internals read through ./internals.ts (the only module
// that touches underscore fields). When an internal field is missing or malformed the dependent schema
// field falls back to what the public API can prove, and a warning says so (one per field).
// Conditionals come from `_modifiers`, `_hooks` and `TestCase.fn` source text, scanned by ./scan.ts.
import path from 'node:path';
import {
  buildDocument,
  validateDocument,
  type Annotation,
  type BuildOptions,
  type Project,
  type RawExtraction,
  type RawConditional,
  type RawFile,
  type RawNode,
  type RawProjectSuite,
  type RawTest,
  type SuitemapDocument,
  type TagRef,
  type Warning,
} from '@suitemap/core';
import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';
import {
  readParallelMode,
  readSuiteAnnotations,
  readSuiteHooks,
  readSuiteModifiers,
  readSuiteTags,
  readTestFn,
  readTestOnly,
  type DescribeMode,
  type StaticAnnotation,
} from './internals.js';
import { scanFunctionBody, scanModifierCallback, UNKNOWN_TYPE, type Finding } from './scan.js';

// `FullProject` is not exported by the 1.42 reporter types.
type FullProject = NonNullable<ReturnType<Suite['project']>>;

/** `use` keys that are safe to serialise (ADR 0004 decision 9). No env values, no storage state. */
const USE_ALLOW_LIST = ['browserName', 'viewport', 'baseURL', 'channel', 'headless'] as const;

/** Id and name given to Playwright's unnamed project. */
const DEFAULT_PROJECT = 'default';

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
    (a, b) =>
      (a.location!.file < b.location!.file ? -1 : a.location!.file > b.location!.file ? 1 : 0) ||
      a.location!.line - b.location!.line ||
      a.location!.column - b.location!.column,
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

/**
 * Keeps only http(s) base URLs, without userinfo, query or fragment (they can carry credentials or
 * tokens). Anything else, including scheme-less `user:secret@host`, is not serialised.
 */
function safeBaseUrl(value: string): string | undefined {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return undefined;
  }
}

export interface ExtractionContext {
  /** Directory paths are made relative to: the config file's directory. */
  baseDir: string;
  warnings: Warning[];
  /** Warning codes already emitted once. */
  flags: Set<string>;
  /** Whether this Playwright version adds a synthetic `serial` annotation; undefined until learned. */
  syntheticSerial?: boolean;
  /** Findings so far, de-duplicated: the same file is listed once per project it belongs to. */
  conditionals: RawConditional[];
  conditionalKeys: Set<string>;
  /** Project names that exist, to resolve `project.name` comparisons. */
  projectNames: string[];
}

const warnOnce = (ctx: ExtractionContext, code: string, message: string, where?: string) => {
  const key = where === undefined ? code : `${code}:${where}`;
  if (ctx.flags.has(key)) return;
  ctx.flags.add(key);
  ctx.warnings.push({ code, message, ...(where === undefined ? {} : { where }) });
};

/** What the extractor reports instead, per internal field it could not read. */
const FALLBACK: Record<string, string> = {
  _parallelMode:
    'describe mode is reported as "default" and the synthetic serial annotation is filtered by shape',
  _tags:
    'describe-level tags are not reported and tags declared in describe details get origin "details"',
  _staticAnnotations:
    'describe-level annotations are not reported and inherited annotations keep origin "declaration"',
  _only: 'the `only` flag is not reported',
  _modifiers: 'describe- and file-level conditionals are not reported',
  _hooks: 'conditionals inside hooks are not reported',
  fn: 'conditionals and runtime annotations inside test bodies are not reported',
};

/** Warning for an internal field that is missing or has an unexpected shape (once per field). */
const internalsReport = (ctx: ExtractionContext) => (field: string, message: string) =>
  warnOnce(
    ctx,
    'internal-field-unavailable',
    `${message}; ${FALLBACK[field] ?? 'dependent data is not reported'}.`,
    field,
  );

/** What was read from one enclosing suite (file or describe); `undefined` = unavailable. */
interface SuiteInfo {
  title: string;
  mode: DescribeMode | undefined;
  tags: string[] | undefined;
  annotations: StaticAnnotation[] | undefined;
}

function readSuiteInfo(ctx: ExtractionContext, suite: Suite): SuiteInfo {
  const report = internalsReport(ctx);
  return {
    title: suite.title,
    mode: readParallelMode(suite, report),
    tags: readSuiteTags(suite, report),
    annotations: readSuiteAnnotations(suite, report),
  };
}

const relPath = (ctx: ExtractionContext, p: string) =>
  path.relative(ctx.baseDir, p).split(path.sep).join('/');

function toProject(ctx: ExtractionContext, p: FullProject): Project {
  const use: Record<string, unknown> = {};
  const rawUse = (p.use ?? {}) as Record<string, unknown>;
  for (const key of USE_ALLOW_LIST) if (rawUse[key] !== undefined) use[key] = rawUse[key];
  if (typeof use.baseURL === 'string') {
    const safe = safeBaseUrl(use.baseURL);
    if (safe === undefined) delete use.baseURL;
    else use.baseURL = safe;
  }
  const grep = regexSources(p.grep);
  const grepInvert = regexSources(p.grepInvert);
  // A config without named projects yields one project whose name is ''.
  const name = p.name === '' ? DEFAULT_PROJECT : p.name;
  return {
    id: name,
    name,
    dependencies: [...p.dependencies],
    ...(p.teardown === undefined ? {} : { teardown: p.teardown }),
    testDir: relPath(ctx, p.testDir) || '.',
    ...(grep === undefined ? {} : { grep }),
    ...(grepInvert === undefined ? {} : { grepInvert }),
    ...(Object.keys(use).length === 0 ? {} : { use }),
  };
}

/**
 * Test tags with origin: `title` (an @token in the test title), `describe` (declared in an enclosing
 * describe's `{ tag }` details, or an @token in an enclosing describe title), `project` (config-level
 * `tag`, which newer Playwright copies into every file suite's `_tags`), otherwise `details`.
 * `chain` is the enclosing file suite followed by describes, outermost first; the file suite's title
 * is a path and its tags are config tags, so neither counts as a describe.
 */
function toTags(t: TestCase, chain: SuiteInfo[]): TagRef[] {
  const [file, ...describes] = chain;
  const fromTitle = new Set(tagTokens(t.title));
  const fromDescribes = new Set([
    ...describes.flatMap((c) => tagTokens(c.title)),
    ...describes.flatMap((c) => c.tags ?? []),
  ]);
  const fromConfig = new Set(file?.tags ?? []);
  const out: TagRef[] = [];
  const seen = new Set<string>();
  for (const name of t.tags) {
    if (seen.has(name)) continue;
    seen.add(name);
    const origin = fromTitle.has(name)
      ? 'title'
      : fromDescribes.has(name)
        ? 'describe'
        : fromConfig.has(name)
          ? 'project'
          : 'details';
    out.push({ name, origin });
  }
  return out;
}

const sameAnnotation = (a: { type: string; description?: string }, b: StaticAnnotation) =>
  a.type === b.type && a.description === b.description;

/**
 * Splits `test.annotations` into inherited (origin "describe") and own (origin "declaration").
 *
 * Playwright builds the list outermost-first: for each enclosing suite, its `_staticAnnotations`,
 * preceded, on versions that have it, by a synthetic description-less `{ type: 'serial' }` when the
 * suite is serial; the test's own annotations come last. Whether the marker exists is a property of the
 * Playwright version, not of the suite, so one interpretation (markers or no markers) is applied to all
 * enclosing suites of a test. It is learned from the first test where only one interpretation fits
 * (`ctx.syntheticSerial`); where both fit, markers are assumed (a user-declared `serial` among the
 * test's own annotations is the only case this can get wrong, and only before the version is learned).
 * Markers are dropped; they are not something the user declared.
 *
 * If no interpretation fits (or a field is unavailable) nothing is split: all annotations are
 * "declaration" and only a description-less `serial` is dropped, as before.
 */
function toAnnotations(ctx: ExtractionContext, t: TestCase, chain: SuiteInfo[]): Annotation[] {
  type Raw = { type: string; description?: string };
  const all = t.annotations as Raw[];
  const make = (a: Raw, origin: Annotation['origin']): Annotation => ({
    type: a.type,
    ...(a.description === undefined ? {} : { description: a.description }),
    origin,
  });
  const isSerialMark = (a: Raw) => a.type === 'serial' && a.description === undefined;

  const trySplit = (markers: boolean) => {
    let cursor = 0;
    const inherited: Raw[] = [];
    for (const s of chain) {
      if (markers && s.mode === 'serial') {
        if (all[cursor] === undefined || !isSerialMark(all[cursor]!)) return undefined;
        cursor += 1;
      }
      for (const st of s.annotations ?? []) {
        const a = all[cursor];
        if (a === undefined || !sameAnnotation(a, st)) return undefined;
        inherited.push(a);
        cursor += 1;
      }
    }
    return { inherited, own: all.slice(cursor) };
  };

  if (chain.every((c) => c.annotations !== undefined && c.mode !== undefined)) {
    const anySerial = chain.some((c) => c.mode === 'serial');
    const order = !anySerial
      ? [false]
      : ctx.syntheticSerial === false
        ? [false, true]
        : [true, false];
    const fits = order.flatMap((markers) => {
      const split = trySplit(markers);
      return split ? [{ markers, split }] : [];
    });
    const chosen = fits[0];
    if (chosen) {
      if (anySerial && fits.length === 1) ctx.syntheticSerial = chosen.markers;
      return [
        ...chosen.split.inherited.map((a) => make(a, 'describe')),
        ...chosen.split.own.map((a) => make(a, 'declaration')),
      ];
    }
  }

  if (chain.every((c) => c.annotations !== undefined))
    warnOnce(
      ctx,
      'annotation-inheritance-mismatch',
      'test.annotations does not start with the enclosing describes’ own annotations in the expected order; inherited annotations are reported with origin "declaration".',
    );
  return all.filter((a) => !isSerialMark(a)).map((a) => make(a, 'declaration'));
}

type Scope = RawConditional['scope'];
type Origin =
  | { kind: 'modifier'; type: string; reason?: string; scopeKind: 'file' | 'describe' }
  | { kind: 'hook' }
  | { kind: 'body' };

/** Records one finding, once even when the file is listed under several projects. */
function addConditional(ctx: ExtractionContext, c: RawConditional): void {
  const key = JSON.stringify(c);
  if (ctx.conditionalKeys.has(key)) return;
  ctx.conditionalKeys.add(key);
  ctx.conditionals.push(c);
}

function appliesTo(ctx: ExtractionContext, f: Finding): RawConditional['appliesToProjects'] {
  if (!f.projectCompare) return 'unknown';
  const { value, negated } = f.projectCompare;
  // Source compares with Playwright's raw name ('' for the unnamed project); the document uses DEFAULT_PROJECT.
  return ctx.projectNames
    .filter((n) => (n === value) !== negated)
    .map((n) => (n === '' ? DEFAULT_PROJECT : n));
}

/**
 * Scans one function source and records its conditionals. A source that cannot be parsed is reported
 * once (`conditional-parse-failed`) and recorded as a single opaque, type-unknown conditional so the
 * map shows that something there was not understood (ADR 0008).
 */
function scanInto(
  ctx: ExtractionContext,
  source: string,
  origin: Origin,
  location: RawConditional['location'],
  scope: Scope,
): void {
  const result =
    origin.kind === 'modifier' ? scanModifierCallback(source) : scanFunctionBody(source);
  const form = (f: Finding): RawConditional['form'] =>
    origin.kind === 'modifier'
      ? origin.scopeKind === 'file'
        ? 'file-callback'
        : 'describe-callback'
      : origin.kind === 'hook'
        ? 'hook'
        : f.via === 'runtime-push'
          ? 'runtime-push'
          : 'body';
  const reporter = origin.kind === 'modifier';
  if (!result.ok) {
    warnOnce(
      ctx,
      'conditional-parse-failed',
      `Could not parse a ${origin.kind} function (${result.error}); its conditionals are reported as unknown.`,
      `${location.file}:${location.line}`,
    );
    addConditional(ctx, {
      type: origin.kind === 'modifier' ? origin.type : UNKNOWN_TYPE,
      form: form({ via: 'call' } as Finding),
      refs: [],
      ...(origin.kind === 'modifier' && origin.reason !== undefined
        ? { reason: origin.reason }
        : {}),
      location,
      scope,
      appliesToProjects: 'unknown',
      source: reporter ? 'reporter' : 'scan',
      confidence: 'opaque',
    });
    return;
  }
  for (const f of result.findings) {
    const reason = origin.kind === 'modifier' ? origin.reason : f.reason;
    addConditional(ctx, {
      type: origin.kind === 'modifier' ? origin.type : f.type,
      form: form(f),
      ...(f.condition === undefined ? {} : { condition: f.condition }),
      refs: f.refs,
      ...(reason === undefined ? {} : { reason }),
      location,
      scope,
      appliesToProjects: origin.kind === 'modifier' ? 'unknown' : appliesTo(ctx, f),
      source: reporter ? 'reporter' : 'scan',
      confidence: f.confidence,
    });
  }
}

/** Modifiers and hooks registered on one file or describe suite. */
function scanSuite(
  ctx: ExtractionContext,
  suite: Suite,
  scopeKind: 'file' | 'describe',
  scope: Scope,
  fallbackFile: string,
): void {
  const report = internalsReport(ctx);
  const loc = (l: { file: string; line: number; column: number } | undefined) =>
    l
      ? { file: relPath(ctx, l.file), line: l.line, column: l.column }
      : {
          file: fallbackFile,
          line: suite.location?.line ?? 1,
          column: suite.location?.column ?? 1,
        };
  for (const m of readSuiteModifiers(suite, report) ?? [])
    scanInto(
      ctx,
      m.source,
      {
        kind: 'modifier',
        type: m.type,
        scopeKind,
        ...(m.description === undefined ? {} : { reason: m.description }),
      },
      loc(m.location),
      scope,
    );
  for (const h of readSuiteHooks(suite, report) ?? [])
    scanInto(ctx, h.source, { kind: 'hook' }, loc(h.location), scope);
}

function toTest(
  ctx: ExtractionContext,
  t: TestCase,
  chain: SuiteInfo[],
  describePath: string[],
): RawTest {
  const file = relPath(ctx, t.location.file);
  const body = readTestFn(t, internalsReport(ctx));
  if (body !== undefined)
    scanInto(
      ctx,
      body,
      { kind: 'body' },
      { file, line: t.location.line, column: t.location.column },
      { file, testTitlePath: [...describePath, t.title] },
    );
  const only = readTestOnly(t, internalsReport(ctx));
  return {
    kind: 'test',
    title: t.title,
    location: {
      file,
      line: t.location.line,
      column: t.location.column,
    },
    tags: toTags(t, chain),
    annotations: toAnnotations(ctx, t, chain),
    expectedStatus: t.expectedStatus,
    timeout: t.timeout,
    retries: t.retries,
    repeatEachIndex: t.repeatEachIndex,
    nativeId: t.id,
    ...(only === undefined ? {} : { only }),
  };
}

/** `chain` is the enclosing file and describe suites, outermost first; `describePath` their titles (describes only). */
function toNodes(
  ctx: ExtractionContext,
  suite: Suite,
  chain: SuiteInfo[],
  describePath: string[],
  describeKeys: string[],
  file: string,
): RawNode[] {
  const nodes: RawNode[] = [];
  // Sibling describes may share a title; core numbers them in order (`title#2`), so scopes must too.
  const seenTitles = new Map<string, number>();
  for (const entry of entriesOf(suite)) {
    if (isTest(entry)) nodes.push(toTest(ctx, entry, chain, describePath));
    else {
      const info = readSuiteInfo(ctx, entry);
      const occurrence = (seenTitles.get(entry.title) ?? 0) + 1;
      seenTitles.set(entry.title, occurrence);
      const path = [...describePath, entry.title];
      const keys = [
        ...describeKeys,
        occurrence === 1 ? entry.title : `${entry.title}#${occurrence}`,
      ];
      scanSuite(ctx, entry, 'describe', { file, describePath: keys }, file);
      nodes.push({
        kind: 'describe',
        title: entry.title,
        mode: info.mode ?? 'default',
        tags: info.tags ?? [],
        annotations: (info.annotations ?? []).map((a) => ({ ...a, origin: 'describe' as const })),
        children: toNodes(ctx, entry, [...chain, info], path, keys, file),
      });
    }
  }
  return nodes;
}

function fileOf(suite: Suite): string | undefined {
  if (suite.location?.file) return suite.location.file;
  return suite.allTests()[0]?.location.file;
}

export function extractRaw(config: FullConfig, root: Suite): RawExtraction {
  const noConfigFile = !config.configFile;
  const ctx: ExtractionContext = {
    baseDir: config.configFile ? path.dirname(config.configFile) : config.rootDir,
    warnings: [],
    flags: new Set(),
    conditionals: [],
    conditionalKeys: new Set(),
    projectNames: root.suites.flatMap((s) => {
      const n = s.project()?.name;
      return n === undefined ? [] : [n];
    }),
  };

  if (noConfigFile)
    ctx.warnings.push({
      code: 'no-config-file',
      message: `Playwright reported no config file; paths are relative to its rootDir (${config.rootDir}), which is the testDir.`,
    });

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
      const filePath = relPath(ctx, file);
      scanSuite(ctx, fileSuite, 'file', { file: filePath }, filePath);
      files.push({
        path: filePath,
        children: toNodes(ctx, fileSuite, [readSuiteInfo(ctx, fileSuite)], [], [], filePath),
      });
    }
    projects.push({ project: toProject(ctx, project), files });
  }

  return {
    framework: 'playwright',
    frameworkVersion: config.version,
    configFile: config.configFile ? relPath(ctx, config.configFile) : '',
    rootDir: ctx.baseDir,
    projects,
    conditionals: ctx.conditionals,
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
