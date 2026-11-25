import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet, toast } from "./helpers";

test.use(IPHONE_375);

// «Le dediqué» de una rutina no pasa de lo que le falta esa semana.
test("una rutina no acepta más minutos que los que le faltan esta semana", async ({ page }) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Rutinas");
  await sheet(page).getByRole("button", { name: /^Gym/ }).first().click();
  const faltan = sheet(page).getByText(/Esta semana: faltan/);
  const texto = (await faltan.textContent()) ?? "";
  const dato = texto.split("faltan ").at(1) ?? "";
  const [horas = "", resto = ""] = dato.includes("h") ? dato.split("h") : ["0", dato];
  const tope = Number(horas) * 60 + (Number.parseInt(resto, 10) || 0);
  expect(tope).toBeGreaterThan(0);

  const campo = sheet(page).getByLabel("Le dediqué (minutos)");
  await campo.fill("1440");
  await expect(campo).toHaveAttribute("aria-invalid", "true");
  await expect(sheet(page).getByRole("alert")).toHaveText(
    `Poné minutos de 0 a ${tope}, solo cifras.`,
  );
  await sheet(page).getByRole("button", { name: "Guardar avance" }).click({ force: true });
  await expect(toast(page)).toBeHidden();
  await expect(sheet(page).getByLabel("Le dediqué (minutos)")).toBeVisible();

  await campo.fill(String(tope));
  await expect(campo).not.toHaveAttribute("aria-invalid", "true");
  await sheet(page).getByRole("button", { name: "Guardar avance" }).click();
  await expect(toast(page)).toContainText("Avance guardado");

  // Completa: ya no se ofrece registrar.
  await sheet(page).getByRole("button", { name: /^Gym/ }).first().click();
  await expect(sheet(page).getByText(/ya está completa/)).toBeVisible();
  await expect(sheet(page).getByLabel("Le dediqué (minutos)")).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Guardar avance" })).toHaveCount(0);
});
