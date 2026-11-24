import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

// Hallazgos de la 32.ª vuelta del agente atacante.

test("Mi semana: un error al guardar lleva el foco y el scroll al campo, y Guardar no salta", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const hoja = sheet(page);
  const guardar = hoja.getByRole("button", { name: /^Guardar para/ });
  // Su lugar en el contenido de la hoja (el scroll que hace el foco no cuenta como salto).
  const altura = async () =>
    guardar.evaluate((el) => {
      const hoja = el.closest('[role="dialog"]') as HTMLElement;
      return Math.round(
        el.getBoundingClientRect().top - hoja.getBoundingClientRect().top + hoja.scrollTop,
      );
    });

  const antes = await altura();
  const acuesto = hoja.getByLabel("Me acuesto", { exact: true });
  await acuesto.fill("18:00");
  await acuesto.blur();
  // Cambiar un campo (y soltarlo) no mueve el botón: el primer toque cae donde estaba.
  expect(await altura()).toBe(antes);

  await hoja.getByLabel("Nada de estudio desde", { exact: true }).fill("19:30");
  await hoja.getByLabel("Cena", { exact: true }).fill("21:00");
  await guardar.scrollIntoViewIfNeeded();
  await guardar.click();

  const cena = hoja.getByLabel("Cena", { exact: true });
  await expect(cena).toBeFocused();
  await expect(cena).toHaveAttribute("aria-invalid", "true");
  const caja = await cena.boundingBox();
  expect(caja?.y).toBeGreaterThanOrEqual(0);
  expect((caja?.y ?? 0) + (caja?.height ?? 0)).toBeLessThanOrEqual(812);
});
