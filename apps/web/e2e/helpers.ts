import { expect, type Locator, type Page } from "@playwright/test";

/** Domingo 22/11/2026, 12:00 en Montevideo (UTC-3, sin horario de verano). */
export const SUNDAY = new Date("2026-11-22T15:00:00Z");
/** Lunes 23/11/2026, 08:00 en Montevideo. */
export const MONDAY = new Date("2026-11-23T11:00:00Z");

/** El iPhone chico de las pruebas manuales (375×812), con la zona horaria de la app. */
export const IPHONE_375 = {
  viewport: { width: 375, height: 812 },
  timezoneId: "America/Montevideo",
  locale: "es-UY",
} as const;

/** Abre la demo con el reloj fijo (la hora sigue corriendo desde ahí). */
export async function openDemo(page: Page, at: Date = SUNDAY): Promise<void> {
  await page.clock.install({ time: at });
  await page.goto("/");
  await page.getByRole("button", { name: "Probar con datos de ejemplo" }).click();
  await expect(page.getByTestId("week")).toBeVisible();
}

/** Recarga sin cambiar de reloj: la demo vuelve desde lo guardado en el aparato. */
export async function reload(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId("week")).toBeVisible();
}

export const tabs = (page: Page): Locator => page.getByRole("navigation", { name: "Secciones" });

export async function goTab(page: Page, name: "Semana" | "Silos" | "Bandeja"): Promise<void> {
  const tab = tabs(page).getByRole("button", { name: new RegExp(`^${name}`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-current", "page");
}

/** La hoja de arriba de todo (Ajustes, un formulario, una pregunta). */
export const sheet = (page: Page): Locator => page.getByRole("dialog").last();

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
}

/** Ajustes → una de sus pantallas (por el comienzo del nombre de su fila). */
export async function openSettingsPage(page: Page, title: string): Promise<void> {
  await openSettings(page);
  await sheet(page)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .click();
  await expect(sheet(page)).toHaveAccessibleName(title);
}

/** Ajustes → Rutinas → «Crear rutina nueva»: abre el formulario (la lista y el formulario son dos vistas). */
export async function openNewRoutine(page: Page): Promise<void> {
  await openSettingsPage(page, "Rutinas");
  await sheet(page).getByRole("button", { name: "Crear rutina nueva" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Rutina nueva" })).toBeVisible();
}

/** El aviso de abajo (el que ofrece «Deshacer»). */
export const toast = (page: Page): Locator => page.locator(".toasts .snack");

export async function undo(page: Page): Promise<void> {
  await toast(page).getByRole("button", { name: "Deshacer" }).click();
}

/** Lo que dicen los silos, tal como los lee un lector de pantalla. */
export async function siloLabels(page: Page): Promise<string[]> {
  await expect(page.locator(".silo[data-task]").first()).toBeVisible();
  return page
    .locator(".silo[data-task]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
}
