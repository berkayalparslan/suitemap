import { test } from '@playwright/test';

test.describe('roles', {
  tag: '@rbac',
  annotation: { type: 'owner', description: 'team-auth' },
}, () => {
  test('admin can manage users', async () => {});

  test.describe('nested', { tag: '@nested', annotation: { type: 'issue', description: 'RBAC-7' } }, () => {
    test('guest cannot manage users', { tag: '@negative' }, async () => {});
  });
});
