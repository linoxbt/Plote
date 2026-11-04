import { defineConfig, devices } from "@playwright/test";

// Smoke tests. Point PLAYWRIGHT_BASE_URL at a preview deployment, or run `pnpm build && pnpm start` locally.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    // Optional: use a preinstalled Chromium instead of `playwright install` (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
