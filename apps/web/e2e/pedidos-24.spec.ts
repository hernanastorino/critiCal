import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openSettings, sheet } from "./helpers";

test.use(IPHONE_375);

async function demoDePruebas(page: import("@playwright/test").Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

test("Acerca de: la atribución de los horarios vive en una hoja, no suelta entre categorías", async ({
  page,
}) => {
  await demoDePruebas(page);
  await openSettings(page);
  // En la lista de Ajustes no queda texto suelto de los horarios teóricos.
  await expect(
    sheet(page)
      .locator(".settings-list")
      .getByText(/Horarios teóricos/),
  ).toHaveCount(0);
  await sheet(page)
    .getByRole("button", { name: /^Acerca de/ })
    .click();
  await expect(sheet(page)).toHaveAccessibleName("Acerca de");
  await expect(
    sheet(page).getByText(/Horarios teóricos: Intendencia de Montevideo \(STM\)/),
  ).toBeVisible();
  await expect(sheet(page).getByRole("link", { name: /Política de privacidad/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
});
