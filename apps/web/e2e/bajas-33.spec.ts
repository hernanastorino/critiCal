import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettingsPage, toast } from "./helpers";

test.use(IPHONE_375);

// Bajas de la 33.ª vuelta del agente atacante.

test("Enter en un campo de Mi semana guarda, como el botón", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const campo = page.getByLabel("Arreglarse, traslado (min)");
  await campo.fill("40");
  await campo.press("Enter");
  await expect(toast(page)).toContainText("Mi semana guardada");
});
