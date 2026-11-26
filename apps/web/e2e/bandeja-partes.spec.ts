import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, siloLabels, toast, undo } from "./helpers";

test.use(IPHONE_375);

// «Hecho» en un bloque de una entrega con partes pregunta cuáles se hicieron (SPEC §3).
const hechos = (page: Page) => page.getByRole("button", { name: /^Hecho: / });
// El de Cálculo tiene partes (Práctico 4, Práctico 5…); el otro bloque pasado no.
const conPartes = (page: Page) => page.getByRole("button", { name: /^Hecho: Parcial Cálculo II/ });
const anotar = (page: Page) => page.getByRole("button", { name: "Anotar hecho" });

async function faltan(page: Page): Promise<string[]> {
  await goTab(page, "Silos");
  const labels = await siloLabels(page);
  await goTab(page, "Bandeja");
  return labels;
}

test.describe("Bandeja: «Hecho» pregunta las partes", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
    await goTab(page, "Bandeja");
    await expect(hechos(page)).toHaveCount(2);
  });

  test("elegir una parte baja «faltan»; Deshacer lo devuelve", async ({ page }) => {
    const antes = await faltan(page);
    await conPartes(page).first().click();
    await expect(anotar(page)).toBeVisible();
    await page.waitForTimeout(700);
    await page.locator(".chip").first().click();
    await anotar(page).click();
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await expect.poll(() => faltan(page)).not.toEqual(antes);
    await undo(page);
    await expect(hechos(page)).toHaveCount(2);
    expect(await faltan(page)).toEqual(antes);
  });

  test("sin elegir una parte, «Anotar hecho» no se puede tocar", async ({ page }) => {
    await conPartes(page).first().click();
    await expect(anotar(page)).toBeDisabled();
  });
});
