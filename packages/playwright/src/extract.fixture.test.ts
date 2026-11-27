// Runs the real reporter (through the programmatic entry) against fixtures/playwright-basic.
// The snapshot must be identical for every Playwright version in the CI matrix (1.42 and latest).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SuitemapDocument } from '@suitemap/core';
import { extract } from './run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const fixtureDir = path.resolve(pkgDir, '../../fixtures/playwright-basic');
const GENERATED_AT = '2026-01-01T00:00:00.000Z';

// Version-dependent or machine-dependent values are normalised; everything else must match exactly.
//  - rootDir is an absolute path.
//  - frameworkVersion is the version under test (checked separately against the installed one).
//  - Test `column` differs between Playwright versions for the same call (docs/playwright-adapter.md).
function normalise(doc: SuitemapDocument) {
  return {
    ...doc,
    source: { ...doc.source, rootDir: '<rootDir>', frameworkVersion: '<version>' },
    tests: doc.tests.map((t) => ({ ...t, location: { ...t.location, column: 0 } })),
  };
}

describe('fixtures/playwright-basic', () => {
  let doc: SuitemapDocument;

  beforeAll(async () => {
    if (
      !existsSync(path.join(pkgDir, 'dist/reporter.js')) ||
      !existsSync(path.resolve(pkgDir, '../core/dist/index.js'))
    )
      throw new Error('Run `pnpm build` first: the reporter is loaded from dist by Playwright.');
    doc = await extract({
      cwd: fixtureDir,
      generatedAt: GENERATED_AT,
      // The fixture is not a workspace package; let it resolve @playwright/test from this package.
      env: { NODE_PATH: path.join(pkgDir, 'node_modules') },
    });
  }, 120_000);

  it('reports the installed Playwright version', () => {
    const installed = createRequire(path.join(pkgDir, 'noop.js'))('@playwright/test/package.json')
      .version as string;
    expect(doc.source.frameworkVersion).toBe(installed);
  });

  it('matches the snapshot', async () => {
    await expect(JSON.stringify(normalise(doc), null, 2) + '\n').toMatchFileSnapshot(
      '__snapshots__/playwright-basic.json',
    );
  });

  it('keeps project dependencies and teardown, whatever the project order', () => {
    const byId = Object.fromEntries(doc.projects.map((p) => [p.id, p]));
    expect(byId.setup?.teardown).toBe('teardown');
    expect(byId.chromium?.dependencies).toEqual(['setup']);
  });

  it('flags hidden annotation types', () => {
    const hidden = doc.instances
      .flatMap((i) => i.annotations)
      .filter((a) => a.type === '_internal');
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((a) => a.hidden === true)).toBe(true);
  });

  it('never emits the synthetic serial annotation', () => {
    expect(doc.annotationTypes.map((a) => a.type)).not.toContain('serial');
  });
});
