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
  test("muestra la semana próxima, la silo de la rutina la adopta y persiste al recargar", async ({
    page,
  }) => {
    await openDemo(page, SUNDAY);

    // Antes de planificar, la rutina cuenta la semana en curso.
    await goTab(page, "Silos");
    await expect
      .poll(() => siloLabels(page))
      .toContainEqual(expect.stringMatching(/^Gym: .*esta semana$/));

    await goTab(page, "Semana");
    await openSettings(page);
    await sheet(page).getByRole("button", { name: "Planificación semanal" }).click();
    const plan = page.getByRole("dialog", { name: "Planificación semanal" });
    // Domingo 22/11 → la semana que viene es lun 23/11 – dom 29/11.
    await expect(plan).toContainText("Semana del lun 23/11 al dom 29/11");

    await plan.getByRole("button", { name: "Cerrar resumen" }).click();
    // Se abrió desde Ajustes: cerrar vuelve ahí.
    await expect(sheet(page)).toHaveAccessibleName("Ajustes");
    await sheet(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await goTab(page, "Silos");
    await expect
      .poll(() => siloLabels(page))
      .toContainEqual(expect.stringMatching(/^Gym: .*la semana próxima$/));

    await reload(page);
    await goTab(page, "Silos");
    await expect
      .poll(() => siloLabels(page))
      .toContainEqual(expect.stringMatching(/^Gym: .*la semana próxima$/));
  });
});
