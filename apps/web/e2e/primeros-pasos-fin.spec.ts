import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, sheet } from "./helpers";

test.use(IPHONE_375);

// En la demo de pruebas «Conectar Google» cuenta como conectado: así se llega a 3 de 3.
test("Primeros pasos: llega a 3 de 3, cierra con «Listo» una vez y no vuelve", async ({
  page,
}, testInfo) => {
  test.slow();
  test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Primeros pasos · 2 de 3")).toBeVisible();

  await page.getByRole("button", { name: "Conectar Google" }).click();
  await sheet(page).getByRole("button", { name: "Cerrar", exact: true }).first().click();
  await expect(page.getByText("Primeros pasos · Listo")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText(/^Primeros pasos/)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Primeros pasos/)).toHaveCount(0);
});
