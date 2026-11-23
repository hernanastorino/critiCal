import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY } from "./helpers";

test.use(IPHONE_375);

// SPEC §18.1 «Compensar el camino infeliz»: texto breve, Roy en la forma del caso y la salida a mano.
test.describe("camino infeliz con gracia", () => {
  test("un enlace de entrada vencido dice qué pasó, muestra a Roy desarmado y deja entrar de nuevo", async ({
    page,
  }) => {
    await page.goto(
      "/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
    );
    const aviso = page.getByRole("alert");
    await expect(aviso).toContainText("venció");
    await expect(aviso.locator(".roy")).toHaveAttribute("data-anim", "desarmado");
    // La dirección queda limpia y las salidas siguen a la vista.
    await expect(page).not.toHaveURL(/error/);
    await expect(page.getByRole("button", { name: "Probar con datos de ejemplo" })).toBeVisible();
  });

  test("un bloque con entrega dice qué cuesta saltearlo, sin apuro ni culpa", async ({ page }) => {
    await page.clock.install({ time: MONDAY });
    await page.goto("/");
    await page.getByRole("button", { name: "Probar con datos de ejemplo" }).click();
    const week = page.getByTestId("week");
    await expect(week).toBeVisible();
    await week.locator(".pill.planned:not(.past)").first().click();
    await page.locator(".bubble").click();
    await expect(page.getByRole("dialog")).toContainText(/[Ss]i lo salteás/);
  });
});
