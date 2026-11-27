// Runs the built `suitemap` binary against fixtures/playwright-basic and the error cases.
// Like the extractor test, it runs in the Playwright version matrix in CI (1.42 and latest).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateDocument } from '@suitemap/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, '../dist/bin.js');
const fixtureDir = path.resolve(here, '../../../fixtures/playwright-basic');
const snapshotFile = path.resolve(here, '../../playwright/src/__snapshots__/playwright-basic.json');
// The fixture is not a workspace package; let it resolve @playwright/test from the playwright package.
const NODE_PATH = path.resolve(here, '../../playwright/node_modules');
const GENERATED_AT = '2026-01-01T00:00:00.000Z';

function suitemap(args: string[], env: Record<string, string> = {}, cwd?: string) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SUITEMAP_GENERATED_AT: GENERATED_AT, NODE_PATH, ...env },
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Same normalisation as the extractor's own fixture test.
function normalise(doc: { source: object; tests: { location: object }[] }) {
  return {
    ...doc,
    source: { ...doc.source, rootDir: '<rootDir>', frameworkVersion: '<version>' },
    tests: doc.tests.map((t) => ({ ...t, location: { ...t.location, column: 0 } })),
  };
}

let tmp: string;
beforeAll(async () => {
  if (!existsSync(bin)) throw new Error('Run `pnpm build` first: the tests run dist/bin.js.');
  tmp = await mkdtemp(path.join(os.tmpdir(), 'suitemap-cli-'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('suitemap --help / --version', () => {
  it('prints usage and the version to stdout', () => {
    const help = suitemap(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('suitemap extract');
    const v = suitemap(['--version']);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects unknown commands and options with exit code 2', () => {
    expect(suitemap(['nope']).code).toBe(2);
    expect(suitemap(['extract', '--bogus']).code).toBe(2);
    expect(suitemap([]).code).toBe(2);
  });
});

describe('suitemap extract: fixtures/playwright-basic', () => {
  it('writes a valid document matching the extractor snapshot, with JSON only in the file', () => {
    const out = path.join(tmp, 'basic.json');
    const r = suitemap(
      ['extract', '--config', path.join(fixtureDir, 'playwright.config.ts'), '--out', out],
      {},
      fixtureDir,
    );
    expect(r.code).toBe(0);
    const text = readFileSync(out, 'utf8');
    // Warnings go to stderr as a per-kind summary; stdout carries only the status line.
    const doc = JSON.parse(text) as {
      tests: unknown[];
      instances: unknown[];
      warnings: { code: string }[];
    };
    expect(doc.warnings.length).toBeGreaterThan(0);
    for (const code of new Set(doc.warnings.map((w) => w.code)))
      expect(r.stderr).toContain(`${doc.warnings.filter((w) => w.code === code).length} ${code}`);
    expect(r.stdout).toBe(
      `Wrote ${out} (${doc.tests.length} tests, ${doc.instances.length} instances)\n`,
    );
    const parsed: unknown = JSON.parse(text);
    const result = validateDocument(parsed);
    expect(result.ok).toBe(true);
    expect(normalise(parsed as Parameters<typeof normalise>[0])).toEqual(
      JSON.parse(readFileSync(snapshotFile, 'utf8')),
    );
  }, 120_000);

  it('--verbose lists every warning', () => {
    const out = path.join(tmp, 'verbose.json');
    const r = suitemap(
      [
        'extract',
        '--config',
        path.join(fixtureDir, 'playwright.config.ts'),
        '--out',
        out,
        '--verbose',
      ],
      {},
      fixtureDir,
    );
    expect(r.code).toBe(0);
    const warnings = (JSON.parse(readFileSync(out, 'utf8')) as { warnings: { code: string }[] })
      .warnings;
    expect(r.stderr.split('\n').filter((l) => l.startsWith('  ['))).toHaveLength(warnings.length);
  }, 120_000);

  it('defaults --out to suitemap.json next to the config', async () => {
    const dir = path.join(tmp, 'default-out');
    await mkdir(dir);
    await writeFile(
      path.join(dir, 'playwright.config.ts'),
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n",
    );
    await mkdir(path.join(dir, 'tests'));
    await writeFile(
      path.join(dir, 'tests/a.spec.ts'),
      "import { test } from '@playwright/test';\ntest('a', async () => {});\n",
    );
    // Run from another directory: the default is next to the config, not the current directory.
    const r = suitemap(
      ['extract', '--config', path.join(dir, 'playwright.config.ts'), '--cwd', dir],
      {},
      tmp,
    );
    expect(r.code).toBe(0);
    expect(existsSync(path.join(dir, 'suitemap.json'))).toBe(true);
    expect(existsSync(path.join(tmp, 'suitemap.json'))).toBe(false);
  }, 120_000);

  it('loads --env-file for Playwright and never writes env values into the output', () => {
    const envFile = path.join(tmp, 'test.env');
    const out = path.join(tmp, 'env.json');
    // The fixture config reads FIXTURE_BASE_URL; SECRET_TOKEN is read by nothing.
    return writeFile(
      envFile,
      'FIXTURE_BASE_URL=https://env-file.example.test\nSECRET_TOKEN=hunter2-s3cret\n',
    ).then(() => {
      const r = suitemap(
        [
          'extract',
          '--config',
          path.join(fixtureDir, 'playwright.config.ts'),
          '--out',
          out,
          '--env-file',
          envFile,
        ],
        {},
        fixtureDir,
      );
      expect(r.code).toBe(0);
      const text = readFileSync(out, 'utf8');
      expect(text).toContain('https://env-file.example.test');
      expect(text).not.toContain('hunter2-s3cret');
      expect(r.stdout + r.stderr).not.toContain('hunter2-s3cret');
    });
  }, 120_000);

  it('does not echo env-file contents when it cannot be parsed', async () => {
    const envFile = path.join(tmp, 'bad.env');
    await writeFile(envFile, 'hunter2-s3cret\n');
    const r = suitemap([
      'extract',
      '--config',
      path.join(fixtureDir, 'playwright.config.ts'),
      '--env-file',
      envFile,
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('line 1');
    expect(r.stderr).not.toContain('hunter2');
  });
});

describe('suitemap extract: failures exit non-zero and write nothing', () => {
  it('missing config', () => {
    const out = path.join(tmp, 'missing.json');
    const r = suitemap(['extract', '--config', path.join(tmp, 'nope.config.ts'), '--out', out]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('config file not found');
    expect(existsSync(out)).toBe(false);
  });

  it('a config that throws: the error is printed verbatim', async () => {
    const dir = path.join(tmp, 'throwing');
    await mkdir(dir);
    await writeFile(
      path.join(dir, 'playwright.config.ts'),
      "throw new Error('boom from the config');\n",
    );
    const out = path.join(dir, 'suitemap.json');
    const r = suitemap([
      'extract',
      '--config',
      path.join(dir, 'playwright.config.ts'),
      '--cwd',
      dir,
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('boom from the config');
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  it('no Playwright in the target project', async () => {
    const dir = path.join(tmp, 'no-playwright');
    await mkdir(dir);
    await writeFile(path.join(dir, 'playwright.config.ts'), 'export default {};\n');
    const r = suitemap(
      ['extract', '--config', path.join(dir, 'playwright.config.ts'), '--cwd', dir],
      { NODE_PATH: '' },
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Could not find @playwright/test');
    expect(existsSync(path.join(dir, 'suitemap.json'))).toBe(false);
  });

  it('unwritable output path', () => {
    const out = path.join(tmp, 'no/such/dir/suitemap.json');
    const r = suitemap(
      ['extract', '--config', path.join(fixtureDir, 'playwright.config.ts'), '--out', out],
      {},
      fixtureDir,
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cannot write');
    expect(existsSync(out)).toBe(false);
  }, 120_000);
});
