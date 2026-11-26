import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375 } from "./helpers";

test.use(IPHONE_375);
test.describe.configure({ timeout: 120_000 });

// Con la fecha de hoy, sin reloj fijo: los tests de fecha fija no ven lo que cambia con el día.

async function demoDePruebas(page: Page) {
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: /^Reiniciar demo/ }).click();
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

test("Bandeja: sin título «no entra» si una opción deja entrar la tarea, y el Gym cuenta la semana entera", async ({
  page,
}) => {
  await demoDePruebas(page);
  const bloquesGym = await page
    .getByTestId("week")
    .getByRole("button", { name: /^Gym, / })
    .count();
  await goTab(page, "Bandeja");
  await expect(page.locator(".section-title").first()).toBeVisible();

  // (a) Un título «no entra antes de su fecha» y una opción «llegás a todos los mínimos» no conviven.
  const titulo = page.locator(".card").filter({ hasText: /no entra antes de su fecha/ });
  const llega = page.locator(".card").filter({ hasText: /Con esto llegás a todos los mínimos/ });
  const hayTitulo = (await titulo.count()) > 0;
  const hayLlega = (await llega.count()) > 0;
  expect(hayTitulo && hayLlega).toBe(false);

  // (c) «entra N de 3» es la cantidad de bloques de Gym de la semana.
  const tarjeta = page.locator(".card").filter({ hasText: /Gym: esta semana entra \d de \d/ });
  const hayTarjeta = (await tarjeta.count()) > 0;
  if (hayTarjeta) {
    await expect(tarjeta.first().locator(".title")).toContainText(`entra ${bloquesGym} de`);
  } else {
    expect(bloquesGym).toBeGreaterThanOrEqual(3);
  }
});
