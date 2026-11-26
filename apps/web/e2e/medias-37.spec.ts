import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, toast, undo } from "./helpers";

test.use(IPHONE_375);

test("Bandeja: doble toque en ✓ no marca la parte; sin elegir parte no se anota", async ({
  page,
}) => {
  test.slow();
  await openDemo(page);
  await goTab(page, "Bandeja");
  const hecho = page.getByRole("button", { name: /^Hecho: Parcial Cálculo II/ }).first();
  await hecho.click();
  const anotar = page.getByRole("button", { name: "Anotar hecho" });
  await expect(anotar).toBeDisabled();
  // El segundo toque de un doble toque cae en la parte que apareció debajo.
  await page.locator(".chip").first().click({ force: true });
  await expect(page.locator(".chip.on")).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.locator(".chip").first().click();
  await expect(anotar).toBeEnabled();
});

test("Bandeja: «Planificar así» avisa y deja deshacer", async ({ page }) => {
  test.slow();
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await goTab(page, "Bandeja");
  const planificar = page.getByRole("button", { name: "Planificar así" });
  await planificar.click();
  await expect(toast(page)).toContainText("planificada");
  await expect(planificar).toHaveCount(0);
  await undo(page);
  await expect(planificar).toBeVisible();
});
