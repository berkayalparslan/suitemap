import { test } from '@playwright/test';

test('hidden type', { annotation: { type: '_internal', description: 'tooling only' } }, async () => {});

test('multiple annotations', {
  tag: ['@multi'],
  annotation: [
    { type: 'owner', description: 'alice' },
    { type: 'issue', description: '#123' },
    { type: 'owner', description: 'bob' },
  ],
}, async () => {});

test('runtime annotation', async () => {
  test.info().annotations.push({ type: 'runtime', description: 'added at run time' });
});
