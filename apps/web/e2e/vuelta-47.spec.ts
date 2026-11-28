import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo } from "./helpers";

test.use(IPHONE_375);

// 47.ª vuelta, medida en WebKit a 375×812.

test("el plan reserva el ómnibus de la Facultad sin abrir la tarjeta (demo de pruebas)", async ({
  page,
}) => {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  // Clase en la Facultad mañana a las 14:00: 42 min de ómnibus (los inventados de la demo) más
  // el margen, no los minutos del auto.
  const traslados = page.getByTestId("week").getByRole("img", { name: /^Traslado, mar / });
  await expect
    .poll(async () => await traslados.evaluateAll((els) => els.map((e) => e.ariaLabel)), {
      timeout: 15_000,
    })
    .toContain("Traslado, mar 13:08 a 14:00");
});

test("la semana que se mira no cambia sola al cruzar la medianoche del domingo", async ({
  page,
}) => {
  // Domingo 22/11 a las 23:59:50 en Montevideo.
  await openDemo(page, new Date("2026-11-23T02:59:50Z"));
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  const rango = page.getByRole("heading", { level: 1 });
  await expect(rango).toContainText("23 – 29 nov");
  await page.clock.runFor(70_000);
  await expect(rango).toContainText("23 – 29 nov");
});
