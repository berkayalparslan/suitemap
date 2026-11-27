// `suitemap` command line. All extraction is done by @suitemap/playwright; this file only parses
// arguments, loads the env file, writes the output and reports.
import { readFileSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { extract, ExtractionError } from '@suitemap/playwright';
import { parseEnvFile } from './env-file.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

const HELP = `suitemap: turn a Playwright test suite into a Suitemap document.

Usage:
  suitemap extract [--config <path>] [--out <file>] [--env-file <path>] [--cwd <dir>] [--verbose]
  suitemap --help | --version

extract options:
  --config <path>    Playwright config file. Default: Playwright's own lookup in --cwd.
  --out <file>       Output JSON file. Default: suitemap.json next to the config (or in --cwd).
  --env-file <path>  KEY=value file loaded into the environment of the Playwright process.
                     Variables already set in your environment win. Values are not copied
                     into the output, except config fields the extractor keeps (baseURL,
                     credentials stripped): do not put secrets in a variable feeding baseURL.
  --cwd <dir>        Directory Playwright runs in and @playwright/test is resolved from.
                     Default: the current directory.
  --verbose          List every warning instead of a per-kind count.

Relative --config, --out and --env-file paths are resolved against the current directory.
The suite is read statically (playwright test --list); no test runs. The JSON goes only to the
output file. Exit code 0 on success (even with warnings), 1 on failure, 2 on bad usage.
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

class UsageError extends Error {}

async function isFile(p: string): Promise<boolean> {
  return (await stat(p).catch(() => undefined))?.isFile() ?? false;
}

async function runExtract(args: string[], io: Io): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        config: { type: 'string' },
        out: { type: 'string' },
        'env-file': { type: 'string' },
        cwd: { type: 'string' },
        verbose: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }));
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  if (values.help) {
    io.stdout(HELP);
    return EXIT_OK;
  }

  const cwd = path.resolve(values.cwd ?? '.');
  const config = values.config === undefined ? undefined : path.resolve(values.config);
  const out = path.resolve(
    values.out ?? path.join(config ? path.dirname(config) : cwd, 'suitemap.json'),
  );

  if (config !== undefined && !(await isFile(config))) {
    io.stderr(`suitemap: config file not found: ${config}\n`);
    return EXIT_FAILURE;
  }
  if (!(await stat(cwd).catch(() => undefined))?.isDirectory()) {
    io.stderr(`suitemap: --cwd is not a directory: ${cwd}\n`);
    return EXIT_FAILURE;
  }

  // Fail before the (slow) extraction rather than after it.
  const outDir = path.dirname(out);
  if (!(await stat(outDir).catch(() => undefined))?.isDirectory()) {
    io.stderr(`suitemap: cannot write ${out}: ${outDir} is not a directory\n`);
    return EXIT_FAILURE;
  }
  if ((await stat(out).catch(() => undefined))?.isDirectory()) {
    io.stderr(`suitemap: cannot write ${out}: it is a directory\n`);
    return EXIT_FAILURE;
  }

  let env: Record<string, string> | undefined;
  if (values['env-file'] !== undefined) {
    const file = path.resolve(values['env-file']);
    try {
      // The process environment wins, as with dotenv: CI-provided values must not be shadowed.
      const fromFile = parseEnvFile(await readFile(file, 'utf8'));
      env = Object.fromEntries(
        Object.entries(fromFile).filter(([k]) => process.env[k] === undefined),
      );
    } catch (e) {
      io.stderr(`suitemap: cannot load env file ${file}: ${(e as Error).message}\n`);
      return EXIT_FAILURE;
    }
  }

  let doc;
  try {
    doc = await extract({
      cwd,
      ...(config ? { configFile: config } : {}),
      ...(env ? { env } : {}),
    });
  } catch (e) {
    if (!(e instanceof ExtractionError)) throw e;
    // Config load errors and Playwright's own output are shown verbatim.
    io.stderr(`suitemap: extraction failed.\n${e.message}\n`);
    return EXIT_FAILURE;
  }

  // Write next to the target, then rename, so a failed write never leaves a truncated document.
  const tmp = `${out}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n');
    await rename(tmp, out);
  } catch (e) {
    await rm(tmp, { force: true });
    io.stderr(`suitemap: cannot write ${out}: ${(e as NodeJS.ErrnoException).message}\n`);
    return EXIT_FAILURE;
  }

  if (doc.warnings.length > 0) {
    if (values.verbose) {
      io.stderr(`suitemap: ${doc.warnings.length} warning(s)\n`);
      for (const w of doc.warnings)
        io.stderr(`  [${w.code}] ${w.message}${w.where ? ` (${w.where})` : ''}\n`);
    } else {
      const counts = new Map<string, number>();
      for (const w of doc.warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1);
      const summary = [...counts].map(([code, n]) => `${n} ${code}`).join(', ');
      io.stderr(
        `suitemap: ${doc.warnings.length} warning(s): ${summary} (use --verbose to list)\n`,
      );
    }
  }
  io.stdout(`Wrote ${out} (${doc.tests.length} tests, ${doc.instances.length} instances)\n`);
  return EXIT_OK;
}

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
      io.stdout(HELP);
      return command === undefined ? EXIT_USAGE : EXIT_OK;
    }
    if (command === '--version' || command === '-v') {
      io.stdout(`${version()}\n`);
      return EXIT_OK;
    }
    if (command === 'extract') return await runExtract(rest, io);
    throw new UsageError(`unknown command "${command}"`);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`suitemap: ${e.message}\nRun "suitemap --help" for usage.\n`);
      return EXIT_USAGE;
    }
    io.stderr(`suitemap: unexpected error: ${(e as Error).stack ?? String(e)}\n`);
    return EXIT_FAILURE;
  }
}
