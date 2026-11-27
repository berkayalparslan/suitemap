// Framework-neutral extractor output. An adapter (e.g. @suitemap/playwright) produces this;
// buildDocument() turns it into a SuitemapDocument. Adapters resolve framework quirks
// (inherited-annotation dedupe, tag origin, describe mode mapping) before handing over.
import type { Annotation, Location, Project, TagRef, Warning } from './schema.js';

export interface RawDescribe {
  kind: 'describe';
  title: string;
  mode: 'default' | 'parallel' | 'serial';
  /** Tags declared directly on this describe. */
  tags: string[];
  /** Annotations declared directly on this describe (not inherited ones). */
  annotations: Annotation[];
  children: RawNode[];
}

export interface RawTest {
  kind: 'test';
  title: string;
  location: Location;
  /** Direct and inherited tags, with origin. */
  tags: TagRef[];
  /** Annotations as the framework reports them for this instance, already deduped. */
  annotations: Annotation[];
  expectedStatus: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  timeout: number;
  retries: number;
  repeatEachIndex: number;
  only?: boolean;
  /** Framework's own id, kept as a cross-check. */
  nativeId?: string;
}

export type RawNode = RawDescribe | RawTest;

export interface RawFile {
  /** Path relative to rootDir, forward slashes. */
  path: string;
  children: RawNode[];
}

/** One framework "project" and the files/tests it runs. The same test appears under several projects. */
export interface RawProjectSuite {
  project: Project;
  files: RawFile[];
}

export interface RawConditional {
  type: string;
  form: 'body' | 'describe-callback' | 'file-callback' | 'hook' | 'runtime-push';
  condition?: string;
  refs: string[];
  reason?: string;
  location: Location;
  /** What it is attached to; resolved to ids by the builder. Describe/test paths are titles. */
  scope: { file: string; describePath?: string[]; testTitlePath?: string[] };
  appliesToProjects: string[] | 'unknown';
  source: 'reporter' | 'scan';
  confidence: 'static' | 'inferred' | 'opaque';
}

export interface RawExtraction {
  framework: 'playwright';
  frameworkVersion: string;
  configFile: string;
  rootDir: string;
  projects: RawProjectSuite[];
  conditionals: RawConditional[];
  warnings: Warning[];
}
