import { expect, test } from "@playwright/test";
import { IPHONE_375, openDemo, openSettings, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

// SPEC §14 «Estados vacíos útiles»: lo vacío dice qué va ahí y ofrece la acción para empezar.
test.describe("estados vacíos con su acción", () => {
  test("Lugares sin lugares explica por dónde empezar y «Agregar lugar» abre el formulario", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await expect(sheet(page)).toContainText(
      "Todavía no guardaste ningún lugar. Empezá por tu casa",
    );
    await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
    await expect(sheet(page).getByLabel("Nombre", { exact: true })).toBeVisible();
    // Con el formulario abierto el aviso ya no estorba.
    await expect(sheet(page)).not.toContainText("Todavía no guardaste ningún lugar");
  });

  test("Ajustes sin resultados lo dice y «Ver todos los ajustes» vuelve a la lista", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettings(page);
    await sheet(page).getByRole("searchbox", { name: "Buscar un ajuste" }).fill("zzzz");
    await expect(sheet(page)).toContainText("No hay ningún ajuste con «zzzz»");
    await sheet(page).getByRole("button", { name: "Ver todos los ajustes" }).click();
    await expect(sheet(page).getByRole("button", { name: /^Rutinas/ })).toBeVisible();
  });

  test("Rutinas sin rutinas dice qué son y «Crear rutina nueva» abre el formulario", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettingsPage(page, "Rutinas");
    await sheet(page).getByRole("button", { name: /^Gym/ }).click();
    await sheet(page).getByRole("button", { name: "Eliminar…" }).click();
    await page.getByRole("button", { name: "Eliminar todo" }).click();
    await expect(sheet(page)).toContainText("Todavía no tenés rutinas");
    await sheet(page).getByRole("button", { name: "Crear rutina nueva" }).click();
    await expect(sheet(page).getByRole("heading", { name: "Rutina nueva" })).toBeVisible();
  });

  test("Bandeja vacía dice qué llega ahí y «Ver mi semana» lleva a la Semana", async ({ page }) => {
    await openDemo(page);
    await page
      .getByRole("navigation", { name: "Secciones" })
      .getByRole("button", { name: /^Bandeja/ })
      .click();
    const ver = page.getByRole("button", { name: "Ver mi semana" });
    // La demo trae cosas pendientes: se vacía respondiendo cada tarjeta.
    for (let i = 0; i < 40 && !(await ver.isVisible()); i++) {
      const next = page.getByRole("button", { name: /^(No hecho|Elegir): / }).first();
      if (!(await next.count())) break;
      await next.click();
    }
    await expect(page.getByText("Acá aparece lo que necesita una decisión tuya")).toBeVisible();
    await ver.click();
    await expect(page.getByTestId("week")).toBeVisible();
  });
});
