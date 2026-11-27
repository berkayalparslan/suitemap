// `playwright test --list --reporter=@suitemap/playwright/extract`
// Writes the validated Suitemap document to the `outputFile` reporter option or $SUITEMAP_OUT.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter';
import { extractDocument } from './extract.js';

export interface SuitemapReporterOptions {
  outputFile?: string;
  /** ISO timestamp for reproducible output; defaults to now. */
  generatedAt?: string;
}

export default class SuitemapReporter implements Reporter {
  constructor(private readonly options: SuitemapReporterOptions = {}) {}

  printsToStdio() {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite) {
    const outputFile = this.options.outputFile ?? process.env.SUITEMAP_OUT;
    if (!outputFile)
      throw new Error('@suitemap/playwright: set the outputFile reporter option or SUITEMAP_OUT.');
    const generatedAt = this.options.generatedAt ?? process.env.SUITEMAP_GENERATED_AT;
    const document = extractDocument(config, suite, generatedAt ? { generatedAt } : {});
    mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
    writeFileSync(outputFile, JSON.stringify(document, null, 2) + '\n');
  }
}
