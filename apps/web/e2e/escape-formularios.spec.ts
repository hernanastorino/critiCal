import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  goTab,
  IPHONE_375,
  MONDAY,
  openDemo,
  openNewRoutine,
  openSettings,
  openSettingsPage,
  sheet,
} from "./helpers";

test.use(IPHONE_375);

// Escape en cada formulario: sin cambios cierra (o vuelve un nivel); con un cambio sin guardar
// pregunta «¿Descartar los cambios?» (o, si guarda al instante, no pierde nada).
const pregunta = (page: Page) => page.getByRole("alertdialog", { name: "¿Descartar los cambios?" });

/** El primer campo de texto, número u hora que se ve en la hoja de arriba. */
const campo = (page: Page): Locator =>
  sheet(page)
    .locator(
      "input:not([type=checkbox]):not([type=radio]):not([type=search]):not([type=hidden]):not([disabled])",
    )
    .filter({ visible: true })
    .first();

/** Cambia el campo: a otra hora si es de hora, si no le agrega texto. */
async function tocar(campo: Locator): Promise<void> {
  const tipo = await campo.getAttribute("type");
  const actual = await campo.inputValue();
  const nuevo = tipo === "time" ? "03:15" : tipo === "date" ? "2026-12-30" : `${actual}7`;
  await campo.fill(nuevo);
}

// El nombre del parámetro de un tipo de función no se usa: es un falso positivo de la regla.
// eslint-disable-next-line no-unused-vars
type Paso<T = void> = (page: Page) => Promise<T>;

interface Caso {
  nombre: string;
  /** Llega al formulario. */
  abrir: Paso;
  /** Qué hoja queda abierta (por su nombre) al volver un nivel con Escape; null: se cierra todo. */
  vuelve: string | null;
  /** Hace un cambio sin guardar; devuelve cómo ver que sigue ahí. */
  cambiar: Paso<() => Promise<void>>;
  /** El formulario guarda al instante: Escape no pregunta, y el cambio queda. */
  instantaneo?: boolean;
  /** No tiene nada que escribir (acá, sin cuenta): solo se prueba el cierre sin cambios. */
  soloLectura?: boolean;
  /** Reloj de la demo (por defecto, el lunes a las 08:00). */
  reloj?: Date;
}

/** El cambio del primer campo de la hoja, para los formularios simples. */
const cambiarCampo = async (page: Page) => {
  const c = campo(page);
  await tocar(c);
  const valor = await c.inputValue();
  return async () => expect(campo(page)).toHaveValue(valor);
};

const casos: Caso[] = [
  {
    nombre: "Ajustes: Hoy",
    abrir: (page) => openSettings(page),
    vuelve: null,
    cambiar: async (page) => {
      const c = sheet(page).getByLabel("Me levanté a las");
      await c.fill("06:45");
      return async () => expect(c).toHaveValue("06:45");
    },
  },
  {
    nombre: "Ajustes: Mi semana",
    abrir: (page) => openSettingsPage(page, "Mi semana"),
    vuelve: "Ajustes",
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Materias (una fila abierta)",
    abrir: async (page) => {
      await openSettingsPage(page, "Materias");
      await sheet(page).locator("[data-activity-head]").first().click();
    },
    vuelve: "Ajustes",
    cambiar: async (page) => {
      const c = sheet(page).getByLabel("Nombre de la materia");
      await c.fill(`${await c.inputValue()} x`);
      const valor = await c.inputValue();
      return async () => expect(sheet(page).getByLabel("Nombre de la materia")).toHaveValue(valor);
    },
  },
  {
    nombre: "Ajustes: Rutinas (nueva)",
    abrir: (page) => openNewRoutine(page),
    vuelve: "Rutinas",
    cambiar: async (page) => {
      await sheet(page).getByPlaceholder("Gimnasio").fill("Nadar");
      return async () => expect(sheet(page).getByPlaceholder("Gimnasio")).toHaveValue("Nadar");
    },
  },
  {
    nombre: "Ajustes: Rutinas (editar una)",
    abrir: async (page) => {
      await openSettingsPage(page, "Rutinas");
      await sheet(page).getByRole("button", { name: /^Gym/ }).first().click();
      await sheet(page).getByRole("button", { name: "Editar" }).click();
    },
    vuelve: "Rutinas",
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Lugares (nuevo)",
    abrir: async (page) => {
      await openSettingsPage(page, "Lugares y traslados");
      await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
    },
    vuelve: "Lugares y traslados",
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Reglas",
    abrir: (page) => openSettingsPage(page, "Reglas"),
    vuelve: "Ajustes",
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Notificaciones",
    abrir: (page) => openSettingsPage(page, "Notificaciones"),
    vuelve: "Ajustes",
    soloLectura: true,
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Planificación semanal",
    abrir: async (page) => {
      await openSettings(page);
      await sheet(page).getByRole("button", { name: "Planificación semanal" }).click();
      await expect(sheet(page)).toHaveAccessibleName("Planificación semanal");
    },
    vuelve: "Ajustes",
    soloLectura: true,
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Inicio de cuatrimestre",
    abrir: (page) => openSettingsPage(page, "Inicio de cuatrimestre"),
    vuelve: "Ajustes",
    cambiar: cambiarCampo,
  },
  {
    nombre: "Ajustes: Horas para lo detectado",
    abrir: (page) => openSettingsPage(page, "Horas para lo detectado"),
    vuelve: "Ajustes",
    cambiar: cambiarCampo,
  },
  {
    nombre: "Silos: detalle de una entrega",
    abrir: async (page) => {
      await goTab(page, "Silos");
      await page.locator(`.silo[data-task="informe-fis"]`).click();
    },
    vuelve: null,
    cambiar: async (page) => {
      await sheet(page).getByLabel("Le dediqué (minutos)").fill("90");
      return async () => expect(sheet(page).getByLabel("Le dediqué (minutos)")).toHaveValue("90");
    },
  },
  {
    nombre: "Silos: detalle de un parcial",
    abrir: async (page) => {
      await goTab(page, "Silos");
      await page
        .locator(".silo[data-task]")
        .filter({ hasText: /Parcial/ })
        .first()
        .click();
    },
    vuelve: null,
    cambiar: async (page) => {
      await sheet(page).getByLabel("Le dediqué (minutos)").fill("45");
      return async () => expect(sheet(page).getByLabel("Le dediqué (minutos)")).toHaveValue("45");
    },
  },
  {
    nombre: "Silos: actividad nueva",
    abrir: async (page) => {
      await goTab(page, "Silos");
      await page.getByRole("button", { name: "Nueva actividad" }).click();
      await expect(sheet(page)).toBeVisible();
    },
    vuelve: null,
    cambiar: cambiarCampo,
  },
  {
    nombre: "Semana: hoja de un bloque (con un parcial a medias)",
    reloj: new Date("2026-11-23T16:00:00Z"),
    abrir: async (page) => {
      // A las 13:00 los bloques de las 10:00 ya terminaron y esperan «¿Cómo te fue?».
      await page.locator(".pill.planned").first().click();
      await page.getByRole("button", { name: /Marcar cómo te fue|Ver detalle/ }).click();
      await expect(sheet(page).getByRole("button", { name: /Parcial/ })).toBeVisible();
    },
    vuelve: null,
    cambiar: async (page) => {
      await sheet(page)
        .getByRole("button", { name: /Parcial/ })
        .click();
      return async () =>
        expect(sheet(page).getByRole("button", { name: "Guardar parcial" })).toBeVisible();
    },
  },
  {
    nombre: "Semana: hoja de un evento",
    abrir: async (page) => {
      await page.locator(".pill.fixed").first().click();
      await page.getByRole("button", { name: /Abrir evento/ }).click();
      await expect(sheet(page)).toBeVisible();
    },
    vuelve: null,
    soloLectura: true,
    cambiar: cambiarCampo,
  },
];

for (const caso of casos) {
  test.describe(caso.nombre, () => {
    test("sin cambios, Escape cierra o vuelve un nivel", async ({ page }) => {
      await openDemo(page, caso.reloj ?? MONDAY);
      await caso.abrir(page);
      await page.keyboard.press("Escape");
      await expect(pregunta(page)).toHaveCount(0);
      if (caso.vuelve === null) {
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } else {
        await expect(sheet(page)).toHaveAccessibleName(caso.vuelve);
      }
    });

    test("con un cambio, Escape pregunta antes de descartar (o no pierde nada)", async ({
      page,
    }) => {
      test.skip(!!caso.soloLectura, "nada que escribir");
      await openDemo(page, caso.reloj ?? MONDAY);
      await caso.abrir(page);
      const sigue = await caso.cambiar(page);
      await page.keyboard.press("Escape");
      if (caso.instantaneo) {
        await expect(pregunta(page)).toHaveCount(0);
        // Guardó al instante: al volver a abrir, el cambio sigue.
        await caso.abrir(page);
        await sigue();
        return;
      }
      await expect(pregunta(page)).toBeVisible();
      // Escape sobre la pregunta es «Seguir editando»: lo escrito sigue ahí.
      await page.keyboard.press("Escape");
      await expect(pregunta(page)).toHaveCount(0);
      await sigue();
      // Y descartar lo tira y sale.
      await page.keyboard.press("Escape");
      // Un toque a ras de otro que cerró una hoja se toma por el resto de un doble toque.
      await page.waitForTimeout(450);
      await pregunta(page).getByRole("button", { name: "Descartar" }).click();
      await expect(pregunta(page)).toHaveCount(0);
      if (caso.vuelve === null) {
        await expect(page.getByRole("dialog")).toHaveCount(0);
      } else {
        await expect(sheet(page)).toHaveAccessibleName(caso.vuelve);
      }
    });
  });
}
