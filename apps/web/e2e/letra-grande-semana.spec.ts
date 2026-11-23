import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY } from "./helpers";

test.use(IPHONE_375);

// Con la letra al tope (24 px de raíz) y la tarjeta «Primeros pasos» arriba (la demo de pruebas
// la muestra), la grilla de la Semana tiene que seguir siendo usable: no se la come la tarjeta.
// Se mide contra la pantalla y no en píxeles: las fuentes cambian de una plataforma a otra.
const GRILLA_MIN_PANTALLA = 0.45;

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
  expect(semana?.height ?? 0).toBeGreaterThanOrEqual(
    IPHONE_375.viewport.height * GRILLA_MIN_PANTALLA,
  );
});
