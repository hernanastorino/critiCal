import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

// Bajas de las vueltas 35 y 36 del agente atacante: Ajustes, avisos, Silos y Nueva actividad.

test("Mi semana: marcar y desmarcar S no deja nada que descartar", async ({ page }) => {
  test.slow();
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const sabado = sheet(page).getByRole("button", { name: "sábado", exact: true });
  await sabado.click();
  await expect(sabado).toHaveAttribute("aria-pressed", "true");
  await sabado.click();
  await expect(sabado).toHaveAttribute("aria-pressed", "false");
  await sheet(page).getByRole("button", { name: "Volver a Ajustes" }).click();
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
});

test("Mi semana: un error nombra el campo como lo ve la persona", async ({ page }) => {
  test.slow();
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  await sheet(page).getByLabel("Dura (min), desayuno").fill("999");
  await sheet(page)
    .getByRole("button", { name: /^Guardar para/ })
    .click();
  await expect(sheet(page).getByRole("alert")).toContainText("«Dura (min)» del desayuno");
});

test("un aviso no tapa controles: los toques lo atraviesan", async ({ page }) => {
  test.slow();
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  await sheet(page)
    .getByRole("button", { name: /^Guardar para/ })
    .click();
  const aviso = page.locator(".toasts .snack");
  await expect(aviso).toContainText("Mi semana guardada");
  expect(await aviso.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  const box = await aviso.boundingBox();
  if (!box) throw new Error("el aviso no tiene caja");
  const encima = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest(".snack") !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(encima).toBe(false);
});

test("Respaldo: «Descargar respaldo» avisa que descargó", async ({ page }) => {
  test.slow();
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Respaldo");
  await sheet(page).getByRole("button", { name: "Descargar respaldo" }).click();
  await expect(page.locator(".toasts .snack")).toContainText("Respaldo descargado");
});

test("un nombre largo de lugar termina en «…» (ellipsis) en vez de cortarse", async ({ page }) => {
  test.slow();
  await openDemo(page, MONDAY);
  const mide = await page.evaluate(() => {
    const caja = document.createElement("div");
    caja.className = "place-text";
    caja.style.cssText = "position:fixed;top:0;left:0;width:150px";
    caja.innerHTML =
      '<span class="place-line"><span class="place-name"><span class="place-label">Un lugar con un nombre larguísimo de verdad</span></span></span>';
    document.body.append(caja);
    const etiqueta = caja.querySelector(".place-label");
    if (!etiqueta) return null;
    const estilo = getComputedStyle(etiqueta);
    return {
      recortado: etiqueta.scrollWidth > etiqueta.clientWidth,
      puntos: estilo.textOverflow,
      oculto: estilo.overflow,
    };
  });
  expect(mide).toEqual({ recortado: true, puntos: "ellipsis", oculto: "hidden" });
});

test.describe("Silos › Nueva", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page, MONDAY);
    await goTab(page, "Silos");
    await page.getByRole("button", { name: "Nueva actividad" }).click();
  });

  test("no elige la materia por la persona", async ({ page }) => {
    test.slow();
    const hoja = sheet(page);
    await expect(hoja.getByLabel("Materia o actividad")).toHaveValue("");
    await hoja.getByPlaceholder("Parcial Física I").fill("Parcial 1");
    await hoja.getByRole("button", { name: /^Guardar/ }).click();
    await expect(hoja.getByText("Elegí la materia")).toBeVisible();
  });

  test("avisa que 130 h no entran en 3 días", async ({ page }) => {
    test.slow();
    await sheet(page).getByLabel("Horas estimadas").fill("130");
    await expect(sheet(page).getByText(/No entran 130h antes de esa fecha/)).toBeVisible();
  });

  test("un nombre de 81 caracteres se dice, no se corta", async ({ page }) => {
    test.slow();
    const nombre = sheet(page).getByPlaceholder("Parcial Física I");
    await nombre.fill("A".repeat(81));
    await expect(nombre).toHaveValue("A".repeat(81));
    await expect(sheet(page).getByText("Como máximo 80 caracteres")).toBeVisible();
  });
});
