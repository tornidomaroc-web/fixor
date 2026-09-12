// ASSUMED-PATH: apps/web/e2e/login-flow.e2e.ts
// apps/web/e2e/login-flow.e2e.ts
import { test, expect } from "@playwright/test";

const seededUser = { email: "e2e-user@example.com", password: "PlaywrightPass123!" };

test("signs in with the seeded account", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", seededUser.email);
  await page.fill("#password", seededUser.password);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/dashboard/);
});
