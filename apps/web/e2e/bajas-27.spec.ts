import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, openDemo, openNewRoutine, reload, toast } from "./helpers";

test.use(IPHONE_375);

// Bajas que quedaron de la 27.ª vuelta del agente atacante.

/** Un evento de Google sin lugar conocido: la Bandeja pregunta «¿Dónde es?». */
async function conPreguntaDeLugar(page: Page): Promise<void> {
  await openDemo(page);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");
    // Varias tarjetas: la lista se pasa de la pantalla y el estado de cada buscador queda lejos.
    for (const [i, lugar] of [
      "Instituto Anglo",
      "Club",
      "Gimnasio",
      "Cancha",
      "Biblioteca",
    ].entries()) {
      const t = d.events[0].start + (i + 2) * 3_600_000;
      d.events.push({
        id: `x${i}`,
        title: `Evento ${lugar}`,
        start: t,
        end: t + 3_600_000,
        busy: true,
        source: "google",
        location: `${lugar}, Av. Italia 1234`,
      });
    }
    d.places = [{ id: "casa", name: "Casa", aliases: [], isHome: true }];
    localStorage.setItem("critical.demo.v2", JSON.stringify(d));
  });
  await reload(page);
  await goTab(page, "Bandeja");
  await expect(page.getByText("¿Dónde es?")).toBeVisible();
}

test("el aviso de «Deshacer» no tapa las flechas, el título ni las herramientas de la Semana", async ({
  page,
}) => {
  await conPreguntaDeLugar(page);
  await page.getByRole("button", { name: "No hace falta traslado" }).first().click();
  // Un toque humano llega unos cientos de ms después del anterior: no en el mismo instante.
  await page.waitForTimeout(700);
  await goTab(page, "Semana");
  await expect(toast(page)).toBeVisible();
  const aviso = await toast(page).boundingBox();
  const barra = await page.locator(".header").boundingBox();
  expect(aviso).not.toBeNull();
  expect(barra).not.toBeNull();
  expect(aviso?.y ?? 0).toBeGreaterThanOrEqual((barra?.y ?? 0) + (barra?.height ?? 0));
});

test("las tarjetas «¿Dónde es?» no estiran la página: solo scrollea la lista", async ({ page }) => {
  await conPreguntaDeLugar(page);
  // Los textos solo para lector de pantalla se anclan a la lista, no a la página: si no, estiran
  // el documento (en Chrome 1262 px contra 812) y aparece un segundo scroll debajo de la lista.
  const anclados = await page.evaluate(() => {
    const lista = document.querySelector(".scroll");
    const ocultos = [...document.querySelectorAll(".scroll .sr-only")];
    return {
      n: ocultos.length,
      bien: ocultos.every((e) => (e as HTMLElement).offsetParent === lista),
    };
  });
  expect(anclados.n).toBeGreaterThan(0);
  expect(anclados.bien).toBe(true);
  const { doc, vista } = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight,
    vista: window.innerHeight,
  }));
  expect(doc).toBe(vista);
});

test("Crear rutina nueva muestra una sola miga: «‹ Rutinas»", async ({ page }) => {
  await openDemo(page);
  await openNewRoutine(page);
  const hoja = page.getByRole("dialog").last();
  await expect(hoja.getByRole("button", { name: "‹ Rutinas" })).toBeVisible();
  await expect(hoja.getByRole("button", { name: "Volver a Ajustes" })).toBeHidden();
  await expect(hoja.getByRole("heading", { name: "Rutinas", exact: true })).toBeHidden();
});
