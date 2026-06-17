import { defineConfig, devices } from '@playwright/test'

// Playwright é DEV-ONLY — nunca entra no runtime financeiro.
// Cobre o que o jsdom (Vitest) não cobre: layout real (@container, viewport,
// ausência de scroll horizontal). Os testes de contrato de CSS rodam via
// setContent (sem servidor); a varredura de overflow autenticada usa o webServer.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
  },
  webServer: {
    command: 'npm run dev -- --port 4321 --strictPort',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] }, // viewport mobile (~412x915)
    },
  ],
})
