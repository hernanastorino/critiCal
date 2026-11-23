import { expect, type Locator, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, sheet, toast, undo } from "./helpers";

test.use(IPHONE_375);

// Domingo 12:00: la Bandeja tiene dos bloques pasados sin responder y una opción para elegir.
const hechos = (page: Page) => page.getByRole("button", { name: /^Hecho: / });
const partes = (page: Page) => page.getByRole("button", { name: /^Hice una parte: / });
const noHechos = (page: Page) => page.getByRole("button", { name: /^No hecho: / });
/** Con partes pendientes la tarjeta pregunta cuáles; se sigue sin elegir ninguna. */
const sinElegir = async (page: Page) => {
  const anotar = page.getByRole("button", { name: "Anotar hecho" });
  if (await anotar.isVisible()) await anotar.click();
};
const elegir = (page: Page) => page.getByRole("button", { name: /^Elegir: / });

test.describe("Bandeja: cada acción tiene su «Deshacer»", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
    await goTab(page, "Bandeja");
    await expect(hechos(page)).toHaveCount(2);
    await expect(elegir(page)).toHaveCount(2);
  });

  test("Hecho", async ({ page }) => {
    await hechos(page).first().click();
    // Con partes pendientes la tarjeta pregunta cuáles; se sigue sin elegir ninguna.
    const anotar = page.getByRole("button", { name: "Anotar hecho" });
    if (await anotar.isVisible()) await anotar.click();
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await expect(hechos(page)).toHaveCount(1);
    await undo(page);
    await expect(hechos(page)).toHaveCount(2);
  });

  test("No hecho", async ({ page }) => {
    await noHechos(page).first().click();
    await expect(toast(page)).toContainText("Anotado, sin culpa");
    await expect(noHechos(page)).toHaveCount(1);
    await undo(page);
    await expect(noHechos(page)).toHaveCount(2);
  });

  test("Hice una parte (abre la hoja del bloque)", async ({ page }) => {
    await partes(page).first().click();
    await sheet(page)
      .getByRole("button", { name: /^\s*Parcial$/ })
      .click();
    await sheet(page).getByRole("button", { name: "Guardar parcial" }).click();
    await expect(toast(page)).toContainText("Anotado como parcial.");
    await expect(hechos(page)).toHaveCount(1);
    await undo(page);
    await expect(hechos(page)).toHaveCount(2);
  });

  test("Elegir una opción: «Deshacer» en «Decisiones que tomaste» la trae de vuelta", async ({
    page,
  }) => {
    await elegir(page).first().click();
    await expect(toast(page)).toContainText("Listo, reacomodé el plan");
    await expect(elegir(page)).toHaveCount(0);
    await expect(page.getByText("Decisiones que tomaste")).toBeVisible();

    await page.getByRole("button", { name: /^Deshacer: / }).click();
    await expect(toast(page)).toContainText("Deshecho:");
    await expect(elegir(page)).toHaveCount(2);
    await expect(page.getByText("Decisiones que tomaste")).toHaveCount(0);
  });
});

/** Un deslizar con el dedo (Playwright no hace gestos en WebKit: se mandan los eventos de toque). */
async function deslizar(locator: Locator, dx: number, dy = 0): Promise<void> {
  await locator.evaluate(
    (el, [x, y]) => {
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const send = (type: string, cx: number, cy: number) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        const touch = { clientX: cx, clientY: cy, identifier: 1, target: el };
        Object.assign(ev, {
          touches: type === "touchend" ? [] : [touch],
          changedTouches: [touch],
        });
        el.dispatchEvent(ev);
      };
      send("touchstart", x0, y0);
      send("touchmove", x0 + (x as number) / 2, y0 + (y as number) / 2);
      send("touchend", x0 + (x as number), y0 + (y as number));
    },
    [dx, dy],
  );
}

test.describe("Deslizar una tarjeta de «¿Cómo te fue?» (SPEC §14)", () => {
  const tarjetas = (page: Page) => page.locator(".card.swipeable");

  test.beforeEach(async ({ page }) => {
    await openDemo(page);
    await goTab(page, "Bandeja");
    await expect(hechos(page)).toHaveCount(2);
  });

  test("a la derecha marca hecho y «Deshacer» la trae de vuelta", async ({ page }) => {
    await deslizar(tarjetas(page).first(), 140);
    await sinElegir(page);
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await expect(hechos(page)).toHaveCount(1);
    await undo(page);
    await expect(hechos(page)).toHaveCount(2);
  });

  test("a la izquierda marca no hecho y «Deshacer» la trae de vuelta", async ({ page }) => {
    await deslizar(tarjetas(page).first(), -140);
    await expect(toast(page)).toContainText("Anotado, sin culpa");
    await expect(noHechos(page)).toHaveCount(1);
    await undo(page);
    await expect(noHechos(page)).toHaveCount(2);
  });

  test("un deslizar corto o más vertical que horizontal no hace nada", async ({ page }) => {
    await deslizar(tarjetas(page).first(), 30);
    await deslizar(tarjetas(page).first(), 120, 100);
    await expect(hechos(page)).toHaveCount(2);
    await expect(toast(page)).toHaveCount(0);
  });

  test("con reducir movimiento igual responde, y los botones siguen ahí", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(hechos(page).first()).toBeVisible();
    await deslizar(tarjetas(page).first(), 140);
    await sinElegir(page);
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await expect(hechos(page)).toHaveCount(1);
  });

  test("vibra un instante donde el navegador puede", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { buzzes: number[] }).buzzes = [];
      navigator.vibrate = (p) => {
        (window as unknown as { buzzes: unknown[] }).buzzes.push(p);
        return true;
      };
    });
    await deslizar(tarjetas(page).first(), 140);
    await sinElegir(page);
    await expect(toast(page)).toContainText("Anotado como hecho.");
    expect(await page.evaluate(() => (window as unknown as { buzzes: number[] }).buzzes)).toEqual([
      10,
    ]);
  });
});

test.describe("Deslizar la Semana sigue como estaba", () => {
  const rango = (page: Page) => page.locator(".week-nav h1.range").innerText();

  test("cambia de semana, y no en modo edición", async ({ page }) => {
    await openDemo(page);
    const hoy = await rango(page);
    await deslizar(page.getByTestId("week"), -140);
    expect(await rango(page)).not.toBe(hoy);
    await deslizar(page.getByTestId("week"), 140);
    expect(await rango(page)).toBe(hoy);
    await page.getByRole("button", { name: "Modo edición" }).click();
    await deslizar(page.getByTestId("week"), -140);
    expect(await rango(page)).toBe(hoy);
  });
});
