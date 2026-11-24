import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

test("Mi semana marca todos los errores juntos, cada uno bajo su campo, y enfoca el primero", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const hoja = sheet(page);
  const traslado = hoja.getByLabel("Arreglarse, traslado (min)");
  const cena = hoja.getByLabel("Dura (min), cena");
  const libre = hoja.getByLabel("Nada de estudio desde");
  await traslado.fill("-5");
  await cena.fill("abc");
  await libre.fill("03:00");
  await hoja.getByRole("button", { name: /^Guardar para/ }).click();
  for (const campo of [traslado, cena, libre])
    await expect(campo).toHaveAttribute("aria-invalid", "true");
  await expect(hoja.locator("[role='alert']")).toHaveCount(3);
  await expect(traslado).toBeFocused();
  // Cada mensaje queda dentro de la pantalla, bajo su campo.
  const mensajeLibre = hoja.getByText(/«Nada de estudio desde».*antes de que te levantes/);
  await expect(mensajeLibre).toBeVisible();
  const campoBox = await libre.boundingBox();
  const mensajeBox = await mensajeLibre.boundingBox();
  expect(mensajeBox?.y ?? 0).toBeGreaterThan((campoBox?.y ?? 0) + (campoBox?.height ?? 0) - 1);
});

test("«Faltan» del silo y del detalle de la entrega dicen lo mismo", async ({ page }) => {
  await openDemo(page, MONDAY);
  await goTab(page, "Silos");
  const silo = page.locator(".silo[data-task='parcial-calc']");
  const etiqueta = (await silo.getAttribute("aria-label")) ?? "";
  const falta = etiqueta.match(/faltan (\w+)/)?.[1] ?? "";
  expect(falta).not.toBe("");
  await silo.click();
  await expect(sheet(page).getByText(`Faltan ${falta} (mínimo`)).toBeVisible();
});
