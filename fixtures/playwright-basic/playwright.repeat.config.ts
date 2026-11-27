import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  repeatEach: 2,
  globalSetup: process.env.FIXTURE_GLOBAL_SETUP === '0' ? undefined : './global-setup.ts',
  use: { baseURL: process.env.FIXTURE_BASE_URL },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /.*\.teardown\.ts/ },
    { name: 'chromium', testIgnore: /.*\.(setup|teardown)\.ts/, dependencies: ['setup'], use: { browserName: 'chromium' } },
    { name: 'firefox', testIgnore: /.*\.(setup|teardown)\.ts/, dependencies: ['setup'], use: { browserName: 'firefox' } },
    { name: 'webkit', testIgnore: /.*\.(setup|teardown)\.ts/, dependencies: ['setup'], use: { browserName: 'webkit' } },
  ],
});
