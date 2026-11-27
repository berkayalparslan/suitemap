import { test, expect } from '@playwright/test';

test('login with valid credentials @smoke', async () => {});

test('login with details tags', { tag: ['@auth', '@smoke'] }, async () => {});

test('login mixed tags @fast', { tag: '@auth' }, async () => {});

test('login known bug (url issue)', {
  annotation: { type: 'issue', description: 'https://github.com/org/repo/issues/12' },
}, async () => {});

test('login known bug (jira key)', {
  annotation: [
    { type: 'issue', description: 'JIRA-123' },
    { type: 'issue', description: 'https://example.atlassian.net/browse/JIRA-456' },
  ],
}, async () => {});
