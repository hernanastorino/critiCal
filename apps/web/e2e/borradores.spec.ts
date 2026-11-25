import { expect, type Page, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  openDemo,
  openSettingsPage,
  reload,
  sheet,
  siloLabels,
} from "./helpers";

test.use(IPHONE_375);

// Borradores de formularios (#213, SPEC §14): recargar no pierde lo escrito y cerrar con cambios pregunta.
const nueva = (page: Page) => page.getByRole("dialog", { name: "Nueva actividad" });
const nombre = (page: Page) => nueva(page).getByPlaceholder("Parcial Física I");
const pregunta = (page: Page) => page.getByRole("alertdialog", { name: "¿Descartar los cambios?" });

async function abrirNueva(page: Page) {
  await goTab(page, "Silos");
  await page.getByRole("button", { name: "Nueva actividad" }).click();
  await expect(nueva(page)).toBeVisible();
}

test.describe("borradores: la actividad «Nueva»", () => {
  test("recargar con «Nueva» abierta la restaura con lo escrito", async ({ page }) => {
    await openDemo(page);
    await abrirNueva(page);
    await nombre(page).fill("Parcial de Álgebra");

    await page.reload();
    // Vuelve a la pestaña Silos, con el formulario abierto y el texto.
    await expect(nueva(page)).toBeVisible();
    await expect(nombre(page)).toHaveValue("Parcial de Álgebra");
  });

  test("sin cambios, Escape cierra sin preguntar", async ({ page }) => {
    await openDemo(page);
    await abrirNueva(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(pregunta(page)).toHaveCount(0);
  });

  test("con cambios, Escape pregunta; Escape en la pregunta sigue editando; «Descartar» borra", async ({
    page,
  }) => {
    await openDemo(page);
    await abrirNueva(page);
    await nombre(page).fill("Parcial de Álgebra");

    await page.keyboard.press("Escape");
    await expect(pregunta(page)).toBeVisible();
    await expect(pregunta(page).getByRole("button", { name: "Seguir editando" })).toBeFocused();

    // Escape en la pregunta es «Seguir editando»: el formulario y el texto siguen.
    await page.keyboard.press("Escape");
    await expect(pregunta(page)).toHaveCount(0);
    await expect(nombre(page)).toHaveValue("Parcial de Álgebra");

    // La ✕ también pregunta.
    await nueva(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(pregunta(page)).toBeVisible();
    await pregunta(page).getByRole("button", { name: "Descartar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Descartado de verdad: ni recargando vuelve.
    await reload(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("guardar borra el borrador y suma el silo", async ({ page }) => {
    await openDemo(page);
    await abrirNueva(page);
    await nombre(page).fill("Entrega final");
    await nueva(page).getByLabel("Materia o actividad").selectOption({ index: 1 });
    await nueva(page).getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => siloLabels(page))
      .toContainEqual(expect.stringMatching(/^Entrega final/));
    await reload(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("borradores: Ajustes", () => {
  test("recargar con un formulario de Ajustes escrito lo restaura; Escape con cambios pregunta", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
    await sheet(page).getByLabel("Nombre", { exact: true }).fill("Casa de Clara");

    await page.reload();
    await expect(sheet(page)).toHaveAccessibleName("Lugares y traslados");
    await expect(sheet(page).getByLabel("Nombre", { exact: true })).toHaveValue("Casa de Clara");

    // Cerrar Ajustes con algo escrito pregunta antes de tirarlo.
    // Con la hoja ya armada (el foco llegó a «Volver»), como lo haría una persona.
    await expect(sheet(page).getByRole("button", { name: "Volver a Ajustes" })).toBeFocused();
    // Escape con algo escrito en la pantalla pregunta (25.ª vuelta), igual que ✕ y el fondo.
    await page.keyboard.press("Escape");
    await expect(pregunta(page)).toBeVisible();
    await pregunta(page).getByRole("button", { name: "Seguir editando" }).click();
    await expect(pregunta(page)).toHaveCount(0);
    await expect(sheet(page)).toHaveAccessibleName("Lugares y traslados");
    // «Descartar» borra lo escrito y vuelve un nivel: a la lista de lugares; otro Escape, a Ajustes.
    await page.keyboard.press("Escape");
    await pregunta(page).getByRole("button", { name: "Descartar" }).click();
    await expect(sheet(page)).toHaveAccessibleName("Lugares y traslados");
    await expect(sheet(page).getByLabel("Nombre", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveAccessibleName("Ajustes");
  });
});
