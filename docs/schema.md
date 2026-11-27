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
