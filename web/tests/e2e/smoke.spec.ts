import { expect, test } from "@playwright/test";

// Smoke tests (SPEC §16.6 / §17.1). Run against a preview URL:
//   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app pnpm test:e2e
// Pages must render even when chain views fail, so these assert structure, not live numbers.

test("landing loads with the hero and live strip", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Plote — Pay for the house you can see/);
  await expect(page.getByRole("heading", { level: 1, name: "Pay for the house you can see." })).toBeVisible();
  await expect(page.getByText("UNITS ON PLOTE")).toBeVisible();
  await expect(page.getByText("Live from NEAR")).toBeVisible();
});

test("check page shows a result card for a demo unit", async ({ page }) => {
  await page.goto("/check?u=a-4b");
  await expect(page.getByRole("heading", { name: "Is this unit taken?" })).toBeVisible();
  // TAKEN once seeded; until then any of the defined states (or a clear error) is acceptable.
  await expect(page.getByText(/TAKEN|RESERVED|AVAILABLE|HANDED OVER|NOT A PLOTE UNIT|Couldn't check/).first()).toBeVisible({ timeout: 15_000 });
});

test("check page flags a unit that isn't on Plote", async ({ page }) => {
  await page.goto("/check?u=zz-99.not-an-estate.testnet");
  await expect(page.getByText(/NOT A PLOTE UNIT|Couldn't check/).first()).toBeVisible({ timeout: 15_000 });
});

test("estate page renders milestones or an error state", async ({ page }) => {
  await page.goto("/estates/harmattan-court");
  await expect(page.getByText(/Milestones|Couldn't load/).first()).toBeVisible({ timeout: 15_000 });
});

test("proof page renders the checklist or an error", async ({ page }) => {
  await page.goto("/proof/harmattan-court/0");
  await expect(page.getByText(/Checks|There is no evidence|Couldn't load/).first()).toBeVisible({ timeout: 15_000 });
});

test("watch page has OG tags", async ({ page }) => {
  await page.goto("/w/harmattan-court/a-4b");
  const og = page.locator('meta[property="og:image"]');
  await expect(og).toHaveAttribute("content", /\/api\/og\/unit\?estate=harmattan-court&unit=a-4b/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("API routes degrade with JSON errors", async ({ request }) => {
  const r = await request.post("/api/relay", { data: { signedDelegate: "x" } });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  const j = await r.json();
  expect(j).toHaveProperty("code");
  expect(j).toHaveProperty("message");
});
