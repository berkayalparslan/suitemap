import { test } from '@playwright/test';

// Hard cases for a static scan of conditional / runtime annotations.

function skipOnCI(t: typeof test) {
  t.skip(!!process.env.CI, 'flaky on CI'); // called through a helper: not visible at the call site
}

const kind = 'issue';

// File-level conditional with a callback (describe-level modifier on the file suite).
test.skip(({ browserName }) => browserName === 'firefox', 'file-level: no firefox');

test.describe('conditionals', () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName === 'webkit', 'beforeEach: no webkit'); // hook form
  });

  test('env var condition', async () => {
    test.fixme(process.env.FEATURE_X === '1', 'needs feature x');
  });

  test('helper call', async () => {
    skipOnCI(test);
  });

  test('computed annotation type', async () => {
    test.info().annotations.push({ type: kind, description: 'JIRA-9' });
  });

  test('early return before conditional', async ({ browserName }) => {
    if (browserName === 'chromium') return;
    test.skip(true, 'never reached on chromium');
  });

  test('project name condition', async ({}, testInfo) => {
    test.slow(testInfo.project.name === 'webkit', 'slow project');
  });

  test('testInfo modifier', async ({}, testInfo) => {
    testInfo.fail(process.platform === 'win32', 'known bug on windows');
  });

  test('guarded unconditional skip', async ({ browserName }) => {
    if (browserName === 'firefox') {
      test.skip();
    }
  });

  test('literal runtime annotation', async () => {
    test.info().annotations.push({ type: 'issue', description: 'JIRA-10' });
  });

  test.afterEach(async () => {
    test.slow(); // unconditional, hook form
  });
});
