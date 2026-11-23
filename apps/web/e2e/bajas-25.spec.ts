import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, openNewRoutine, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

// 25.ª vuelta del agente atacante: borradores uniformes, topes de Lugares y comidas pasadas.
const pregunta = (page: Page) => page.getByRole("alertdialog", { name: "¿Descartar los cambios?" });

test.describe("Ajustes: lo escrito y no guardado se confirma igual salga por donde salga", () => {
  async function rutinaNueva(page: Page) {
    await openDemo(page);
    await openNewRoutine(page);
    await sheet(page).getByPlaceholder("Gimnasio").fill("Nadar");
  }

  test("Escape desde «Crear rutina nueva» pregunta", async ({ page }) => {
    await rutinaNueva(page);
    await page.keyboard.press("Escape");
    await expect(pregunta(page)).toBeVisible();
    await pregunta(page).getByRole("button", { name: "Seguir editando" }).click();
    await expect(sheet(page).getByPlaceholder("Gimnasio")).toHaveValue("Nadar");
  });

  test("«‹ Ajustes» pregunta y «Descartar» vuelve a la lista sin el borrador", async ({ page }) => {
    await rutinaNueva(page);
    await sheet(page).getByRole("button", { name: "Volver a Ajustes" }).click();
    await expect(pregunta(page)).toBeVisible();
    await pregunta(page).getByRole("button", { name: "Descartar" }).click();
    await expect(pregunta(page)).toHaveCount(0);
    await expect(sheet(page)).toHaveAccessibleName("Ajustes");
    await sheet(page)
      .getByRole("button", { name: /^Rutinas/ })
      .click();
    await expect(sheet(page).getByPlaceholder("Gimnasio")).toHaveCount(0);
  });
});

test.describe("Lugares", () => {
  test("dirección y alias tienen tope, y «Cancelar» con texto pregunta", async ({ page }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
    const direccion = sheet(page).getByLabel(/^Dirección/);
    await direccion.fill("x".repeat(400));
    await expect(direccion).toHaveValue("x".repeat(200));
    const alias = sheet(page).getByLabel(/^Alias/);
    await alias.fill("y".repeat(700));
    await expect(alias).toHaveValue("y".repeat(500));
    await sheet(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(pregunta(page)).toBeVisible();
    await pregunta(page).getByRole("button", { name: "Seguir editando" }).click();
    await expect(direccion).toHaveValue("x".repeat(200));
    await sheet(page).getByRole("button", { name: "Cancelar" }).click();
    await pregunta(page).getByRole("button", { name: "Descartar" }).click();
    await expect(direccion).toHaveCount(0);
  });
});

test.describe("Semana", () => {
  test("mantener apretada una comida de un día pasado avisa que el pasado no se cambia", async ({
    page,
  }) => {
    await openDemo(page);
    await goTab(page, "Semana");
    await page.getByRole("button", { name: "Semana anterior" }).click();
    const comida = page.getByTestId("week").locator(".pill.meal.past").first();
    await expect(comida).toBeVisible();
    const box = await comida.boundingBox();
    if (!box) throw new Error("la comida no tiene caja");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByText("Esa comida ya pasó: el pasado no se cambia.")).toBeVisible();
    await page.mouse.up();
  });
});
