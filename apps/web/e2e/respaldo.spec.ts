import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  openDemo,
  openSettingsPage,
  reload,
  sheet,
  siloLabels,
  toast,
} from "./helpers";

test.use(IPHONE_375);

/** Ajustes → Respaldo → «Exportar JSON»: el archivo que baja, como texto. */
async function exportar(page: Page): Promise<string> {
  await openSettingsPage(page, "Respaldo");
  const bajada = page.waitForEvent("download");
  await sheet(page).getByRole("button", { name: "Exportar JSON" }).click();
  const download = await bajada;
  expect(download.suggestedFilename()).toMatch(/^critical-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  return readFile(path, "utf8");
}

async function importar(page: Page, json: string) {
  await sheet(page)
    .getByLabel("Archivo de respaldo")
    .setInputFiles({
      name: "respaldo.json",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  await expect(toast(page)).toContainText("Datos importados");
}

/** Lo que se ve de la demo: silos, bloques de la semana y cuántas cosas hay en la Bandeja. */
async function foto(page: Page) {
  if (await page.getByRole("dialog").count()) {
    await page.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await goTab(page, "Silos");
  const silos = await siloLabels(page);
  await goTab(page, "Semana");
  const bloques = await page
    .getByTestId("week")
    .locator(".pill")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const bandeja = (await page.getByRole("navigation", { name: "Secciones" }).textContent()) ?? "";
  return { silos, bloques, bandeja };
}

test.describe("respaldo: exportar desde la demo e importar", () => {
  test("el archivo exportado vuelve a entrar sin duplicar nada y persiste al recargar", async ({
    page,
  }) => {
    await openDemo(page);
    const antes = await foto(page);
    expect(antes.silos.length).toBeGreaterThan(3);

    const json = await exportar(page);
    const archivo = JSON.parse(json) as { app: string; data: { tasks: unknown[] } };
    expect(archivo.app).toBe("critiCal");
    expect(archivo.data.tasks.length).toBeGreaterThan(0);

    await importar(page, json);
    expect(await foto(page)).toEqual(antes);

    // Importar el mismo archivo otra vez tampoco suma nada.
    await openSettingsPage(page, "Respaldo");
    await importar(page, json);
    expect(await foto(page)).toEqual(antes);

    await reload(page);
    expect(await foto(page)).toEqual(antes);
    await goTab(page, "Silos");
    await expect.poll(() => siloLabels(page)).toEqual(antes.silos);
  });

  test("importar trae de vuelta lo exportado aunque se haya cambiado la demo, y «Deshacer» lo revierte", async ({
    page,
  }) => {
    await openDemo(page);
    const json = await exportar(page);
    const original = await foto(page);

    // Se agrega una rutina nueva: la demo ya no es la que se exportó.
    await openSettingsPage(page, "Rutinas");
    await sheet(page).getByLabel("Rutina", { exact: true }).fill("Natación");
    await sheet(page).getByRole("button", { name: "Agregar rutina" }).click();
    await expect(sheet(page).getByRole("button", { name: /^Natación, / })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar", exact: true }).first().click();
    await goTab(page, "Silos");
    await expect.poll(async () => (await siloLabels(page)).length).toBe(original.silos.length + 1);

    await goTab(page, "Semana");
    await openSettingsPage(page, "Respaldo");
    await importar(page, json);
    const despues = await foto(page);
    expect(despues.silos).toEqual(original.silos);

    // El aviso ofrece «Deshacer»: vuelve a lo de antes de importar (con Natación).
    await goTab(page, "Semana");
    await openSettingsPage(page, "Respaldo");
    await importar(page, json);
    await toast(page).getByRole("button", { name: "Deshacer" }).click();
    await page.getByRole("button", { name: "Cerrar", exact: true }).first().click();
    await goTab(page, "Silos");
    await expect.poll(async () => (await siloLabels(page)).length).toBe(original.silos.length);
  });

  test("un archivo que no es un respaldo se rechaza sin tocar los datos", async ({ page }) => {
    await openDemo(page);
    const antes = await foto(page);
    await openSettingsPage(page, "Respaldo");
    await sheet(page)
      .getByLabel("Archivo de respaldo")
      .setInputFiles({
        name: "basura.json",
        mimeType: "application/json",
        buffer: Buffer.from("esto no es json"),
      });
    await expect(sheet(page).getByRole("alert")).toBeVisible();
    expect(await foto(page)).toEqual(antes);
  });
});
