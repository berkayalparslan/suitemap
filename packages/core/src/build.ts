import type { RawDescribe, RawExtraction, RawNode, RawTest } from './raw.js';
import {
  SCHEMA_VERSION,
  type Annotation,
  type AnnotationType,
  type Conditional,
  type Describe,
  type Folder,
  type File,
  type SuitemapDocument,
  type Tag,
  type TagRef,
  type Test,
  type TestInstance,
  type Warning,
} from './schema.js';

const SEP = ' › ';
const BUILT_IN_ANNOTATIONS = new Set(['skip', 'fail', 'fixme', 'slow']);

export const describeId = (file: string, describeTitles: string[]) =>
  [file, ...describeTitles].join(SEP);
export const testId = (file: string, titlePath: string[]) => [file, ...titlePath].join(SEP);
export const instanceId = (tid: string, projectId: string, repeatEachIndex: number) =>
  `${tid} [${projectId}#${repeatEachIndex}]`;

export interface BuildOptions {
  /** ISO timestamp; defaults to now. Pass a fixed value for reproducible output. */
  generatedAt?: string;
}

const byString =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

function normalizeAnnotation(a: Annotation): Annotation {
  const { hidden: _ignored, ...rest } = a;
  void _ignored;
  return a.type.startsWith('_') ? { ...rest, hidden: true } : rest;
}

function unionTags(into: TagRef[], more: TagRef[]) {
  for (const t of more) {
    if (!into.some((x) => x.name === t.name && x.origin === t.origin)) into.push({ ...t });
  }
}

/** Builds the canonical document from an adapter's raw extraction. Pure and deterministic. */
export function buildDocument(raw: RawExtraction, options: BuildOptions = {}): SuitemapDocument {
  const warnings: Warning[] = [...raw.warnings];
  const warn = (code: string, message: string, where?: string) =>
    warnings.push(where === undefined ? { code, message } : { code, message, where });

  const folders = new Map<string, Folder>();
  const files = new Map<string, File>();
  const describes = new Map<string, Describe>();
  const tests = new Map<string, Test>();
  const instances = new Map<string, TestInstance>();

  const ensureFolder = (dir: string): string => {
    const id = dir === '' ? '.' : dir;
    if (!folders.has(id)) {
      if (id === '.') folders.set(id, { id, path: '.' });
      else {
        const idx = id.lastIndexOf('/');
        const parentId = ensureFolder(idx === -1 ? '' : id.slice(0, idx));
        folders.set(id, { id, path: id, parentId });
      }
    }
    return id;
  };

  const ensureFile = (path: string): string => {
    if (!files.has(path)) {
      const idx = path.lastIndexOf('/');
      files.set(path, {
        id: path,
        path,
        folderId: ensureFolder(idx === -1 ? '' : path.slice(0, idx)),
      });
    }
    return path;
  };

  const projectSuites = [...raw.projects].sort(byString((p) => p.project.id));

  for (const ps of projectSuites) {
    for (const file of [...ps.files].sort(byString((f) => f.path))) {
      const fileId = ensureFile(file.path);

      const visitDescribe = (
        d: RawDescribe,
        titles: string[],
        parentId: string | undefined,
        occurrence: number,
      ) => {
        const path = [...titles, d.title];
        // Sibling describes may share a title; the n-th one gets a "#n" suffix so they stay distinct.
        // The id is built from the parent's id (not just titles) so nested describes stay distinct too.
        const base = `${parentId ?? fileId}${SEP}${d.title}`;
        const id = occurrence === 1 ? base : `${base}#${occurrence}`;
        const annotations = d.annotations.map(normalizeAnnotation);
        const existing = describes.get(id);
        if (!existing) {
          describes.set(id, {
            id,
            title: d.title,
            fileId,
            ...(parentId === undefined ? {} : { parentId }),
            mode: d.mode,
            tags: [...d.tags],
            annotations,
          });
        } else {
          if (existing.mode !== d.mode)
            warn(
              'describe-mode-differs',
              `Describe has different modes across projects: ${existing.mode} vs ${d.mode} (project ${ps.project.id}); keeping ${existing.mode}.`,
              id,
            );
          for (const t of d.tags) if (!existing.tags.includes(t)) existing.tags.push(t);
          for (const a of annotations)
            if (
              !existing.annotations.some(
                (x) =>
                  x.type === a.type && x.description === a.description && x.origin === a.origin,
              )
            )
              existing.annotations.push(a);
        }
        visitNodes(d.children, path, id);
      };

      const visitTest = (t: RawTest, titles: string[], describeIdOfParent?: string) => {
        const titlePath = [...titles, t.title];
        const tid = testId(fileId, titlePath);
        const existing = tests.get(tid);
        if (!existing) {
          tests.set(tid, {
            id: tid,
            title: t.title,
            titlePath,
            fileId,
            ...(describeIdOfParent === undefined ? {} : { describeId: describeIdOfParent }),
            location: { ...t.location },
            tags: t.tags.map((x) => ({ ...x })),
          });
        } else {
          unionTags(existing.tags, t.tags);
        }
        const iid = instanceId(tid, ps.project.id, t.repeatEachIndex);
        if (instances.has(iid)) {
          warn(
            'duplicate-instance',
            `Two tests map to the same instance id; the second was dropped.`,
            iid,
          );
          return;
        }
        instances.set(iid, {
          id: iid,
          testId: tid,
          projectId: ps.project.id,
          repeatEachIndex: t.repeatEachIndex,
          ...(t.nativeId === undefined ? {} : { playwrightId: t.nativeId }),
          expectedStatus: t.expectedStatus,
          annotations: t.annotations.map(normalizeAnnotation),
          timeout: t.timeout,
          retries: t.retries,
          ...(t.only === undefined ? {} : { only: t.only }),
        });
      };

      const visitNodes = (nodes: RawNode[], titles: string[], parentId?: string) => {
        const seen = new Map<string, number>();
        for (const n of nodes) {
          if (n.kind === 'describe') {
            const occurrence = (seen.get(n.title) ?? 0) + 1;
            seen.set(n.title, occurrence);
            visitDescribe(n, titles, parentId, occurrence);
          } else visitTest(n, titles, parentId);
        }
      };

      visitNodes(file.children, [], undefined);
    }
  }

  // Counts: distinct tests per tag / annotation type.
  const tagTests = new Map<string, Set<string>>();
  for (const t of tests.values())
    for (const tag of t.tags)
      (tagTests.get(tag.name) ?? tagTests.set(tag.name, new Set()).get(tag.name)!).add(t.id);

  const annTests = new Map<string, Set<string>>();
  for (const i of instances.values())
    for (const a of i.annotations)
      (annTests.get(a.type) ?? annTests.set(a.type, new Set()).get(a.type)!).add(i.testId);

  const tags: Tag[] = [...tagTests]
    .map(([name, set]) => ({ name, testCount: set.size }))
    .sort(byString((t) => t.name));
  const annotationTypes: AnnotationType[] = [...annTests]
    .map(([type, set]) => ({ type, builtIn: BUILT_IN_ANNOTATIONS.has(type), testCount: set.size }))
    .sort(byString((t) => t.type));

  // Conditionals: resolve title-path scopes to ids.
  const conditionals: Conditional[] = [];
  const usedIds = new Set<string>();
  const sortedRaw = [...raw.conditionals].sort(
    (a, b) =>
      byString<typeof a>((c) => c.scope.file)(a, b) ||
      a.location.line - b.location.line ||
      byString<typeof a>((c) => c.type + c.form)(a, b) ||
      // Column differs between Playwright versions: only a tie-break of last resort, after the
      // scope, so `#n` suffixes do not depend on it for conditionals in different tests.
      byString<typeof a>((c) => JSON.stringify(c.scope))(a, b) ||
      a.location.column - b.location.column,
  );
  for (const c of sortedRaw) {
    const fileId = c.scope.file;
    if (!files.has(fileId)) {
      warn(
        'conditional-unknown-file',
        `Conditional in a file with no listed tests was dropped.`,
        `${fileId}:${c.location.line}`,
      );
      continue;
    }
    const scope: Conditional['scope'] = {};
    if (c.scope.testTitlePath) {
      const tid = testId(fileId, c.scope.testTitlePath);
      if (tests.has(tid)) scope.testId = tid;
      else {
        warn(
          'conditional-unknown-test',
          `Conditional refers to a test that was not found; attached to its file.`,
          tid,
        );
        scope.fileId = fileId;
      }
    } else if (c.scope.describePath) {
      const did = describeId(fileId, c.scope.describePath);
      if (describes.has(did)) scope.describeId = did;
      else {
        warn(
          'conditional-unknown-describe',
          `Conditional refers to a describe that was not found; attached to its file.`,
          did,
        );
        scope.fileId = fileId;
      }
    } else scope.fileId = fileId;

    // No column: it differs between Playwright versions for the same call (ADR 0008).
    const base = `${fileId}:${c.location.line}:${c.type}:${c.form}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}#${n}`;
    usedIds.add(id);
    conditionals.push({
      id,
      type: c.type,
      form: c.form,
      ...(c.condition === undefined ? {} : { condition: c.condition }),
      refs: [...c.refs],
      ...(c.reason === undefined ? {} : { reason: c.reason }),
      location: { ...c.location },
      scope,
      appliesToProjects:
        c.appliesToProjects === 'unknown' ? 'unknown' : [...c.appliesToProjects].sort(),
      source: c.source,
      confidence: c.confidence,
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      framework: raw.framework,
      frameworkVersion: raw.frameworkVersion,
      configFile: raw.configFile,
      rootDir: raw.rootDir,
      mode: 'static',
    },
    projects: projectSuites.map((p) => p.project),
    folders: [...folders.values()].sort(byString((f) => f.id)),
    files: [...files.values()].sort(byString((f) => f.id)),
    describes: [...describes.values()],
    tests: [...tests.values()],
    instances: [...instances.values()],
    tags,
    annotationTypes,
    conditionals,
    warnings,
  };
}
