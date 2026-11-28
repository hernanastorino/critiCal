import { expect, type Page, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  MONDAY,
  openDemo,
  openSettings,
  openSettingsPage,
  SUNDAY,
  sheet,
} from "./helpers";

test.use(IPHONE_375);

// Bajas de la 45.ª vuelta, medidas en WebKit a 375×812.

async function demoDePruebas(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

test("las flechas de semana y los selects miden 44 px", async ({ page }) => {
  await openDemo(page, MONDAY);
  for (const name of ["Semana anterior", "Semana siguiente"]) {
    const box = await page.getByRole("button", { name }).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await goTab(page, "Silos");
  await page.getByRole("button", { name: "Nueva actividad" }).click();
  const selects = await sheet(page).locator("select").all();
  expect(selects.length).toBeGreaterThan(0);
  for (const select of selects) {
    expect((await select.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // La fecha límite sale a las 23:59 y las partes no quedan pegadas a «Repartir tiempo».
  await expect(sheet(page).getByLabel("Fecha límite")).toHaveValue(/T23:59$/);
  const repartir = await sheet(page).getByRole("button", { name: "Repartir tiempo" }).boundingBox();
  const partes = await sheet(page).getByText("Partes (opcional)").boundingBox();
  expect((partes?.y ?? 0) - ((repartir?.y ?? 0) + (repartir?.height ?? 0))).toBeGreaterThanOrEqual(
    8,
  );
});

test("los botones chicos de la Bandeja miden 44 px de alto", async ({ page }) => {
  test.slow();
  await demoDePruebas(page);
  await goTab(page, "Bandeja");
  const botones = await page.locator(".btn.small:visible").all();
  expect(botones.length).toBeGreaterThan(0);
  for (const boton of botones) {
    expect((await boton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("letra grande: las barras de la planificación no parten «5h30»", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
  await openDemo(page, SUNDAY);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await openSettings(page);
  await sheet(page).getByRole("button", { name: "Planificación semanal" }).click();
  const horas = await page.locator(".week-hours").all();
  expect(horas.length).toBe(7);
  for (const h of horas) {
    const lines = await h.evaluate((el) => {
      return el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).fontSize);
    });
    // Una sola línea: nunca «5h3» arriba y «0» abajo.
    expect(lines).toBeLessThan(1.6);
  }
});

test("Respaldo explica lo que hace", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Respaldo");
  await expect(sheet(page)).toContainText("Guardá una copia de tus datos");
});

test("Notificaciones, en la demo, no tiene nada tildado", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Notificaciones");
  for (const casilla of await sheet(page).getByRole("checkbox").all()) {
    await expect(casilla).not.toBeChecked();
    await expect(casilla).toBeDisabled();
  }
});
