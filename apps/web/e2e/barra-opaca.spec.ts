import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, openDemo } from "./helpers";

// En tema oscuro la barra de pestañas es opaca (no se ve el contenido a través); en claro sigue
// translúcida. En los dos temas queda pegada abajo.
test.use(IPHONE_375);

const barra = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(".tabs");
    if (!el) throw new Error("no hay barra de pestañas");
    const css = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      fondo: css.backgroundColor,
      bottom: css.bottom,
      pegada: Math.round(window.innerHeight - rect.bottom),
    };
  });

/** Alfa de un color computado: «rgb(r, g, b)» es 1; «rgba(r, g, b, a)» y «color(... / a)» lo traen. */
const alfa = (color: string): number => {
  const m = color.match(/(?:rgba\([^,]+,[^,]+,[^,]+,|\/)\s*([\d.]+)\s*\)$/);
  const valor = m?.at(1);
  return valor === undefined ? 1 : Number.parseFloat(valor);
};

test("tema oscuro: fondo opaco y pegada abajo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openDemo(page);
  const b = await barra(page);
  expect(alfa(b.fondo)).toBe(1);
  expect(b.bottom).toBe("0px");
  expect(b.pegada).toBe(0);
});

test("tema claro: sigue translúcida y pegada abajo", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openDemo(page);
  const b = await barra(page);
  expect(alfa(b.fondo)).toBeLessThan(1);
  expect(b.bottom).toBe("0px");
  expect(b.pegada).toBe(0);
});
