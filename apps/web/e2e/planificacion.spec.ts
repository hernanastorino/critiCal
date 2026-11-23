import { expect, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  openDemo,
  openSettings,
  reload,
  SUNDAY,
  sheet,
  siloLabels,
} from "./helpers";

test.use(IPHONE_375);

// Domingo: la planificación semanal mira la semana que viene. Lo probado a mano en producción.
test.describe("planificación semanal un domingo", () => {
  test("la rutina no es una silo, tiene sus 3 bloques la semana próxima y persiste al recargar", async ({
    page,
  }) => {
    await openDemo(page, SUNDAY);

    // Las rutinas se gestionan en Ajustes → Rutinas: no hay silo de Gym.
    await goTab(page, "Silos");
    await expect.poll(() => siloLabels(page)).not.toHaveLength(0);
    expect(await siloLabels(page)).not.toContainEqual(expect.stringMatching(/^Gym:/));

    await goTab(page, "Semana");
    await openSettings(page);
    await sheet(page).getByRole("button", { name: "Planificación semanal" }).click();
    const plan = page.getByRole("dialog", { name: "Planificación semanal" });
    // Domingo 22/11 → la semana que viene es lun 23/11 – dom 29/11.
    await expect(plan).toContainText("Semana del lun 23/11 al dom 29/11");
    // «Tu semana tipo»: conteos reales de lo armado, sin desborde en 375 px.
    const tipo = plan.getByTestId("week-type");
    await expect(tipo).toContainText(/^Tu semana tipo: \d+ materias?/);
    const box = await tipo.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);

    await plan.getByRole("button", { name: "Cerrar resumen" }).click();
    // Se abrió desde Ajustes: cerrar vuelve ahí.
    await expect(sheet(page)).toHaveAccessibleName("Ajustes");
    await sheet(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // La semana siguiente tiene las 3 sesiones de Gym, cada una un día distinto.
    await page.getByRole("button", { name: "Semana siguiente" }).click();
    await expect(page.getByRole("button", { name: /Volver a esta semana/ })).toContainText("23");
    const gym = async () => {
      const labels = await page
        .getByTestId("week")
        .locator(".pill.planned")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      return labels.filter((l) => l.startsWith("Gym, "));
    };
    await expect.poll(async () => (await gym()).length).toBe(3);
    const dias = (await gym()).map((l) => l.split(", ")[1]?.split(" ")[0]);
    expect(new Set(dias).size).toBe(3);

    await reload(page);
    await goTab(page, "Silos");
    expect(await siloLabels(page)).not.toContainEqual(expect.stringMatching(/^Gym:/));
  });
});
