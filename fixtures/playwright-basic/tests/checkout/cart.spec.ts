import { test } from '@playwright/test';

test.describe('serial flow', () => {
  test.describe.configure({ mode: 'serial' });
  test('add item', async () => {});
  test('apply coupon', async () => {});
  test('pay', async () => {});
});

test.describe('parallel flow', () => {
  test.describe.configure({ mode: 'parallel' });
  test('browse A', async () => {});
  test('browse B', async () => {});
});

test.describe('default flow', () => {
  test('view cart', async () => {});
});
