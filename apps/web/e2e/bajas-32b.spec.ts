import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet, tabs } from "./helpers";

test.use(IPHONE_375);

// Detalles de la 32.ª vuelta del agente atacante (segunda tanda).

for (const pestana of ["Semana", "Bandeja"] as const) {
  test(`un aviso en ${pestana} no tapa la cabecera ni el título: va encima de la barra inferior`, async ({
    page,
  }) => {
    await openDemo(page, MONDAY);
    await goTab(page, pestana);
    await page.evaluate(() => {
      const t = document.createElement("div");
      t.className = "snack";
      const texto = document.createElement("span");
      texto.textContent = "Movido a las 10:00";
      t.append(texto);
      document.querySelector(".toasts [role=status]")?.append(t);
    });
    const aviso = await page.locator(".toasts .snack").boundingBox();
    const cabecera = await page.locator(".header").first().boundingBox();
    const barra = await tabs(page).boundingBox();
    expect(aviso?.y ?? 0).toBeGreaterThanOrEqual((cabecera?.y ?? 0) + (cabecera?.height ?? 0));
    expect((aviso?.y ?? 0) + (aviso?.height ?? 0)).toBeLessThanOrEqual(barra?.y ?? 0);
  });
}

test("Escape con el foco en un campo de hora cierra la hoja, como en otros campos", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  await sheet(page).getByLabel("Me levanto", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
});

test("Mi semana: los siete días se ven y se alcanzan, el domingo también", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Mi semana");
  const dias = sheet(page).locator(".day-chips .chip");
  await expect(dias).toHaveCount(7);
  await page.waitForTimeout(600);
  for (let i = 0; i < 7; i++) {
    const caja = await dias.nth(i).boundingBox();
    expect(caja?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((caja?.x ?? 999) + (caja?.width ?? 999)).toBeLessThanOrEqual(375);
  }
  await expect(sheet(page).getByRole("button", { name: "domingo", exact: true })).toBeVisible();
});
