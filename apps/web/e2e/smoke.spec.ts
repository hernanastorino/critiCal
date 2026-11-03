import { expect, test } from "@playwright/test";

test("demo: week, critical path, bubble, silos and inbox", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "critiCal" })).toBeVisible();
  await page.getByRole("button", { name: "Probar con datos de ejemplo" }).click();

  const week = page.getByTestId("week");
  await expect(week).toBeVisible();
  await expect(week.locator(".pill.planned").first()).toBeVisible();

  // The whole week fits on screen without scrolling.
  const box = await week.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height <= viewport.height).toBeTruthy();

  const toggle = page.getByRole("button", { name: "Camino crítico" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(week).toHaveClass(/critical-mode/);
  await toggle.click();

  await week.locator(".pill.planned:not(.past)").first().click();
  const bubble = page.locator(".bubble");
  await expect(bubble).toContainText("Faltan");
  await bubble.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar" }).last().click();

  await page.getByRole("button", { name: /Silos/ }).click();
  await expect(page.getByRole("heading", { name: "Lo que falta" })).toBeVisible();

  await page.getByRole("button", { name: /Bandeja/ }).click();
  await expect(page.getByRole("heading", { name: "Bandeja" })).toBeVisible();
});

test("exposes a web app manifest", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href as string);
  expect((await res.json()).display).toBe("standalone");
});

test("serves the privacy policy", async ({ page }) => {
  await page.goto("/privacy.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Política de privacidad");
});

test("deploys the sync functions", async ({ request }) => {
  test.skip(!process.env.E2E_BASE_URL, "only against a deployed site");
  for (const name of ["google-sync", "icloud-sync"]) {
    const res = await request.post(`/api/${name}`, { data: {} });
    // 401 without a session, 503 until the server secrets are set; never 404.
    expect([401, 503]).toContain(res.status());
  }
});
