import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  // Contra un sitio desplegado (preview, staging) solo corre el humo: los flujos de la demo se
  // prueban contra la build local en CI, y la protección de Vercel (SSO) los vuelve inestables
  // al abrir muchas páginas seguidas.
  testMatch: process.env.E2E_BASE_URL ? "smoke.spec.ts" : "*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    // On a Vercel preview, also hide the Vercel toolbar: on desktop it covers the sheet's close button.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          "x-vercel-skip-toolbar": "1",
        }
      : undefined,
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "bun run preview", url: baseURL, reuseExistingServer: !process.env.CI },
});
