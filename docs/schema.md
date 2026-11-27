# Canonical schema (draft v0)

This is the contract between the extractor, the viewer and the rule engine. It is a **draft**: Phase 0 validates it against real `--list` output, Phase 1 freezes v1.

```ts
export interface SuitemapDocument {
  schemaVersion: 1;
  generatedAt: string;            // ISO timestamp
  source: {
    framework: 'playwright';
    frameworkVersion: string;     // e.g. "1.49.0"
    configFile: string;           // relative to rootDir
    rootDir: string;
    mode: 'static' | 'results';   // 'results' once a run overlay is merged (Phase 4)
  };
  projects: Project[];
  folders: Folder[];
  files: File[];
  describes: Describe[];
  tests: Test[];
  instances: TestInstance[];
  tags: Tag[];
  annotationTypes: AnnotationType[];
}

export interface Project {
  id: string;                     // project name
  name: string;
  dependencies: string[];         // project ids
  teardown?: string;              // project id
  testDir: string;
  grep?: string[];
  grepInvert?: string[];
  use?: Record<string, unknown>;  // only serialisable, non-secret fields (browserName, viewport, ...)
}

export interface Folder { id: string; path: string; parentId?: string }
export interface File { id: string; path: string; folderId: string }

export interface Describe {
  id: string;
  title: string;
  fileId: string;
  parentId?: string;              // parent describe id
  mode: 'default' | 'parallel' | 'serial';
  tags: string[];                 // declared directly on this describe
  annotations: Annotation[];      // declared directly on this describe
}

export interface Test {
  id: string;                     // stable: file path + title path
  title: string;
  titlePath: string[];
  fileId: string;
  describeId?: string;
  location: { file: string; line: number; column: number };
  tags: TagRef[];                 // direct + inherited, with origin
}

export interface TestInstance {
  id: string;                     // test id + project id (+ repeatEachIndex if > 0)
  testId: string;
  projectId: string;
  expectedStatus: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  annotations: Annotation[];      // what Playwright reports for this instance
  timeout: number;
  retries: number;
  only?: boolean;
  result?: InstanceResult;        // Phase 4
}

export interface TagRef {
  name: string;                   // "@smoke"
  origin: 'title' | 'details' | 'describe' | 'project';
}

export interface Annotation {
  type: string;                   // 'skip' | 'fail' | 'fixme' | 'slow' | custom
  description?: string;
  issueKey?: string;              // parsed from description (URL or text), e.g. "JIRA-123"
  origin: 'declaration' | 'describe' | 'runtime';
  hidden?: boolean;               // true when type starts with "_"
}

export interface Tag { name: string; testCount: number }
export interface AnnotationType { type: string; builtIn: boolean; testCount: number }

export interface InstanceResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  durationMs: number;
  retry: number;
  flaky: boolean;
}
```

## Open questions for Phase 0

- Is `id` stable enough across renames? Consider an optional user-provided id annotation.
- Which `use` fields are safe to serialise? Default to an allow-list (no env values, no storage state).
- Should `repeatEach` produce separate instances or a count?

## Phase 0 findings: proposed changes

Source: `docs/playwright-adapter.md` (Phase 0 checks). Proposed for v1, pending acceptance of `docs/decisions/0004-phase-0-schema-changes.md`.

1. `TestInstance.id` = `projectId + testId + repeatEachIndex` always (not only if > 0); Playwright's own `TestCase.id` is identical across projects.
2. `Test.id` = file path + `titlePath` (describe titles + test title, without project or file segments); duplicate titles are a load error, so this is unique. Do not use line or column.
3. `Annotation.origin` stays, but note that Playwright copies describe annotations onto every test. The extractor must dedupe: take the describe's own annotations (internal `_staticAnnotations`) as `describe`, the rest as `declaration`. Drop the synthetic `serial` annotation.
4. `TagRef.origin` is reconstructed by the extractor (Playwright gives a flat list).
5. `Describe.mode` stays `default`/`parallel`/`serial`; map Playwright's `none` to `default`.
6. `TestInstance.only` stays; sourced from internal `_only`.
7. Conditionals become a first-class entity (`Conditional`, below) instead of being invisible. See ADR 0004.
8. `Annotation` has no `location` on 1.42; keep it optional if added later.
9. Open questions answered: repeatEach produces separate instances; `use` allow-list is an extractor decision (the spike used `browserName, viewport, baseURL, channel, headless`).

### Proposed entity: `Conditional`

Conditional and runtime annotations (`test.skip(cond)`, `annotations.push(...)`, hooks, describe callbacks) are listed as their own entity so lenses and filters (test, project, tag, folder, `refs`, `form`, `type`, `confidence`) treat them like tags and annotations. Added to `SuitemapDocument` as `conditionals: Conditional[]`.

```ts
export interface Conditional {
  id: string;
  type: string;                      // 'skip' | 'fail' | 'fixme' | 'slow' | custom annotation type
  form: 'body' | 'describe-callback' | 'file-callback' | 'hook' | 'runtime-push';
  condition?: string;                // source text, e.g. "browserName === 'webkit'"
  refs: string[];                    // identifiers it depends on: browserName, process.env.CI, project name ...
  reason?: string;
  location: { file: string; line: number; column: number };
  scope: { testId?: string; describeId?: string; fileId?: string };  // what it is attached to
  appliesToProjects: string[] | 'unknown';   // resolved only for simple comparisons
  source: 'reporter' | 'scan';       // reporter: from Suite._modifiers/_hooks; scan: from the source scan
  confidence: 'static' | 'inferred' | 'opaque';  // opaque: not analysable (e.g. helper call)
  observed?: { instanceId: string; fired: boolean }[];  // Phase 4
}
```

Completeness: the scan cannot prove it found every conditional (helpers, fixtures, dynamic types). The viewer shows "N found by scan", not "all".
