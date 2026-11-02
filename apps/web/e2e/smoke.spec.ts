import { expect, test } from "@playwright/test";

test("app loads and the engine responds", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "critiCal" })).toBeVisible();
  await expect(page.getByTestId("engine-status")).toHaveText(/listo/);
});

test("exposes a web app manifest", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href as string);
  expect((await res.json()).display).toBe("standalone");
});
