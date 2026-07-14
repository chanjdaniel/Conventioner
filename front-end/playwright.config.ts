import { defineConfig, devices } from '@playwright/test'
import { stack } from './e2e/helpers/stack'

const BASE_PORT = parseInt(process.env.FRONTEND_PORT ?? '', 10) || stack().frontendPort

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${BASE_PORT}`,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'on',
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
})
