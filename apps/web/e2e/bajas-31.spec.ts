import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

// Bajas de la 31.ª vuelta del agente atacante.

test("Mi semana: cada campo queda a la misma altura que su par, también con ayuda debajo", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const hoja = sheet(page);
  // El borde de abajo: un campo de hora y uno de texto pueden diferir unos px de alto.
  const top = async (nombre: string) => {
    const caja = await hoja.getByLabel(nombre, { exact: true }).boundingBox();
    return Math.round((caja?.y ?? -1) + (caja?.height ?? 0));
  };
  const pares = [
    ["Me levanto", "Arreglarse, traslado (min)"],
    ["Desayuno", "Dura (min), desayuno"],
    ["Nada de estudio desde", "Me acuesto"],
  ] as const;
  for (const [a, b] of pares) expect(await top(a), `${a} / ${b}`).toBe(await top(b));
});

test("Escape en la burbuja de un bloque devuelve el foco al bloque", async ({ page }) => {
  await openDemo(page, MONDAY);
  const bloque = page.locator(".pill.planned").first();
  await bloque.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(bloque).toBeFocused();
});

test("Silos: con letra enorme el nombre no se parte a mitad de palabra", async ({ page }) => {
  await openDemo(page, MONDAY);
  await goTab(page, "Silos");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
    const n = document.querySelector(".silo .name");
    if (n) n.textContent = "Programación 2";
  });
  const lineas = await page
    .locator(".silo .name")
    .first()
    .evaluate((el) => {
      const texto = el.firstChild as Text;
      const r = document.createRange();
      const out: string[] = [];
      let linea = "";
      let top = Number.NaN;
      for (let i = 0; i < texto.length; i++) {
        r.setStart(texto, i);
        r.setEnd(texto, i + 1);
        const y = Math.round(r.getBoundingClientRect().top);
        if (y !== top && linea) {
          out.push(linea);
          linea = "";
        }
        top = y;
        linea += texto.data.charAt(i);
      }
      out.push(linea);
      return out.map((l) => l.trim());
    });
  expect(lineas.join(" ")).toBe("Programación 2");
});

test("Escape en la hoja de una rutina vuelve a Rutinas", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Rutinas");
  await sheet(page)
    .getByRole("button", { name: /^Gym, 3 por semana/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet(page)).toHaveAccessibleName("Rutinas");
  // Y la que se abre con «Editar» también.
  await sheet(page)
    .getByRole("button", { name: /^Gym, 3 por semana/ })
    .click();
  await sheet(page).getByRole("button", { name: "Editar" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet(page)).toHaveAccessibleName("Rutinas");
});
