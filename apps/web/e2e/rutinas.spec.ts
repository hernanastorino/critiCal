import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

/** Bloques de la rutina en la semana que se ve: [día, desde, hasta] en minutos. */
async function bloques(page: Page, nombre: string): Promise<[string, number, number][]> {
  const labels = await page
    .getByTestId("week")
    .locator(".pill.planned")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const out: [string, number, number][] = [];
  for (const l of labels) {
    const m = l.match(/^(.+?), (\p{L}+) (\d{2}):(\d{2}) a (\d{2}):(\d{2})/u);
    if (!m || m[1] !== nombre) continue;
    out.push([m[2] as string, Number(m[3]) * 60 + Number(m[4]), Number(m[5]) * 60 + Number(m[6])]);
  }
  return out;
}

// «Distinto según el día»: cada día con su horario, y los días en «No» sin rutina.
test("rutina con horario distinto por día: la Semana respeta cada franja", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Rutinas");
  const hoja = sheet(page);
  await hoja.getByLabel("Rutina", { exact: true }).fill("Natación");
  await hoja.getByLabel("Distinto según el día").check();

  const franja = async (dia: string, desde: string, hasta: string) => {
    await hoja.getByLabel(`Desde, ${dia}`).fill(desde);
    await hoja.getByLabel(`Hasta, ${dia}`).fill(hasta);
  };
  await franja("lunes", "18:00", "20:00");
  await franja("miércoles", "20:00", "22:00");
  await franja("viernes", "15:00", "17:00");
  for (const dia of ["martes", "jueves", "sábado", "domingo"]) {
    await hoja.getByLabel(`No ese día: ${dia}`).check();
  }
  await hoja.getByRole("button", { name: "Agregar rutina" }).click();
  await expect(
    hoja.getByRole("button", { name: /^Natación, 3 por semana de 60 min/ }),
  ).toBeVisible();

  await hoja.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await goTab(page, "Semana");

  await expect.poll(async () => (await bloques(page, "Natación")).length).toBeGreaterThan(0);
  const franjas: Record<string, [number, number]> = {
    lun: [18 * 60, 20 * 60],
    mié: [20 * 60, 22 * 60],
    vie: [15 * 60, 17 * 60],
  };
  const todos = await bloques(page, "Natación");
  for (const [dia, desde, hasta] of todos) {
    const f = franjas[dia];
    expect(f, `Natación no debería ir el ${dia}`).toBeDefined();
    expect(desde, `${dia} empieza antes de su franja`).toBeGreaterThanOrEqual(f?.[0] ?? 0);
    expect(hasta, `${dia} termina después de su franja`).toBeLessThanOrEqual(f?.[1] ?? 0);
  }
});

test("horario ilegible: se marca el campo y no se agrega la rutina", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Rutinas");
  const hoja = sheet(page);
  await hoja.getByLabel("Rutina", { exact: true }).fill("Yoga");
  await hoja.getByLabel("Desde, todos los días").fill("25:99");
  await hoja.getByLabel("Hasta, todos los días").fill("18:00");
  await expect(hoja.getByLabel("Desde, todos los días")).toHaveAttribute("aria-invalid", "true");
  await hoja.getByRole("button", { name: "Agregar rutina" }).click({ force: true });
  await expect(hoja.getByRole("button", { name: /^Yoga, / })).toHaveCount(0);
});
