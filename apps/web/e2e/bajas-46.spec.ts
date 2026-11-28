import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettings, sheet } from "./helpers";
import { FORMULARIOS, PANTALLAS } from "./pantallas";

test.use(IPHONE_375);

// Bajas de la 46.ª vuelta, medidas en WebKit a 375×812.

async function demoDePruebas(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

/**
 * Lo tocable de la pantalla (botones, enlaces, `[role=button]`, casillas, selectores, `.btn`,
 * `.chip`) con menos de 44 px de alto o de ancho. Menos la barra de pestañas y los bloques de
 * la Semana (de 30 min: conocido). El área que cuenta es la mayor entre la caja, la de su
 * fila si es una casilla dentro de un `label` y la de su `::before`/`::after` invisible.
 */
const chicos = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    const todo = "button, a, [role=button], input[type=checkbox], select, .btn, .chip";
    for (const el of document.querySelectorAll(todo)) {
      if (el.closest("nav.tabs, [hidden], [inert], .pill, .skip-link, [aria-hidden=true]"))
        continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      let w = r.width;
      let h = r.height;
      const fila = el instanceof HTMLInputElement ? el.closest("label") : null;
      if (fila) {
        const f = fila.getBoundingClientRect();
        w = Math.max(w, f.width);
        h = Math.max(h, f.height);
      }
      for (const lado of ["::before", "::after"]) {
        const css = getComputedStyle(el, lado);
        if (css.content === "none" || css.position !== "absolute") continue;
        w = Math.max(w, Number.parseFloat(css.width) || 0);
        h = Math.max(h, Number.parseFloat(css.height) || 0);
      }
      if (w < 43.5 || h < 43.5) {
        const nombre = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim();
        out.push(`${el.tagName.toLowerCase()}.${el.className} «${nombre.slice(0, 30)}» ${w}×${h}`);
      }
    }
    return out;
  });

for (const pantalla of PANTALLAS) {
  test(`todo lo tocable de «${pantalla.nombre}» mide 44×44 px`, async ({ page }) => {
    test.slow();
    await openDemo(page);
    await pantalla.abrir(page);
    await page.waitForTimeout(500);
    expect(await chicos(page)).toEqual([]);
  });
}

for (const form of FORMULARIOS) {
  test(`todo lo tocable de «${form.nombre}» mide 44×44 px`, async ({ page }) => {
    test.slow();
    await openDemo(page);
    await form.abrir(page);
    await page.waitForTimeout(500);
    expect(await chicos(page)).toEqual([]);
  });
}

test("los días de Mi semana y «Editar lugar» miden 44 px", async ({ page }) => {
  await demoDePruebas(page);
  await openSettings(page);
  await sheet(page)
    .getByRole("button", { name: /^Mi semana/ })
    .click();
  expect(await chicos(page)).toEqual([]);
});

test("letra grande: las horas de «Hoy» no se cortan", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
  await demoDePruebas(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  await openSettings(page);
  await page.waitForTimeout(600);
  const cama = sheet(page).getByLabel("Me acuesto a las");
  const caja = await cama.boundingBox();
  const hoja = await sheet(page).boundingBox();
  expect(caja?.width ?? 0).toBeGreaterThanOrEqual(150);
  expect((caja?.x ?? 0) + (caja?.width ?? 0)).toBeLessThanOrEqual(
    (hoja?.x ?? 0) + (hoja?.width ?? 0),
  );
  const sobra = await cama.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sobra).toBeLessThanOrEqual(1);
});

test("letra al 200 %: las horas de Ajustes › Mi semana no cortan «a.m.»", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
  await demoDePruebas(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await openSettings(page);
  await sheet(page)
    .getByRole("button", { name: /^Mi semana/ })
    .click();
  await page.waitForTimeout(600);
  await expect(sheet(page).locator('input[type="time"]:visible').first()).toBeVisible();
  const cortados = await sheet(page)
    .locator('input[type="time"]:visible')
    .evaluateAll((els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth)
        .map((el) => `${el.getAttribute("aria-label")} ${el.scrollWidth}>${el.clientWidth}`),
    );
  expect(cortados).toEqual([]);
});
