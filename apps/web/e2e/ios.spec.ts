import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo } from "./helpers";
import { FORMULARIOS, PANTALLAS } from "./pantallas";

// iOS hace zoom al enfocar un campo con letra menor a 16 px, y no se puede volver atrás sin
// pellizcar: la app bloquea el zoom y los campos nunca bajan de 16 px. Estas pruebas corren en
// WebKit con el perfil de un iPhone chico (375×812), con la letra normal y con el tope (24 px).
test.use(IPHONE_375);

const TOPE_PX = 24;

/** Campos visibles con letra computada menor a 16 px. */
const camposChicos = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const sinTexto = (el: Element) =>
      /^(hidden|checkbox|radio)$/.test(el.getAttribute("type") ?? "");
    return [...document.querySelectorAll("input, textarea, select")]
      .filter((el) => visible(el) && !sinTexto(el))
      .map((el) => ({ el, px: Number.parseFloat(getComputedStyle(el).fontSize) }))
      .filter(({ px }) => px < 16)
      .map(
        ({ el, px }) =>
          `${el.tagName.toLowerCase()} «${el.getAttribute("aria-label") ?? el.id}» ${px}px`,
      );
  });

const desborde = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth > d.clientWidth ? `${d.scrollWidth} > ${d.clientWidth}` : "";
  });

test.describe("iPhone 375×812", () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    // Es CSS: alcanza con el iPhone (WebKit); el escritorio no agrega nada.
    test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
  });

  test("el meta viewport bloquea el zoom", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("maximum-scale=1");
    expect(content).toContain("user-scalable=no");
    // Y el documento lo respeta: no se puede pellizcar.
    expect(await page.evaluate(() => getComputedStyle(document.body).touchAction)).toBe("pan-y");
  });

  for (const letra of [16, TOPE_PX]) {
    test.describe(`letra de ${letra}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openDemo(page);
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, letra);
      });

      for (const pantalla of PANTALLAS) {
        test(`${pantalla.nombre}: sin desborde y campos de 16px o más`, async ({ page }) => {
          await pantalla.abrir(page);
          expect(await desborde(page), "desborde horizontal").toBe("");
          expect(await camposChicos(page), "campos con letra chica").toEqual([]);
        });
      }

      for (const form of FORMULARIOS) {
        test(`${form.nombre}: sin desborde y campos de 16px o más`, async ({ page }) => {
          await form.abrir(page);
          expect(await page.locator("input, textarea, select").count()).toBeGreaterThan(0);
          expect(await desborde(page), "desborde horizontal").toBe("");
          expect(await camposChicos(page), "campos con letra chica").toEqual([]);
        });
      }

      test("Bandeja: el campo de la pantalla principal también", async ({ page }) => {
        await goTab(page, "Bandeja");
        expect(await camposChicos(page)).toEqual([]);
      });
    });
  }

  test("la letra del sistema no pasa del tope", async ({ page }) => {
    await openDemo(page);
    // El sistema pide 32 px (Dynamic Type al máximo): la app se queda en el tope.
    await page.addStyleTag({ content: "html { font-size: 32px; }" });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
      `${TOPE_PX}px`,
    );
    // Con menos de lo que pide el tope, no toca nada.
    await page.addStyleTag({ content: "html { font-size: 20px; }" });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
      "20px",
    );
  });
});
