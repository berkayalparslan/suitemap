// Spike reporter: dumps the suite tree seen in onBegin to JSON. No tests run under --list.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';

const USE_ALLOW = ['browserName', 'viewport', 'baseURL', 'channel', 'headless'];

class ListReporter implements Reporter {
  private rootDir = '';

  printsToStdio() { return false; }

  onBegin(config: FullConfig, suite: Suite) {
    this.rootDir = config.rootDir;
    const rel = (p?: string) => (p ? path.relative(this.rootDir, p) : p);
    const loc = (l?: { file: string; line: number; column: number }) =>
      l ? { file: rel(l.file), line: l.line, column: l.column } : undefined;

    const relAnn = (a: any) => ({ ...a, location: a.location ? loc(a.location) : undefined });
    const node = (s: Suite, depth = 0): any => {
      const out: any = {
        // `suite.type` only exists on newer versions; fall back to depth-based inference.
        type: (s as any).type ?? (depth === 0 ? 'root' : depth === 1 ? 'project' : depth === 2 ? 'file' : 'describe'),
        typeFromApi: 'type' in s,
        typeInferenceOk: !('type' in s) || (s as any).type === (depth === 0 ? 'root' : depth === 1 ? 'project' : depth === 2 ? 'file' : 'describe'),
        only: (s as any)._only,
        title: s.title,
        location: loc(s.location),
        // Not in public types on all versions; feature-detect.
        parallelMode: (s as any)._parallelMode,
        hasTagsField: 'tags' in s,
        suites: s.suites.map(c => node(c, depth + 1)),
        tests: s.tests.map(testNode),
      };
      if (out.type === 'project') {
        const p = s.project()!;
        out.project = {
          name: p.name,
          dependencies: p.dependencies,
          teardown: p.teardown,
          testDir: rel(p.testDir),
          grep: String(p.grep),
          repeatEach: p.repeatEach,
          retries: p.retries,
          timeout: p.timeout,
          use: Object.fromEntries(USE_ALLOW.filter(k => k in (p.use as any)).map(k => [k, (p.use as any)[k]])),
        };
      }
      // Describe-level declared data, if the version exposes it (internal fields).
      const internal = s as any;
      if (internal._staticAnnotations) out.staticAnnotations = internal._staticAnnotations.map(relAnn);
      if (internal._tags) out.internalTags = internal._tags;
      // Describe/file-level conditional modifiers (test.skip(cb, reason) at suite level), if exposed.
      out.hasModifiersField = '_modifiers' in internal;
      if (internal._modifiers?.length)
        out.modifiers = internal._modifiers.map((m: any) => ({
          type: m.type, description: m.description, location: loc(m.location), fn: m.fn?.toString(),
        }));
      // Hooks (beforeEach etc.) are registered on the suite; record whether they are visible.
      out.hasHooksField = '_hooks' in internal;
      if (internal._hooks?.length)
        out.hooks = internal._hooks.map((h: any) => ({ type: h.type, location: loc(h.location), fn: h.fn?.toString() }));
      if (out.type === 'describe' || out.type === 'file') {
        out.titlePath = s.titlePath();
        out.allTestCount = s.allTests().length;
      }
      return out;
    };

    const testNode = (t: TestCase) => ({
      title: t.title,
      // titlePath() is ['', project, file, ...describes, title]; drop root, project and file so it is project-independent.
      titlePath: t.titlePath().slice(3),
      location: loc(t.location),
      parentTitle: t.parent.title,
      parentType: (t.parent as any).type,
      tags: (t as any).tags,
      annotations: t.annotations.map(relAnn),
      only: (t as any)._only,
      hasFn: typeof (t as any).fn,
      fnSource: (t as any).fn?.toString(),
      expectedStatus: t.expectedStatus,
      timeout: t.timeout,
      retries: t.retries,
      repeatEachIndex: t.repeatEachIndex,
      id: t.id,
      outcome: t.outcome?.(),
    });

    const dump = {
      playwrightVersion: config.version,
      globalSetup: config.globalSetup ? rel(String(config.globalSetup)) : null,
      projectNames: config.projects.map(p => p.name),
      tree: node(suite),
    };
    const out = process.env.SPIKE_OUT;
    if (!out) throw new Error('SPIKE_OUT not set');
    writeFileSync(out, JSON.stringify(dump, null, 2) + '\n');
  }
}

export default ListReporter;
