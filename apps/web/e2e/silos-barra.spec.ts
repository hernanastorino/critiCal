import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375 } from "./helpers";

// Silos: lo último de la lista se puede scrollear por encima de la barra de pestañas (que no se toca).
test.use(IPHONE_375);

test("Silos: al scrollear al final, lo último queda encima de la barra, también con la muesca", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-25T13:00:00Z") });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await goTab(page, "Silos");
  await expect(page.getByRole("heading", { name: "Lo que falta" })).toBeVisible();
  const medidas = await page.evaluate(() => {
    const lista = document.querySelector<HTMLElement>(".screen .scroll");
    const barra = document.querySelector(".tabs");
    if (!lista || !barra) throw new Error("falta la lista o la barra");
    // Con la muesca del iPhone: la barra mide 34 px más y la lista debe dejarlos libres.
    document.documentElement.style.setProperty("--safe-b", "34px");
    lista.scrollTop = lista.scrollHeight;
    const hijos = [...lista.children].filter((el) => el.getBoundingClientRect().height > 0);
    const ultimo = hijos.at(-1);
    if (!ultimo) throw new Error("Silos vacío");
    return {
      ultimoAbajo: Math.round(ultimo.getBoundingClientRect().bottom),
      barraArriba: Math.round(barra.getBoundingClientRect().top),
      scrollea: lista.scrollHeight > lista.clientHeight,
    };
  });
  expect(medidas.scrollea).toBe(true);
  expect(medidas.ultimoAbajo).toBeLessThanOrEqual(medidas.barraArriba);
});
