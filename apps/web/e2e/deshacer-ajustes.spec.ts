import { expect, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openDemo, openSettingsPage, sheet } from "./helpers";

test.use(IPHONE_375);

// 35.ª vuelta: «Deshacer» del aviso con Ajustes abierto.

test("eliminar una materia con Ajustes abierto: «Deshacer» del aviso la devuelve y la hoja sigue", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Materias");
  await sheet(page).getByRole("button", { name: /^Gym/ }).click();
  await sheet(page).getByRole("button", { name: "Eliminar Gym" }).click();
  await expect(page.getByText("Gym eliminada")).toBeVisible();
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.getByText("Gym eliminada")).toHaveCount(0);
  await expect(sheet(page)).toHaveAccessibleName("Materias");
  await expect(sheet(page).getByRole("button", { name: /^Gym/ })).toBeVisible();
});

test("eliminar una materia y dejar pasar el aviso: la flecha de la cabecera la devuelve", async ({
  page,
}) => {
  await openDemo(page, MONDAY);
  await openSettingsPage(page, "Materias");
  await sheet(page).getByRole("button", { name: /^Gym/ }).click();
  await sheet(page).getByRole("button", { name: "Eliminar Gym" }).click();
  await expect(page.getByText("Gym eliminada")).toBeVisible();
  // El aviso se va solo (4 s); la hoja se cierra y la flecha dice qué deshace.
  await page.clock.fastForward(6000);
  await expect(page.getByText("Gym eliminada")).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Deshacer: eliminar Gym" }).click();
  await openSettingsPage(page, "Materias");
  await expect(sheet(page).getByRole("button", { name: /^Gym/ })).toBeVisible();
});
