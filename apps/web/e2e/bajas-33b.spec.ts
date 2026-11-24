import { expect, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  MONDAY,
  openDemo,
  openSettingsPage,
  reload,
  sheet,
  toast,
} from "./helpers";

test.use(IPHONE_375);

// Bajas que quedaron de la 33.ª vuelta del agente atacante.

test("Enter en un campo de hora de Mi semana guarda; con un error marca el primero", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const levanto = sheet(page).getByLabel("Me levanto");
  await levanto.fill("07:00");
  await levanto.press("Enter");
  await expect(toast(page)).toContainText("Mi semana guardada");
  const cena = sheet(page).getByLabel("Cena", { exact: true });
  await cena.fill("03:00");
  await cena.press("Enter");
  await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
});

test("Mi semana no tiene párrafos explicativos", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  await expect(page.getByText(/Siempre hay lugar para comer/)).toBeHidden();
  await expect(page.getByText(/casi nunca cambia/)).toBeHidden();
});

test("Enter en los minutos de la Bandeja no salta al buscador de lugar de otra tarjeta", async ({
  page,
}) => {
  await openDemo(page);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");
    for (const [i, lugar] of ["Instituto", "Club", "Gimnasio"].entries()) {
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
  const minutos = page.getByLabel(/^O minutos desde casa para/).first();
  await minutos.fill("15");
  await minutos.press("Enter");
  const enfocado = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName ?? "", label: a?.getAttribute("aria-label") ?? "" };
  });
  expect(enfocado.tag).not.toBe("INPUT");
  expect(enfocado.label).not.toMatch(/^Lugar de/);
});
