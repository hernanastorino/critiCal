import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY } from "./helpers";

test.use(IPHONE_375);

// Con la letra al tope (24 px de raíz) y la tarjeta «Primeros pasos» arriba (la demo de pruebas
// la muestra), la grilla de la Semana tiene que seguir siendo usable: no se la come la tarjeta.
const GRILLA_MIN = 400;

test("letra grande: la Semana con «Primeros pasos» deja la grilla usable", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  await expect(page.getByText(/^Primeros pasos/)).toBeVisible();
  const semana = await page.getByTestId("week").boundingBox();
  const tarjeta = await page.locator(".first-steps").boundingBox();
  expect(semana?.height ?? 0).toBeGreaterThanOrEqual(GRILLA_MIN);
});
