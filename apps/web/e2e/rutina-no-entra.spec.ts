import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, sheet } from "./helpers";

test.use(IPHONE_375);

test("Bandeja: avisa cuando una rutina no entra entera en la semana y deja editarla", async ({
  page,
}) => {
  test.slow();
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await goTab(page, "Bandeja");
  const tarjeta = page.locator(".card").filter({ hasText: /Gym: esta semana entra 1 de 3/ });
  await expect(tarjeta).toBeVisible();
  await tarjeta.getByRole("button", { name: "Editar rutina" }).click();
  // Ajustes › Rutinas, con la hoja de esa rutina abierta.
  await expect(sheet(page)).toHaveAccessibleName("Gym");
  await expect(sheet(page).getByRole("button", { name: "Editar", exact: true })).toBeVisible();
});
