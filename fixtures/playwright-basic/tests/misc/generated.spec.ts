import { test } from '@playwright/test';

for (const role of ['admin', 'user', 'guest']) {
  test(`role ${role} can log in`, { tag: `@role-${role}` }, async () => {});
}

for (const env of ['staging', 'prod']) {
  test.describe(`env ${env}`, () => {
    test('health check', async () => {});
  });
}
