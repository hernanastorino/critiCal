import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openNewRoutine, openSettings, sheet } from "./helpers";

test.use(IPHONE_375);

// Bajas de la 30.ª vuelta del agente atacante (y dos de la 23.ª).

test("Rutina nueva: un mensaje que aparece no mueve el botón de «Agregar rutina»", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openNewRoutine(page);
  const hoja = sheet(page);
  const agregar = hoja.getByRole("button", { name: "Agregar rutina" });
  const y0 = (await agregar.boundingBox())?.y;
  // Escribir el primer carácter y un dato inválido hacen aparecer avisos.
  await hoja.getByLabel("Rutina", { exact: true }).fill("Natación");
  const y1 = (await agregar.boundingBox())?.y;
  await hoja.getByLabel("Veces/sem.").fill("99");
  const y2 = (await agregar.boundingBox())?.y;
  await hoja.getByLabel("Veces/sem.").fill("3");
  await hoja.getByLabel("Minutos", { exact: true }).fill("0");
  const y3 = (await agregar.boundingBox())?.y;
  expect([y1, y2, y3]).toEqual([y0, y0, y0]);
});

test("el nombre de una rutina tiene el mismo tope que el resto de los nombres", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openNewRoutine(page);
  await expect(sheet(page).getByLabel("Rutina", { exact: true })).toHaveAttribute(
    "maxlength",
    "60",
  );
});

test("Ajustes sin resultados no se achica por debajo de su alto al abrir", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettings(page);
  const hoja = sheet(page);
  const alto = (await hoja.boundingBox())?.height ?? 0;
  await hoja.getByRole("searchbox", { name: "Buscar un ajuste" }).fill("zzzzzz");
  const despues = (await hoja.boundingBox())?.height ?? 0;
  expect(despues).toBeGreaterThanOrEqual(alto - 1);
});

test("en modo demo las casillas de notificaciones están deshabilitadas", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettings(page);
  const hoja = sheet(page);
  await hoja.getByRole("button", { name: /^Notificaciones/ }).click();
  const casillas = await hoja.getByRole("checkbox").all();
  expect(casillas.length).toBeGreaterThan(0);
  for (const c of casillas) await expect(c).toBeDisabled();
});

test("un aviso largo con una hoja abierta no baja de la franja que la hoja deja libre", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettings(page);
  await page.evaluate(() => {
    const t = document.createElement("div");
    t.className = "snack";
    t.innerHTML = `<span>${"Aviso muy largo ".repeat(40)}</span>`;
    document.querySelector(".toasts [role=status]")?.append(t);
  });
  const aviso = await page.locator(".toasts .snack").boundingBox();
  const hoja = await sheet(page).boundingBox();
  expect((aviso?.y ?? 0) + (aviso?.height ?? 0)).toBeLessThanOrEqual(hoja?.y ?? 0);
});

test("tema claro: la hoja de Ajustes es opaca", async ({ browser }) => {
  const ctx = await browser.newContext({ ...IPHONE_375, colorScheme: "light" });
  const page = await ctx.newPage();
  await openDemo(page, MONDAY);
  await openSettings(page);
  const fondo = await sheet(page).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(fondo).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/);
  await ctx.close();
});
