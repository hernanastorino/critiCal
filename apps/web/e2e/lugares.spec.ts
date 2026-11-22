import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, openDemo, openSettings, openSettingsPage, reload, sheet } from "./helpers";

test.use(IPHONE_375);

const guardar = (page: Page) => sheet(page).getByRole("button", { name: "Guardar", exact: true });
const nombre = (page: Page) => sheet(page).getByLabel("Nombre", { exact: true });
const avisos = (page: Page) => sheet(page).getByRole("region", { name: "Avisos" });

async function addPlace(page: Page, name: string, opts: { home?: boolean; address?: string } = {}) {
  await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
  await nombre(page).fill(name);
  if (opts.address)
    await sheet(page)
      .getByLabel(/^Dirección/)
      .fill(opts.address);
  if (opts.home) await sheet(page).getByLabel("Mi casa").check();
  await guardar(page).click();
  await expect(fila(page, name)).toBeVisible();
}

/** La fila de un lugar en la lista (no las opciones de los menús de más abajo). */
const fila = (page: Page, name: string) =>
  sheet(page)
    .locator(".place-name")
    .filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });

const backToList = async (page: Page) => {
  await sheet(page).getByRole("button", { name: "Volver a Ajustes" }).click();
  await expect(sheet(page)).toHaveAccessibleName("Ajustes");
};

// Lugares y casa (SPEC §8): una sola casa, y los avisos que dicen qué falta.
test.describe("lugares y la casa", () => {
  test("sin casa avisa «Falta tu casa» y el botón lleva a Lugares", async ({ page }) => {
    await openDemo(page);
    await openSettings(page);
    await expect(avisos(page)).toContainText("Falta tu casa");
    await avisos(page).getByRole("button", { name: "Agregar casa" }).click();
    await expect(sheet(page)).toHaveAccessibleName("Lugares y traslados");
  });

  test("casa sin dirección avisa «Tu casa no tiene dirección»; con dirección el aviso se va", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await addPlace(page, "Casa", { home: true });
    await expect(sheet(page).getByText("Tu casa · Auto · sin dirección")).toBeVisible();

    await backToList(page);
    await expect(avisos(page)).toContainText("Tu casa no tiene dirección");
    await expect(avisos(page)).not.toContainText("Falta tu casa");

    await avisos(page).getByRole("button", { name: "Agregar dirección" }).click();
    await sheet(page).getByRole("button", { name: "Editar Casa", exact: true }).click();
    await sheet(page)
      .getByLabel(/^Dirección/)
      .fill("Rivera 1234, Montevideo");
    await guardar(page).click();
    await backToList(page);
    // Sin avisos: la sección entera desaparece.
    await expect(avisos(page)).toHaveCount(0);
  });

  test("«Casa de la abuela Marta» con casa existente no pregunta «Mi casa» y hay una sola casa", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await addPlace(page, "Casa", { home: true, address: "Rivera 1234, Montevideo" });

    await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
    await nombre(page).fill("Casa de la abuela Marta");
    // No ofrece una segunda casa: explica que hay una sola.
    await expect(sheet(page).getByLabel("Mi casa")).toHaveCount(0);
    await expect(sheet(page).getByRole("note")).toContainText("Tu casa ya es Casa: hay una sola");
    await guardar(page).click();
    await expect(fila(page, "Casa de la abuela Marta")).toBeVisible();

    // Una sola marcada como casa, y la abuela no es «Casa» ni cuenta como repetida.
    await expect(sheet(page).getByText(/^Tu casa( ·|$)/)).toHaveCount(1);
    await expect(sheet(page).getByText("Auto · sin dirección")).toHaveCount(1);
    await expect(sheet(page).getByRole("alert")).toHaveCount(0);

    // Sigue así tras recargar (la demo vive en el aparato).
    await reload(page);
    await openSettingsPage(page, "Lugares y traslados");
    await expect(sheet(page).getByText(/^Tu casa( ·|$)/)).toHaveCount(1);
    await expect(fila(page, "Casa de la abuela Marta")).toBeVisible();
  });

  test("desmarcar «Mi casa» vuelve a avisar «Falta tu casa» y deja marcar otra", async ({
    page,
  }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await addPlace(page, "Casa", { home: true, address: "Rivera 1234, Montevideo" });
    await addPlace(page, "Casa de la abuela Marta", { address: "Brasil 2000, Montevideo" });

    await backToList(page);
    await expect(avisos(page)).toHaveCount(0);
    await sheet(page)
      .getByRole("button", { name: /^Lugares y traslados/ })
      .click();

    await sheet(page).getByRole("button", { name: "Editar Casa", exact: true }).click();
    await sheet(page).getByLabel("Mi casa").uncheck();
    await guardar(page).click();
    await expect(sheet(page).getByText(/^Tu casa( ·|$)/)).toHaveCount(0);

    await backToList(page);
    await expect(avisos(page)).toContainText("Falta tu casa");

    // Ahora sí se puede marcar la de la abuela.
    await sheet(page)
      .getByRole("button", { name: /^Lugares y traslados/ })
      .click();
    await sheet(page).getByRole("button", { name: "Editar Casa de la abuela Marta" }).click();
    await sheet(page).getByLabel("Mi casa").check();
    await guardar(page).click();
    await expect(sheet(page).getByText(/^Tu casa( ·|$)/)).toHaveCount(1);
    await backToList(page);
    await expect(avisos(page)).toHaveCount(0);
  });

  test("no deja guardar dos lugares con el mismo nombre", async ({ page }) => {
    await openDemo(page);
    await openSettingsPage(page, "Lugares y traslados");
    await addPlace(page, "Casa", { home: true });
    await sheet(page).getByRole("button", { name: "Agregar lugar" }).click();
    await nombre(page).fill("  casa ");
    await expect(sheet(page).getByRole("alert")).toContainText("Ya tenés un lugar con ese nombre");
    // «Guardar» está en gris (aria-disabled): tocarlo no guarda.
    await expect(guardar(page)).toHaveAttribute("aria-disabled", "true");
    await guardar(page).click({ force: true });
    // Sigue el formulario abierto.
    await expect(nombre(page)).toBeVisible();
  });
});
