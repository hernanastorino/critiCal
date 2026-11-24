import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettingsPage, reload, sheet } from "./helpers";

test.use(IPHONE_375);

// Bajas de la 34.ª vuelta del agente atacante.

test("tras recargar con Ajustes restaurado, «atrás» lo cierra de a un nivel", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Reglas");
  // Un borrador sin guardar es lo que hace que Ajustes vuelva abierto tras recargar.
  await sheet(page).getByLabel("Margen antes de cada evento (min)").fill("35");
  await reload(page);
  await expect(sheet(page)).toHaveAccessibleName("Reglas");
  await page.goBack();
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("week")).toBeVisible();
});
