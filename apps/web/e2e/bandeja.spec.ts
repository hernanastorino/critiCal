import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, sheet, toast, undo } from "./helpers";

test.use(IPHONE_375);

// Domingo 12:00: la Bandeja tiene dos bloques pasados sin responder y una opción para elegir.
const hechos = (page: Page) => page.getByRole("button", { name: /^Hecho: / });
const partes = (page: Page) => page.getByRole("button", { name: /^Hice una parte: / });
const noHechos = (page: Page) => page.getByRole("button", { name: /^No hecho: / });
const elegir = (page: Page) => page.getByRole("button", { name: /^Elegir: / });

test.describe("Bandeja: cada acción tiene su «Deshacer»", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
    await goTab(page, "Bandeja");
    await expect(hechos(page)).toHaveCount(2);
    await expect(elegir(page)).toHaveCount(1);
  });

  test("Hecho", async ({ page }) => {
    await hechos(page).first().click();
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await expect(hechos(page)).toHaveCount(1);
    await undo(page);
    await expect(hechos(page)).toHaveCount(2);
  });

  test("No hecho", async ({ page }) => {
    await noHechos(page).first().click();
    await expect(toast(page)).toContainText("Anotado, sin culpa");
    await expect(noHechos(page)).toHaveCount(1);
    await undo(page);
    await expect(noHechos(page)).toHaveCount(2);
  });

  test("Hice una parte (abre la hoja del bloque)", async ({ page }) => {
    await partes(page).first().click();
    await sheet(page)
      .getByRole("button", { name: /^\s*Parcial$/ })
      .click();
    await sheet(page).getByRole("button", { name: "Guardar parcial" }).click();
    await expect(toast(page)).toContainText("Anotado como parcial.");
    await expect(hechos(page)).toHaveCount(1);
    await undo(page);
    await expect(hechos(page)).toHaveCount(2);
  });

  test("Elegir una opción: «Deshacer» en «Decisiones que tomaste» la trae de vuelta", async ({
    page,
  }) => {
    await elegir(page).click();
    await expect(toast(page)).toContainText("Listo, reacomodé el plan");
    await expect(elegir(page)).toHaveCount(0);
    await expect(page.getByText("Decisiones que tomaste")).toBeVisible();

    await page.getByRole("button", { name: /^Deshacer: / }).click();
    await expect(toast(page)).toContainText("Deshecho:");
    await expect(elegir(page)).toHaveCount(1);
    await expect(page.getByText("Decisiones que tomaste")).toHaveCount(0);
  });
});
