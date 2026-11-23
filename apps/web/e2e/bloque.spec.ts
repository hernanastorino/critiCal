import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, openDemo, sheet, toast, undo } from "./helpers";

test.use(IPHONE_375);

// Con el reloj en el domingo 22/11 12:00, el bloque del sábado ya pasó y espera respuesta.
const BLOQUE = /^Parcial Cálculo II, sáb 12:00 a 13:00/;

const bloque = (page: Page) => page.getByTestId("week").getByRole("button", { name: BLOQUE });

/** Toca el bloque, después su globo, y queda la hoja del bloque abierta. */
async function abrir(page: Page) {
  await bloque(page).click();
  await page.locator(".bubble").click();
  await expect(sheet(page).getByRole("heading", { name: "Parcial Cálculo II" })).toBeVisible();
}

async function cerrar(page: Page) {
  await sheet(page).getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const hecho = (page: Page) => sheet(page).getByRole("button", { name: /Hecho/ });
const parcial = (page: Page) => sheet(page).getByRole("button", { name: /^\s*Parcial$/ });
const no = (page: Page) => sheet(page).getByRole("button", { name: /^\s*No$/ });
const registrado = (page: Page) => sheet(page).getByText(/^Ya registrado:/);

/** El bloque sin respuesta: la hoja ofrece Hecho, Parcial y No, y nada «registrado». */
async function sinResponder(page: Page) {
  await abrir(page);
  await expect(hecho(page)).toBeVisible();
  await expect(registrado(page)).toHaveCount(0);
  await cerrar(page);
}

test.describe("hoja de bloque: cada respuesta se puede deshacer", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
    await sinResponder(page);
  });

  test("Hecho: queda registrado y «Deshacer» lo deja sin responder", async ({ page }) => {
    await abrir(page);
    await hecho(page).click();
    // Responder cierra la hoja y avisa.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await undo(page);
    await sinResponder(page);

    // Sin deshacer, queda anotado.
    await abrir(page);
    await hecho(page).click();
    await expect(toast(page)).toContainText("Anotado como hecho.");
    await abrir(page);
    await expect(registrado(page)).toHaveText("Ya registrado: hecho ✓");
  });

  test("Parcial: pregunta cuánto, queda registrado y «Deshacer» lo deja sin responder", async ({
    page,
  }) => {
    await abrir(page);
    await parcial(page).click();
    await expect(sheet(page).getByText(/¿Cuánto del bloque usaste\? 50 %/)).toBeVisible();
    await sheet(page).getByRole("button", { name: "Guardar parcial" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toast(page)).toContainText("Anotado como parcial.");
    await undo(page);
    await sinResponder(page);

    await abrir(page);
    await parcial(page).click();
    await sheet(page).getByRole("button", { name: "Guardar parcial" }).click();
    await expect(toast(page)).toContainText("Anotado como parcial.");
    await abrir(page);
    await expect(registrado(page)).toContainText("Ya registrado: parcial (30m)");
  });

  test("No: queda registrado y «Deshacer» lo deja sin responder", async ({ page }) => {
    await abrir(page);
    await no(page).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toast(page)).toContainText("Anotado, sin culpa");
    await undo(page);
    await sinResponder(page);

    await abrir(page);
    await no(page).click();
    await expect(toast(page)).toContainText("Anotado, sin culpa");
    await abrir(page);
    await expect(registrado(page)).toHaveText("Ya registrado: no lo hice ✗");
  });

  test("Corregir: cambia la respuesta y «Deshacer» trae la anterior", async ({ page }) => {
    await abrir(page);
    await hecho(page).click();
    await expect(toast(page)).toContainText("Anotado como hecho.");

    await abrir(page);
    await sheet(page).getByRole("button", { name: "Corregir" }).click();
    // Corregir vuelve a ofrecer las tres respuestas.
    await no(page).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toast(page)).toContainText("Corregido: ahora figura como no hecho.");

    await undo(page);
    await abrir(page);
    await expect(registrado(page)).toHaveText("Ya registrado: hecho ✓");

    // Y se puede corregir a parcial.
    await sheet(page).getByRole("button", { name: "Corregir" }).click();
    await parcial(page).click();
    await sheet(page).getByRole("button", { name: "Guardar parcial" }).click();
    await expect(toast(page)).toContainText("Corregido: ahora figura como parcial.");
    await undo(page);
    await abrir(page);
    await expect(registrado(page)).toHaveText("Ya registrado: hecho ✓");
  });
});
