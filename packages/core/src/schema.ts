// Schema v1. Mirrors docs/schema.md; types are derived from the validators so they cannot drift.
import * as v from 'valibot';

export const SCHEMA_VERSION = 1 as const;

const Status = v.picklist(['passed', 'failed', 'skipped', 'timedOut', 'interrupted']);

export const LocationSchema = v.object({
  file: v.string(),
  line: v.number(),
  column: v.number(),
});

export const ProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  dependencies: v.array(v.string()),
  teardown: v.optional(v.string()),
  testDir: v.string(),
  grep: v.optional(v.array(v.string())),
  grepInvert: v.optional(v.array(v.string())),
  use: v.optional(v.record(v.string(), v.unknown())),
});

export const FolderSchema = v.object({
  id: v.string(),
  path: v.string(),
  parentId: v.optional(v.string()),
});

export const FileSchema = v.object({ id: v.string(), path: v.string(), folderId: v.string() });

export const AnnotationSchema = v.object({
  type: v.string(),
  description: v.optional(v.string()),
  issueKey: v.optional(v.string()),
  origin: v.picklist(['declaration', 'describe', 'runtime']),
  hidden: v.optional(v.boolean()),
});

export const TagRefSchema = v.object({
  name: v.string(),
  origin: v.picklist(['title', 'details', 'describe', 'project']),
});

export const DescribeSchema = v.object({
  id: v.string(),
  title: v.string(),
  fileId: v.string(),
  parentId: v.optional(v.string()),
  mode: v.picklist(['default', 'parallel', 'serial']),
  tags: v.array(v.string()),
  annotations: v.array(AnnotationSchema),
});

export const TestSchema = v.object({
  id: v.string(),
  title: v.string(),
  titlePath: v.array(v.string()),
  fileId: v.string(),
  describeId: v.optional(v.string()),
  location: LocationSchema,
  tags: v.array(TagRefSchema),
});

export const InstanceResultSchema = v.object({
  status: Status,
  durationMs: v.number(),
  retry: v.number(),
  flaky: v.boolean(),
});

export const TestInstanceSchema = v.object({
  id: v.string(),
  testId: v.string(),
  projectId: v.string(),
  repeatEachIndex: v.number(),
  // Playwright's own TestCase.id, kept as an optional cross-check (ADR 0005).
  playwrightId: v.optional(v.string()),
  expectedStatus: Status,
  annotations: v.array(AnnotationSchema),
  timeout: v.number(),
  retries: v.number(),
  only: v.optional(v.boolean()),
  result: v.optional(InstanceResultSchema),
});

export const TagSchema = v.object({ name: v.string(), testCount: v.number() });
export const AnnotationTypeSchema = v.object({
  type: v.string(),
  builtIn: v.boolean(),
  testCount: v.number(),
});

export const ConditionalSchema = v.object({
  id: v.string(),
  type: v.string(),
  form: v.picklist(['body', 'describe-callback', 'file-callback', 'hook', 'runtime-push']),
  condition: v.optional(v.string()),
  refs: v.array(v.string()),
  reason: v.optional(v.string()),
  location: LocationSchema,
  scope: v.object({
    testId: v.optional(v.string()),
    describeId: v.optional(v.string()),
    fileId: v.optional(v.string()),
  }),
  appliesToProjects: v.union([v.array(v.string()), v.literal('unknown')]),
  source: v.picklist(['reporter', 'scan']),
  confidence: v.picklist(['static', 'inferred', 'opaque']),
  observed: v.optional(v.array(v.object({ instanceId: v.string(), fired: v.boolean() }))),
});

// ADR 0005: non-fatal extraction problems are data, not crashes.
export const WarningSchema = v.object({
  code: v.string(),
  message: v.string(),
  where: v.optional(v.string()),
});

export const SuitemapDocumentSchema = v.object({
  schemaVersion: v.literal(SCHEMA_VERSION),
  generatedAt: v.string(),
  source: v.object({
    framework: v.literal('playwright'),
    frameworkVersion: v.string(),
    configFile: v.string(),
    rootDir: v.string(),
    mode: v.picklist(['static', 'results']),
  }),
  projects: v.array(ProjectSchema),
  folders: v.array(FolderSchema),
  files: v.array(FileSchema),
  describes: v.array(DescribeSchema),
  tests: v.array(TestSchema),
  instances: v.array(TestInstanceSchema),
  tags: v.array(TagSchema),
  annotationTypes: v.array(AnnotationTypeSchema),
  conditionals: v.array(ConditionalSchema),
  warnings: v.array(WarningSchema),
});

export type Location = v.InferOutput<typeof LocationSchema>;
export type Project = v.InferOutput<typeof ProjectSchema>;
export type Folder = v.InferOutput<typeof FolderSchema>;
export type File = v.InferOutput<typeof FileSchema>;
export type Annotation = v.InferOutput<typeof AnnotationSchema>;
export type TagRef = v.InferOutput<typeof TagRefSchema>;
export type Describe = v.InferOutput<typeof DescribeSchema>;
export type Test = v.InferOutput<typeof TestSchema>;
export type InstanceResult = v.InferOutput<typeof InstanceResultSchema>;
export type TestInstance = v.InferOutput<typeof TestInstanceSchema>;
export type Tag = v.InferOutput<typeof TagSchema>;
export type AnnotationType = v.InferOutput<typeof AnnotationTypeSchema>;
export type Conditional = v.InferOutput<typeof ConditionalSchema>;
export type Warning = v.InferOutput<typeof WarningSchema>;
export type SuitemapDocument = v.InferOutput<typeof SuitemapDocumentSchema>;
