import { expect, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  MONDAY,
  openDemo,
  openSettings,
  openSettingsPage,
  sheet,
  toast,
} from "./helpers";

test.use(IPHONE_375);

// Hallazgos de la 33.ª vuelta del agente atacante.

for (const opcion of ["Hasta que lo reactive", "Solo esta semana"]) {
  test(`Deshacer de «${opcion}» con Ajustes abierto restaura la rutina y deja la hoja`, async ({
    page,
  }) => {
    await openDemo(page, MONDAY);
    await openSettingsPage(page, "Rutinas");
    await sheet(page).getByRole("button", { name: /^Gym/ }).first().click();
    await sheet(page).getByRole("button", { name: "Pausar…" }).click();
    await page.getByRole("button", { name: opcion }).click();
    await expect(toast(page)).toBeVisible();
    await toast(page).getByRole("button", { name: "Deshacer" }).click();
    // Ajustes sigue abierto y la rutina volvió.
    await expect(sheet(page)).toHaveAccessibleName("Rutinas");
    await expect(sheet(page).getByRole("button", { name: /^Gym/ }).first()).not.toContainText(
      /pausada|salteada/,
    );
  });
}

test("el aviso con «Deshacer» sigue a los 3 s sobre una hoja abierta (un toque tardío no cae en el fondo)", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Rutinas");
  await sheet(page).getByRole("button", { name: /^Gym/ }).first().click();
  await sheet(page).getByRole("button", { name: "Pausar…" }).click();
  await page.getByRole("button", { name: "Hasta que lo reactive" }).click();
  await expect(toast(page)).toBeVisible();
  await page.clock.fastForward(3000);
  await expect(toast(page)).toBeVisible();
  await page.clock.fastForward(1500);
  await expect(toast(page)).toBeHidden();
});

test("Escape en el detalle de una entrega con minutos escritos pregunta antes de descartar", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await goTab(page, "Silos");
  await page.locator(`.silo[data-task="informe-fis"]`).click();
  const hoja = sheet(page);
  await hoja.getByLabel("Le dediqué (minutos)").fill("90");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "¿Descartar los cambios?" })).toBeVisible();
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(hoja.getByLabel("Le dediqué (minutos)")).toHaveValue("90");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Escape en el detalle sin nada escrito cierra sin preguntar", async ({ page }) => {
  await openDemo(page, MONDAY);
  await goTab(page, "Silos");
  await page.locator(`.silo[data-task="informe-fis"]`).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Ajustes > Hoy con la hora editada: Escape pregunta; sin editar cierra", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettings(page);
  await sheet(page).getByLabel("Me acuesto a las").fill("23:30");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "¿Descartar los cambios?" })).toBeVisible();
  await page.getByRole("button", { name: "Seguir editando" }).click();
  await expect(sheet(page).getByLabel("Me acuesto a las")).toHaveValue("23:30");
});

test("buscador de Ajustes: Escape limpia el texto y el segundo cierra; un solo botón de limpiar", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettings(page);
  const caja = sheet(page).getByLabel("Buscar un ajuste");
  await caja.fill("almuerzo");
  await expect(sheet(page).getByRole("button", { name: "Limpiar búsqueda" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(caja).toHaveValue("");
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Mi semana: un valor inválido se ve en rojo y su mensaje queda junto al campo", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const hoja = sheet(page);
  const campo = hoja.getByLabel("Arreglarse, traslado (min)");
  await campo.fill("-5");
  await hoja.getByRole("button", { name: /^Guardar para/ }).click();
  await expect(campo).toHaveAttribute("aria-invalid", "true");
  const borde = await campo.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(borde).not.toBe(
    await hoja.getByLabel("Me levanto").evaluate((el) => getComputedStyle(el).borderTopColor),
  );
  const mensaje = hoja.locator("#week-error");
  await expect(mensaje).toBeVisible();
  const m = await mensaje.boundingBox();
  expect(m?.y).toBeGreaterThanOrEqual(0);
  expect((m?.y ?? 0) + (m?.height ?? 0)).toBeLessThanOrEqual(812);
});

test("rutina «Solo esta semana» se ve salteada en la lista de Rutinas", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Rutinas");
  await sheet(page).getByRole("button", { name: /^Gym/ }).first().click();
  await sheet(page).getByRole("button", { name: "Pausar…" }).click();
  await page.getByRole("button", { name: "Solo esta semana" }).click();
  await expect(sheet(page).getByRole("button", { name: /^Gym/ }).first()).toContainText("salteada");
});

test("«Guardar avance» deja el campo de minutos vacío al volver a abrir", async ({ page }) => {
  await openDemo(page, MONDAY);
  await goTab(page, "Silos");
  await page.locator(`.silo[data-task="tp-prog"]`).click();
  await sheet(page).getByLabel("Le dediqué (minutos)").fill("30");
  await sheet(page).getByRole("button", { name: "Guardar avance" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(`.silo[data-task="tp-prog"]`).click();
  await expect(sheet(page).getByLabel("Le dediqué (minutos)")).toHaveValue("");
});
