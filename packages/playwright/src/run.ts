// Programmatic entry point (what the CLI calls): runs the project's own Playwright with
// `--list` and our reporter, and returns the validated document.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDocument, type SuitemapDocument } from '@suitemap/core';

export interface ExtractOptions {
  /** Playwright config file; defaults to Playwright's own lookup in `cwd`. */
  configFile?: string;
  /** Directory Playwright runs in (also where @playwright/test is resolved from). Default: process.cwd(). */
  cwd?: string;
  /** Extra environment for the Playwright process (config loading may read env vars). */
  env?: Record<string, string | undefined>;
  /** Fixed ISO timestamp for reproducible output. */
  generatedAt?: string;
  /** Extra arguments for `playwright test`, e.g. ['--project=chromium']. */
  playwrightArgs?: string[];
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

// Playwright loads the reporter itself, so it must be the built file. When this module runs from
// src/ (unit tests), fall back to the sibling dist/ build.
const reporterPath = [
  new URL('./reporter.js', import.meta.url),
  new URL('../dist/reporter.js', import.meta.url),
]
  .map((u) => fileURLToPath(u))
  .find((p) => existsSync(p)) as string;

function resolvePlaywrightCli(cwd: string, env: NodeJS.ProcessEnv): string {
  // Resolve like the user's own `npx playwright` would: from their project, not from this package.
  // NODE_PATH is read by Node only at startup, so honour the child's value here explicitly.
  const paths = [cwd, ...(env.NODE_PATH ? env.NODE_PATH.split(path.delimiter) : [])];
  try {
    return createRequire(import.meta.url).resolve('@playwright/test/cli', { paths });
  } catch {
    throw new ExtractionError(
      `Could not find @playwright/test from ${cwd}. Install it in the project being mapped (>=1.42).`,
      '',
    );
  }
}

export async function extract(options: ExtractOptions = {}): Promise<SuitemapDocument> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  const cli = resolvePlaywrightCli(cwd, env);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'suitemap-'));
  const outputFile = path.join(dir, 'suitemap.json');
  try {
    env.SUITEMAP_OUT = outputFile;
    if (options.generatedAt) env.SUITEMAP_GENERATED_AT = options.generatedAt;
    const args = [
      cli,
      'test',
      '--list',
      `--reporter=${reporterPath}`,
      ...(options.configFile ? [`--config=${path.resolve(cwd, options.configFile)}`] : []),
      ...(options.playwrightArgs ?? []),
    ];
    const stderr = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      // Playwright reports reporter failures ("Error in reporter ...") on stdout, so keep both streams.
      child.stdout.on('data', (d: Buffer) => (err += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve(err)
          : reject(
              new ExtractionError(`playwright test --list exited with code ${code}.\n${err}`, err),
            ),
      );
    });
    let text: string;
    try {
      text = await readFile(outputFile, 'utf8');
    } catch {
      throw new ExtractionError(
        `Playwright finished without producing a document.\n${stderr}`,
        stderr,
      );
    }
    const result = validateDocument(JSON.parse(text));
    if (!result.ok)
      throw new ExtractionError(`Invalid document:\n${result.issues.join('\n')}`, stderr);
    return result.document;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
