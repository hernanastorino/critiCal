import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, sheet } from "./helpers";

test.use(IPHONE_375);
test.describe.configure({ timeout: 120_000 });

// Las opciones de «No llegás a todo» hacen lo que dicen y dejan valores que el formulario acepta.

/** Miércoles 25/11/2026, 10:00 en Montevideo. */
const MIERCOLES = new Date("2026-11-25T13:00:00Z");
const INFORME = "Informe corto SD";

async function demoDePruebas(page: Page) {
  await page.clock.install({ time: MIERCOLES });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: /^Reiniciar demo/ }).click();
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

async function abrirEditor(page: Page, titulo: string) {
  await goTab(page, "Silos");
  await page.locator(".silo[data-task]", { hasText: titulo }).first().click();
  await sheet(page).getByRole("button", { name: "Editar" }).click();
}

test("«Bajar el mínimo» cambia solo el mínimo, en minutos enteros", async ({ page }) => {
  await demoDePruebas(page);
  await goTab(page, "Bandeja");
  const opcion = page.locator(".card", { hasText: `Bajar el mínimo de ${INFORME}` });
  await expect(opcion).toBeVisible();
  await opcion.getByRole("button", { name: /^Elegir: / }).click();
  await expect(page.getByText(/^Listo, reacomodé el plan/)).toBeVisible();
  await abrirEditor(page, INFORME);
  // Las horas siguen siendo las de antes y el mínimo es un número redondo de minutos.
  await expect(sheet(page).getByLabel("Horas estimadas")).toHaveValue("10");
  const minimo = await sheet(page).getByLabel("Mínimo (horas)").inputValue();
  expect(Number.isInteger(Math.round(Number(minimo.replace(",", ".")) * 60))).toBe(true);
  expect(minimo).not.toMatch(/[.,]\d{4,}/);
});

test("una entrega de 50 h sin mínimo no queda en 0 h al quedarme con el mínimo", async ({
  page,
}) => {
  await demoDePruebas(page);
  await goTab(page, "Silos");
  await page.getByRole("button", { name: "Nueva actividad" }).click();
  const hoja = sheet(page);
  await hoja.getByLabel("Materia o actividad").selectOption({ index: 1 });
  await hoja.getByPlaceholder("Parcial Física I").fill("Prueba X");
  await hoja.getByLabel("Horas estimadas").fill("50");
  await hoja.getByLabel("Mínimo (horas)").fill("0");
  await hoja.getByRole("button", { name: /^Guardar/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await goTab(page, "Bandeja");
  const libre = page.getByRole("button", { name: /^Elegir: Usar tiempo libre/ });
  await expect(libre.first()).toBeVisible();
  await libre.first().click();
  // Con «Prueba X» sin mínimo, «quedarme con el mínimo» no la nombra ni la deja en 0.
  await expect(
    page.getByRole("button", { name: /^Elegir: Quedarme con el mínimo de .*Prueba X/ }),
  ).toHaveCount(0);
  await abrirEditor(page, "Prueba X");
  await expect(sheet(page).getByLabel("Horas estimadas")).toHaveValue("50");
});
