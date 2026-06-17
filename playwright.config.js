import { defineConfig, devices } from '@playwright/test'

// Playwright é DEV-ONLY — nunca entra no runtime financeiro.
// Cobre o que o jsdom (Vitest) não cobre: layout real (@container, viewport,
// ausência de scroll horizontal). Os testes de contrato de CSS rodam via
// setContent + CSS real do disco, então não exigem servidor nem auth.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] }, // viewport ~412x915, mobile
    },
  ],
})
