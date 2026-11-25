import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openSettingsPage, reload, sheet } from "./helpers";

test.use(IPHONE_375);

async function demoDePruebas(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

// 36.ª vuelta: con el formulario de Gym a medio editar, eliminar la rutina y tocar Guardar
// la traía de vuelta sin avisar.
test("eliminar una rutina con un borrador guardado no deja formulario ni la deshace", async ({
  page,
}) => {
  // La demo de pruebas arma un plan cargado: en CI cada prueba tarda.
  test.slow();
  await demoDePruebas(page);
  await openSettingsPage(page, "Rutinas");
  await sheet(page)
    .getByRole("button", { name: /^Gym, / })
    .click();
  await sheet(page).getByRole("button", { name: "Editar" }).click();
  await sheet(page).getByLabel("Minutos por vez").fill("45");

  // Recargar trae el formulario con el borrador, y la X de Ajustes pregunta como siempre.
  await reload(page);
  await expect(sheet(page).getByLabel("Minutos por vez")).toHaveValue("45");
  await page.getByRole("button", { name: "Cerrar", exact: true }).last().click();
  await expect(page.getByRole("alertdialog", { name: "¿Descartar los cambios?" })).toBeVisible();

  // Descartar vuelve a la rutina como estaba, sin formulario pegado.
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(sheet(page).getByLabel("Minutos por vez")).toHaveCount(0);
  await sheet(page)
    .getByRole("button", { name: /^Gym, / })
    .click();
  await sheet(page).getByRole("button", { name: "Eliminar…" }).click();
  await page.getByRole("button", { name: /^Eliminar de hoy en adelante/ }).click();
  await expect(page.getByText(/Gym eliminada/)).toBeVisible();
  await expect(sheet(page).getByLabel("Minutos por vez")).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /^Gym, / })).toHaveCount(0);
});

test("eliminar la rutina con el formulario restaurado lo cierra y no la recrea", async ({
  page,
}) => {
  // La demo de pruebas arma un plan cargado: en CI cada prueba tarda.
  test.slow();
  await demoDePruebas(page);
  await openSettingsPage(page, "Rutinas");
  await sheet(page)
    .getByRole("button", { name: /^Gym, / })
    .click();
  await sheet(page).getByRole("button", { name: "Editar" }).click();
  await sheet(page).getByLabel("Minutos por vez").fill("45");
  await reload(page);
  await expect(sheet(page).getByLabel("Minutos por vez")).toHaveValue("45");
  // Detalle y formulario no conviven: el formulario restaurado cubre la lista.
  await expect(sheet(page).getByRole("button", { name: "Eliminar…" })).toHaveCount(0);
});
