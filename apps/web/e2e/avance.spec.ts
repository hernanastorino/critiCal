import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, sheet, siloLabels, tabs, toast } from "./helpers";

test.use(IPHONE_375);

// Un doble toque en «Guardar avance» guardaba y el segundo toque caía en lo que había debajo.
test("doble toque en «Guardar avance» guarda una vez y no cambia de pestaña", async ({ page }) => {
  await openDemo(page);
  await goTab(page, "Silos");
  // Una entrega sin partes: lo anotado descuenta directo (con partes, lo que falta se mide por ellas).
  const silo = page.locator('.silo[data-task="tp-prog"]');
  const faltan = async () => {
    const label = (await silo.getAttribute("aria-label")) ?? "";
    const m = label.match(/faltan (?:(\d+)h)?(?:(\d+)m?)?/);
    return Number(m?.[1] ?? 0) * 60 + Number(m?.[2] ?? 0);
  };
  await expect(silo).toBeVisible();
  const antes = await faltan();
  await silo.click();

  const hoja = sheet(page);
  await expect(hoja.getByRole("heading", { name: "Entrega TP Programación" })).toBeVisible();
  await hoja.getByLabel("Le dediqué (minutos)").fill("30");
  await hoja.getByRole("button", { name: "Guardar avance" }).dblclick();

  await expect(toast(page)).toContainText("Avance guardado: 30m en Entrega TP Programación");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Sigue en Silos (el segundo toque no tocó las pestañas ni abrió otra cosa)…
  await expect(tabs(page).getByRole("button", { name: /^Silos/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Lo que falta" })).toBeVisible();
  // …y se descontó una sola vez: a lo sumo los 30 min anotados (con descansos, algo menos), no el doble.
  await expect.poll(async () => antes - (await faltan())).toBeGreaterThan(0);
  expect(antes - (await faltan())).toBeLessThanOrEqual(30);
  expect(
    (await siloLabels(page)).filter((l) => l.includes("Entrega TP Programación")),
  ).toHaveLength(1);
});

test("«Guardar avance» sin nada anotado avisa y no cierra", async ({ page }) => {
  await openDemo(page);
  await goTab(page, "Silos");
  await page.locator('.silo[data-task="tp-prog"]').click();
  await sheet(page).getByRole("button", { name: "Guardar avance" }).click();
  await expect(sheet(page).getByRole("alert")).toContainText("No anotaste avance");
  await expect(sheet(page).getByRole("heading", { name: "Entrega TP Programación" })).toBeVisible();
});
