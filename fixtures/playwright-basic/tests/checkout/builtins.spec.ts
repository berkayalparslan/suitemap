import { test } from '@playwright/test';

test.describe('unconditional', () => {
  test('skip', async () => { test.skip(); });
  test.skip('skip (declaration)', async () => {});
  test.fail('fail (declaration)', async () => {});
  test.fixme('fixme (declaration)', async () => {});
  test('slow (in body)', async () => { test.slow(); });
});

test.describe('conditional on browserName', () => {
  test('skip webkit (declaration callback)', async ({ browserName }) => {
    test.skip(browserName === 'webkit', 'not on webkit');
  });
  test('fail firefox (in body)', async ({ browserName }) => {
    test.fail(browserName === 'firefox', 'firefox bug');
  });
  test('fixme chromium (in body)', async ({ browserName }) => {
    test.fixme(browserName === 'chromium', 'chromium bug');
  });
  test('slow webkit (in body)', async ({ browserName }) => {
    test.slow(browserName === 'webkit', 'slow on webkit');
  });
});

test.describe('describe-level', () => {
  test.fixme(({ browserName }) => browserName === 'firefox', 'describe fixme on firefox');
  test('inside conditional fixme describe', async () => {});
});

test.describe.skip('skipped describe', () => {
  test('inside skipped describe', async () => {});
});

test.describe.fixme('fixme describe', () => {
  test('inside fixme describe', async () => {});
});

test.describe('only', () => {
  test.only('focused test', async () => {});
  test('unfocused sibling', async () => {});
});
