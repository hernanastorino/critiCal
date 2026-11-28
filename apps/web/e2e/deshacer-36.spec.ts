import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

async function demoDePruebas(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: /^Reiniciar demo/ }).click();
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

async function tocarFlecha(page: Page, rotulo: string) {
  // La flecha toca lo último que se hizo: se espera a que lo diga (y esté habilitada).
  const flecha = page.getByRole("button", { name: `Deshacer: ${rotulo}` });
  await expect(flecha).toBeEnabled();
  // Un toque en la flecha, bajo una hoja que se abrió hace menos de OPEN_GRACE_MS (modal.ts), deshace
  // pero no cierra la hoja: es el resto de un doble toque. Se adelanta el reloj de la página.
  await page.clock.fastForward(500);
  const box = await flecha.boundingBox();
  if (!box) throw new Error("sin flecha");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// 36.ª vuelta: la flecha bajo una hoja abierta solo cerraba la hoja.
test("la flecha de la cabecera deshace aunque Ajustes siga abierto", async ({ page }) => {
  test.slow();
  await demoDePruebas(page);
  await openSettingsPage(page, "Mi semana");
  const hoja = sheet(page);
  for (const d of ["lunes", "martes", "miércoles", "jueves", "viernes"]) {
    const chip = hoja.getByRole("button", { name: d, exact: true });
    if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click();
  }
  const campo = hoja.getByLabel("Dura (min), almuerzo");
  const antes = await campo.inputValue();
  await campo.fill(antes === "20" ? "25" : "20");
  await hoja.getByRole("button", { name: /^Guardar para/ }).click();
  await tocarFlecha(page, "guardar Mi semana");
  await expect(page.getByText("Deshecho: guardar Mi semana")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openSettingsPage(page, "Mi semana");
  await expect(sheet(page).getByLabel("Dura (min), almuerzo")).toHaveValue(antes);
});

test("borrar un lugar deja «Deshacer» en la flecha, con su dirección", async ({ page }) => {
  test.slow();
  await demoDePruebas(page);
  await openSettingsPage(page, "Lugares y traslados");
  const fila = sheet(page).locator(".place-row", { hasText: "Club Remeros" });
  await fila.getByRole("button", { name: /^Editar/ }).click();
  await sheet(page).getByRole("button", { name: "Borrar lugar" }).click();
  await expect(page.getByText(/Club Remeros borrado/)).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(page.getByText(/Club Remeros borrado/)).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Cerrar", exact: true }).first().click();
  await page.getByRole("button", { name: "Deshacer: borrar Club Remeros" }).click();
  await openSettingsPage(page, "Lugares y traslados");
  await expect(sheet(page).locator(".place-row", { hasText: "Club Remeros" })).toContainText(
    "Herrera 3365",
  );
});

test("eliminar una rutina deja «Deshacer» en la flecha", async ({ page }) => {
  test.slow();
  await demoDePruebas(page);
  await openSettingsPage(page, "Rutinas");
  await sheet(page)
    .getByRole("button", { name: /^Gym, / })
    .click();
  await sheet(page).getByRole("button", { name: "Eliminar…" }).click();
  await page.getByRole("button", { name: /^Eliminar de hoy en adelante/ }).click();
  await expect(page.getByText(/Gym eliminada/)).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(page.getByText(/Gym eliminada/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deshacer: eliminar Gym" })).toBeAttached();
  await tocarFlecha(page, "eliminar Gym");
  await openSettingsPage(page, "Rutinas");
  await expect(sheet(page).getByRole("button", { name: /^Gym, / })).toBeVisible();
});
