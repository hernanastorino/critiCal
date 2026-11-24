import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openSettings, sheet } from "./helpers";

test.use(IPHONE_375);

// «dormías» va en el centro de cada burbuja de lo que se perdió mientras el usuario dormía.
async function dormir(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  // Pasan cinco horas y recién ahí avisa a qué hora se levantó.
  await page.clock.setFixedTime(new Date(MONDAY.getTime() + 5 * 60 * 60 * 1000));
  await page.reload();
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await openSettings(page);
  await sheet(page).getByLabel("Me levanté a las").fill("12:30");
  await sheet(page).getByRole("button", { name: "Reacomodar hoy" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("«dormías» queda centrado, horizontal y verticalmente, en cada burbuja que se perdió", async ({
  page,
}) => {
  await dormir(page);
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
