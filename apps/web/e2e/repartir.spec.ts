import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, sheet, toast } from "./helpers";

test.use(IPHONE_375);

// «Repartir tiempo» (SPEC §18 punto 18): el total, un slider por tema, «sin asignar» y Aceptar.
test.describe.configure({ timeout: 90_000 });

const MIERCOLES = new Date("2026-11-25T13:00:00Z");

async function abrirHoja(page: Page, silo: string) {
  await page.clock.install({ time: MIERCOLES });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await goTab(page, "Silos");
  await page.locator(".silo[data-task]", { hasText: silo }).first().click();
  await sheet(page).getByRole("button", { name: "Repartir tiempo" }).click();
  await expect(sheet(page)).toHaveAccessibleName("Repartir tiempo");
}

test("el parcial con temas se reparte por peso y se acepta, sin desborde a 375 px", async ({
  page,
}) => {
  await abrirHoja(page, "Parcial Física I");
  const hoja = sheet(page);
  const ancho = await hoja.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(ancho[0]).toBeLessThanOrEqual(ancho[1] ?? 0);
  await expect(hoja.getByRole("slider", { name: "Total" })).toBeVisible();
  await expect(hoja.getByRole("slider", { name: "Cinemática" })).toBeVisible();
  // Los tres botones de reparto miden lo mismo (43.ª vuelta).
  const altos = await hoja
    .locator(".rep-presets .btn")
    .evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
  expect(altos).toHaveLength(3);
  expect(new Set(altos).size).toBe(1);

  // Mover el total deja tiempo sin asignar y apaga Aceptar.
  await hoja.getByRole("slider", { name: "Total" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(hoja.getByRole("button", { name: "Aceptar reparto" })).toBeDisabled();
  await expect(hoja.locator(".rep-rest.red")).toBeVisible();

  await hoja.getByRole("button", { name: "Por peso" }).click();
  await expect(hoja.getByRole("button", { name: "Aceptar reparto" })).toBeEnabled();
  await hoja.getByRole("button", { name: "Aceptar reparto" }).click();
  await expect(toast(page)).toContainText("Repartiste");
  await toast(page).getByRole("button", { name: "Deshacer" }).click();
});

test("temas nuevos: el nombre es obligatorio y Aceptar se apaga", async ({ page }) => {
  await abrirHoja(page, "Parcial Física I");
  const hoja = sheet(page);
  await hoja.getByRole("button", { name: "+ Tema" }).click();
  await hoja.getByRole("textbox", { name: /^Nombre del tema \d+$/ }).fill("   ");
  await expect(hoja.getByText("Poné un nombre para el tema")).toBeVisible();
  await expect(hoja.getByRole("button", { name: "Aceptar reparto" })).toBeDisabled();
});

test("la hora tocable abre el selector de horas y minutos", async ({ page }) => {
  await abrirHoja(page, "Informe corto SD");
  await sheet(page).getByRole("button", { name: "Escribir las horas de Total" }).click();
  const selector = sheet(page);
  await selector.getByLabel("Horas").fill("12");
  await selector.getByRole("radio", { name: "30" }).click();
  await selector.getByRole("button", { name: "Guardar horas" }).click();
  await expect(sheet(page).getByRole("slider", { name: "Total" })).toHaveAttribute(
    "aria-valuetext",
    /^Total, 12 horas 30/,
  );
});

// 45.ª vuelta: «Repartir tiempo» en una entrega nueva sin materia no tira la app.
for (const demo of ["/?demo=pruebas", "/"]) {
  test(`entrega nueva sin materia: la hoja abre y no se cae la app (${demo})`, async ({ page }) => {
    await page.clock.install({ time: MIERCOLES });
    await page.goto(demo);
    if (demo === "/")
      await page.getByRole("button", { name: "Probar con datos de ejemplo" }).click();
    await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
    await goTab(page, "Silos");
    await page.getByRole("button", { name: "Nueva actividad" }).click();
    const form = sheet(page);
    await form.getByLabel("Horas estimadas").fill("1");
    await form.getByLabel("Mínimo (horas)").fill("0");
    for (const materia of ["", "new"]) {
      // Arranca sin materia («Elegí…» no se puede volver a elegir).
      if (materia) await form.getByLabel("Materia o actividad").selectOption(materia);
      await form.getByRole("button", { name: "Repartir tiempo" }).click();
      await expect(sheet(page)).toHaveAccessibleName("Repartir tiempo");
      await expect(page.getByText("Algo falló")).toHaveCount(0);
      await sheet(page).getByRole("button", { name: "Cerrar" }).click();
    }
  });
}

test("el Total por debajo del mínimo avisa que el mínimo baja", async ({ page }) => {
  await abrirHoja(page, "Parcial Física I");
  const hoja = sheet(page);
  await hoja.getByRole("slider", { name: "Total" }).focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowLeft");
  await expect(hoja.locator(".rep-lowered")).toContainText("El mínimo baja a");
});
