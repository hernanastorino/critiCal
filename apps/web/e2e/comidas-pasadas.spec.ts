import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

/** Los almuerzos que se ven en la semana, como texto de su etiqueta («Almuerzo, lun 13:00 a 13:45…»). */
async function almuerzos(page: Page): Promise<string[]> {
  const labels = await page
    .getByTestId("week")
    .locator(".pill.meal")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.filter((l) => /^Almuerzo/i.test(l));
}

async function semanaAnterior(page: Page) {
  await page.getByRole("button", { name: "Semana anterior" }).click();
}

test.describe("comidas pasadas: un cambio en «Mi semana» no las toca", () => {
  test("quitar el almuerzo (duración 0) de lunes a viernes deja los almuerzos de las semanas pasadas", async ({
    page,
  }) => {
    await openDemo(page);
    await goTab(page, "Semana");
    await semanaAnterior(page);
    const antes = await almuerzos(page);
    expect(antes.length).toBeGreaterThanOrEqual(5);
    await semanaAnterior(page);
    const antes2 = await almuerzos(page);
    expect(antes2.length).toBeGreaterThanOrEqual(5);

    await openSettingsPage(page, "Mi semana");
    const hoja = sheet(page);
    for (const d of ["lunes", "martes", "miércoles", "jueves", "viernes"]) {
      const chip = hoja.getByRole("button", { name: d, exact: true });
      if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
    }
    await hoja.getByLabel("Dura (min), almuerzo").fill("0");
    await hoja.getByRole("button", { name: /^Guardar para/ }).click();
    await hoja.getByRole("button", { name: "Cerrar", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // La Semana sigue donde estaba (dos semanas atrás): ahí y una semana después, todo igual;
    // desde hoy ya no hay almuerzos de lunes a viernes.
    await expect.poll(async () => await almuerzos(page)).toEqual(antes2);
    await page.getByRole("button", { name: "Semana siguiente" }).click();
    await expect.poll(async () => await almuerzos(page)).toEqual(antes);
    // La semana actual: lo que ya pasó (lunes a viernes) se queda.
    await page.getByRole("button", { name: "Semana siguiente" }).click();
    const habituales = (ls: string[]) => ls.filter((l) => /, (lun|mar|mié|jue|vie) /.test(l));
    await expect.poll(async () => habituales(await almuerzos(page)).length).toBe(5);
    // La que viene ya no tiene almuerzos de lunes a viernes.
    await page.getByRole("button", { name: "Semana siguiente" }).click();
    await expect.poll(async () => habituales(await almuerzos(page)).length).toBe(0);
  });
});
