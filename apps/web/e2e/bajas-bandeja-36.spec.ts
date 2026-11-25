import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo } from "./helpers";

test.use(IPHONE_375);

// Bajas de las vueltas 35 y 36: Bandeja y comidas.

test("un toque sobre una comida salteada abre sus opciones, no la restaura", async ({ page }) => {
  test.slow();
  await openDemo(page, MONDAY);
  await page.getByRole("button", { name: /^Cena, lun 21:00/ }).click();
  await page.getByRole("button", { name: /no cena$/ }).click();
  await expect(page.getByRole("button", { name: /^Cena, lun 21:00/ })).toHaveCount(0);
  await page.getByRole("button", { name: /sacada ese día, lun 21:00/ }).click();
  // Abrió sus opciones y la cena sigue sacada hasta que se pida volver a ponerla.
  await expect(page.getByRole("button", { name: /^Cena, lun 21:00/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a ponerlo" }).click();
  await expect(page.getByRole("button", { name: /^Cena, lun 21:00/ })).toBeVisible();
});
