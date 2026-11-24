import { type Browser, expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettings, sheet } from "./helpers";

test.use(IPHONE_375);

// «dormías» va en el centro de cada burbuja de lo que se perdió mientras el usuario dormía.
// Primero se arma el día a las 08:00; ocho horas después, en otra página con lo guardado, recién
// ahí avisa a qué hora se levantó. (Con la hora clavada o saltando de golpe en la misma página,
// las animaciones de la hoja nunca terminan.)
async function dormir(browser: Browser, page: Page): Promise<Page> {
  await openDemo(page, MONDAY);
  const storageState = await page.context().storageState();
  const contexto = await browser.newContext({
    ...test.info().project.use,
    ...IPHONE_375,
    storageState,
  });
  const tarde = await contexto.newPage();
  await tarde.clock.install({ time: new Date(MONDAY.getTime() + 8 * 60 * 60 * 1000) });
  await tarde.goto("/");
  await expect(tarde.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await openSettings(tarde);
  await sheet(tarde).getByLabel("Me levanté a las").fill("15:00");
  await sheet(tarde).getByRole("button", { name: "Reacomodar hoy" }).click();
  await expect(tarde.getByRole("dialog")).toHaveCount(0);
  return tarde;
}

test("«dormías» queda centrado, horizontal y verticalmente, en cada burbuja que se perdió", async ({
  browser,
  page: inicial,
}) => {
  const page = await dormir(browser, inicial);
  const pastillas = page.locator(".pill.planned.slept");
  await expect(pastillas.first()).toBeVisible();
  const cuantas = await pastillas.count();
  expect(cuantas).toBeGreaterThanOrEqual(2);
  // Cada burbuja dormida tiene su rótulo, y ninguna otra.
  await expect(page.locator(".pill.planned .slept-label")).toHaveCount(cuantas);
  for (let i = 0; i < cuantas; i++) {
    const caja = await pastillas.nth(i).boundingBox();
    const rotulo = await pastillas.nth(i).locator(".slept-label").boundingBox();
    if (!caja || !rotulo) throw new Error("sin caja");
    expect(Math.abs(rotulo.x + rotulo.width / 2 - (caja.x + caja.width / 2))).toBeLessThanOrEqual(
      2,
    );
    expect(Math.abs(rotulo.y + rotulo.height / 2 - (caja.y + caja.height / 2))).toBeLessThanOrEqual(
      2,
    );
  }
});
