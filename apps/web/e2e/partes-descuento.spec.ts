import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, sheet } from "./helpers";

test.use(IPHONE_375);

test("marcar una parte sin minutos descuenta solo esa parte: Faltan 10h pasa a 7h", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await goTab(page, "Silos");
  const silo = page.locator(".silo[data-task='parcial-calc']");
  await expect(silo).toHaveAttribute("aria-label", /faltan 10h/);
  await silo.click();
  const hoja = sheet(page);
  await hoja.getByLabel(/^Práctico 4/).check();
  await hoja.getByRole("button", { name: "Guardar avance" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(silo).toHaveAttribute("aria-label", /faltan 7h/);
  await silo.click();
  await expect(sheet(page).getByText(/^Faltan 7h \(mínimo/)).toBeVisible();
});
