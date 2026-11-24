import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY } from "./helpers";

test.use(IPHONE_375);

// Los bloques de repaso espaciado (7, 3 y 1 días antes de un parcial) llevan el ícono de
// «repetir» en la burbuja y «Repaso · tarea» en el nombre y en el globito.
test("un bloque de repaso muestra el ícono y «Repaso» en el globito", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  // Los repasos del parcial de la semana que viene empiezan a verse en esa semana.
  await page.getByLabel("Semana siguiente").click();
  const repasos = page.locator(".pill.planned.review");
  await expect(repasos.first()).toBeVisible();
  await expect(repasos.first().locator(".rev-ic svg")).toBeVisible();
  // Solo los repasos llevan ícono.
  await expect(page.locator(".pill.planned .rev-ic")).toHaveCount(await repasos.count());
  const nombre = (await repasos.first().getAttribute("aria-label")) ?? "";
  expect(nombre).toMatch(/^Repaso · /);
  await repasos.first().click();
  const titulo = nombre.split(",")[0] ?? "";
  await expect(page.getByRole("dialog").getByRole("heading", { name: titulo })).toBeVisible();
});
