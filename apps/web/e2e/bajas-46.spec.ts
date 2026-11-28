import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettings, sheet } from "./helpers";
import { PANTALLAS } from "./pantallas";

test.use(IPHONE_375);

// Bajas de la 46.ª vuelta, medidas en WebKit a 375×812.

async function demoDePruebas(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

/** Botones y chips visibles de la pantalla (menos la barra de pestañas) más bajos que 44 px. */
const chicos = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll(".btn, .chip")) {
      if (el.closest("nav.tabs, [hidden], [inert]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (r.height < 43.5) {
        out.push(`${el.className} «${(el.textContent ?? "").trim().slice(0, 30)}» ${r.height}`);
      }
    }
    return out;
  });

for (const pantalla of PANTALLAS) {
  test(`todos los botones de «${pantalla.nombre}» miden 44 px de alto`, async ({ page }) => {
    test.slow();
    await openDemo(page);
    await pantalla.abrir(page);
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
