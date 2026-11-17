import { defineConfig } from '@playwright/test';
import type { BrowserKind } from './e2e/fixtures.ts';

export default defineConfig<{ browserKind: BrowserKind }>({
  projects: [
    { name: 'brave', use: { browserKind: 'brave' } },
    { name: 'chromium', use: { browserKind: 'chromium' } },
  ],
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
});
