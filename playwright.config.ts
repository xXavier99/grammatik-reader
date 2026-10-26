import { defineConfig } from '@playwright/test';

// E2E smoke tests run against the production build served from a sub-path,
// like GitHub Pages (https://<user>.github.io/<repo>/).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/grammatik-reader/',
    viewport: { width: 1400, height: 900 },
    browserName: 'chromium',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --base /grammatik-reader/',
    url: 'http://localhost:4173/grammatik-reader/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
