import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, openDemo } from "./helpers";
import { PANTALLAS } from "./pantallas";

test.use(IPHONE_375);

/** Cómo se nombra un elemento en el mensaje: etiqueta, clases y el comienzo de su texto. */
const NOMBRE = `(el) => {
  const clases = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/s+/).join(".") : "";
  return el.tagName.toLowerCase() + clases + " «" + (el.textContent ?? "").trim().slice(0, 40) + "»";
}`;

/** Contenedores con más contenido que ancho (`scrollWidth > clientWidth`), y el documento. */
const contenedores = (page: Page): Promise<string[]> =>
  page.evaluate((nombreSrc) => {
    const nombre = new Function(`return (${nombreSrc})`)() as (el: Element) => string;
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth)
      out.push(`documento ${doc.scrollWidth} > ${doc.clientWidth}`);
    const lista = document.querySelectorAll(
      ".app, main, .screen, .scroll, .header, nav.tabs, .sheet, .settings-list, .card, .notice",
    );
    for (const el of lista) {
      if (getComputedStyle(el).display === "none") continue;
      if (el.scrollWidth > el.clientWidth + 1)
        out.push(`${nombre(el)}: ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  }, NOMBRE);

/** Elementos visibles que terminan más allá del borde de la pantalla (salvo en zonas con scroll lateral). */
const fueraDePantalla = (page: Page): Promise<string[]> =>
  page.evaluate((nombreSrc) => {
    const nombre = new Function(`return (${nombreSrc})`)() as (el: Element) => string;
    const ancho = window.innerWidth;
    const conScroll = (el: Element) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX;
        if (x === "auto" || x === "scroll") return true;
      }
      return false;
    };
    const ignorado = (el: Element) => !!el.closest("[hidden], [inert], .sr-only, .skip-link");
    const out: string[] = [];
    for (const el of document.querySelectorAll("main *, .sheet *, nav.tabs *")) {
      if (ignorado(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > ancho + 1 && !conScroll(el))
        out.push(`${nombre(el)} termina en ${Math.round(r.right)} > ${ancho}`);
    }
    return out;
  }, NOMBRE);

/** Todo lo que se sale por el costado; `sinCerrar` oculta antes la ✕ de las hojas (se mide aparte). */
async function desbordes(page: Page, sinCerrar = false): Promise<string[]> {
  if (sinCerrar) {
    await page.addStyleTag({ content: ".sheet-close { display: none !important; }" });
  }
  return [...(await contenedores(page)), ...(await fueraDePantalla(page))].slice(0, 12);
}

const sinDesborde = async (page: Page, donde: string, sinCerrar = false) =>
  expect(await desbordes(page, sinCerrar), `desborde en ${donde}`).toEqual([]);

const FONTS = [
  { px: 24, nombre: "letra grande" },
  { px: 32, nombre: "letra enorme" },
] as const;

for (const scheme of ["light", "dark"] as const) {
  for (const font of FONTS) {
    test.describe(`${font.nombre} (${font.px}px), tema ${scheme === "dark" ? "oscuro" : "claro"}`, () => {
      test.beforeEach(async ({ page }, testInfo) => {
        // Es CSS y no cambia de un motor a otro: alcanza con el iPhone.
        test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
        // Sin animaciones: se mide la pantalla ya quieta, no a mitad de la transición.
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await openDemo(page);
        // Como el tamaño de letra del sistema: la raíz cambia y todo lo demás (rem) la sigue.
        await page.evaluate((px) => {
          document.documentElement.style.fontSize = `${px}px`;
        }, font.px);
      });

      for (const pantalla of PANTALLAS) {
        test(`${pantalla.nombre}: nada se sale`, async ({ page }) => {
          await pantalla.abrir(page);
          await sinDesborde(page, pantalla.nombre, true);
        });
      }

      test("la ✕ de las hojas queda dentro de la pantalla", async ({ page }) => {
        await PANTALLAS[PANTALLAS.length - 2]?.abrir(page);
        const fuera = await page
          .locator(".sheet-close")
          .evaluateAll(
            (els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth).length,
          );
        expect(fuera).toBe(0);
      });
    });
  }
}
