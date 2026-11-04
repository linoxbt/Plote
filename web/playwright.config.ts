import { defineConfig, devices } from "@playwright/test";

// Smoke tests. Point PLAYWRIGHT_BASE_URL at a preview deployment, or run `pnpm build && pnpm start` locally.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
