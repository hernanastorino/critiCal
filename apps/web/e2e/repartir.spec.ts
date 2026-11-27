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
