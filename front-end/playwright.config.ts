import { defineConfig, devices } from '@playwright/test';

function detectFrontendPort(): number {
  const envPort = process.env.FRONTEND_PORT;
  if (envPort) return parseInt(envPort, 10);

  const cwd = process.cwd();
  const match = cwd.match(/\.treehouse\/[^/]+\/(\d+)\//);
  if (match) {
    const slot = parseInt(match[1], 10);
    return 5173 + slot * 10;
  }
  return 5173;
}

const BASE_PORT = detectFrontendPort();

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${BASE_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'echo "Web server is managed externally (docker compose)"',
    port: BASE_PORT,
    reuseExistingServer: true,
  },
});
