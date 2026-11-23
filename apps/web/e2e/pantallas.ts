import { expect, type Page } from "@playwright/test";
import { goTab, sheet } from "./helpers";

const ajustes = (page: Page) => page.getByRole("button", { name: "Ajustes", exact: true });
const pantallaDeAjustes = (nombre: string) => async (page: Page) => {
  await ajustes(page).click();
  await sheet(page)
    .getByRole("button", { name: new RegExp(`^${nombre}`) })
    .click();
  await expect(sheet(page)).toHaveAccessibleName(nombre);
};

/** Cada lugar de la app donde se mira el desborde: cómo llegar ahí desde la Semana. */
export const PANTALLAS: { nombre: string; abrir: (page: Page) => Promise<void> }[] = [
  { nombre: "Semana", abrir: async () => undefined },
  {
    nombre: "Silos",
    abrir: async (page) => {
      await goTab(page, "Silos");
      await expect(page.getByRole("heading", { name: "Lo que falta" })).toBeVisible();
    },
  },
  {
    nombre: "Bandeja",
    abrir: async (page) => {
      await goTab(page, "Bandeja");
      await expect(page.getByRole("heading", { name: "Bandeja" })).toBeVisible();
    },
  },
  {
    nombre: "Ajustes",
    abrir: async (page) => {
      await ajustes(page).click();
      await expect(sheet(page)).toHaveAccessibleName("Ajustes");
    },
  },
  ...[
    "Mi semana",
    "Materias",
    "Rutinas",
    "Reglas",
    "Lugares y traslados",
    "Notificaciones",
    "Respaldo",
  ].map((nombre) => ({ nombre: `Ajustes › ${nombre}`, abrir: pantallaDeAjustes(nombre) })),
  {
    nombre: "Planificación semanal",
    abrir: async (page) => {
      await ajustes(page).click();
      await sheet(page).getByRole("button", { name: "Planificación semanal" }).click();
      await expect(page.getByRole("dialog", { name: "Planificación semanal" })).toBeVisible();
    },
  },
  {
    nombre: "Hoja de un bloque",
    abrir: async (page) => {
      await page
        .getByTestId("week")
        .getByRole("button", { name: /^Parcial Cálculo II, sáb 09:30/ })
        .click();
      await page.locator(".bubble").click();
      await expect(sheet(page).getByRole("heading", { name: "Parcial Cálculo II" })).toBeVisible();
    },
  },
  {
    nombre: "Hoja de un silo",
    abrir: async (page) => {
      await goTab(page, "Silos");
      await page.locator('.silo[data-task="parcial-calc"]').click();
      await expect(sheet(page).getByRole("heading", { name: "Parcial Cálculo II" })).toBeVisible();
    },
  },
];

/** Hojas con campos para escribir: ahí es donde iOS hace zoom si la letra del campo es chica. */
export const FORMULARIOS: { nombre: string; abrir: (page: Page) => Promise<void> }[] = [
  {
    nombre: "Nueva actividad",
    abrir: async (page) => {
      await goTab(page, "Silos");
      await page.getByRole("button", { name: "Nueva actividad" }).click();
      await expect(sheet(page)).toBeVisible();
    },
  },
  {
    nombre: "Ajustes › Rutinas › Rutina nueva",
    abrir: async (page) => {
      await pantallaDeAjustes("Rutinas")(page);
      await sheet(page).getByRole("button", { name: "Crear rutina nueva" }).click();
      await expect(sheet(page).getByRole("heading", { name: "Rutina nueva" })).toBeVisible();
    },
  },
  {
    nombre: "Ajustes › Lugares y traslados › Agregar lugar",
    abrir: async (page) => {
      await pantallaDeAjustes("Lugares y traslados")(page);
      await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
      await expect(sheet(page)).toBeVisible();
    },
  },
  {
    nombre: "Hoja de un bloque › Parcial",
    abrir: async (page) => {
      await PANTALLAS[PANTALLAS.length - 2]?.abrir(page);
      await sheet(page)
        .getByRole("button", { name: /^\s*Parcial$/ })
        .click();
      await expect(sheet(page).getByRole("button", { name: "Guardar parcial" })).toBeVisible();
    },
  },
];
