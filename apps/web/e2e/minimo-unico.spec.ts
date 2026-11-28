import { expect, type Page, test } from "@playwright/test";
import { goTab, IPHONE_375, sheet, toast } from "./helpers";

test.use(IPHONE_375);

// Un solo mínimo (SPEC §5.6): el que nombra la opción de la Bandeja es el que quedan mostrando
// la ficha y el formulario, y la semana no marca «crítico» lo que ya llega.
test.describe.configure({ timeout: 90_000 });

/** Miércoles 25/11/2026, 10:00 en Montevideo: el informe de 9 h vence el sábado y no entra. */
const MIERCOLES = new Date("2026-11-25T13:00:00Z");
const INFORME = "Informe corto SD";

async function abrirDemoDePruebas(page: Page) {
  await page.clock.install({ time: MIERCOLES });
  await page.goto("/?demo=pruebas");
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

/** La ficha de la entrega (Silos): lo que dice que falta y su mínimo. */
async function ficha(page: Page): Promise<string> {
  await goTab(page, "Silos");
  await page.locator(".silo[data-task]", { hasText: INFORME }).first().click();
  const meta = sheet(page).locator("p.meta").first();
  await expect(meta).toContainText("mínimo");
  return (await meta.textContent()) ?? "";
}

test("la versión mínima deja el mismo mínimo en la Bandeja, la ficha y el formulario, y nada crítico", async ({
  page,
}) => {
  await abrirDemoDePruebas(page);
  await goTab(page, "Bandeja");
  await expect(page.getByText("No llegás a todo · elegí")).toBeVisible();
  const opcion = page.locator(".card", { hasText: `Entregar una versión mínima de ${INFORME}` });
  const titulo = (await opcion.locator(".title").textContent()) ?? "";
  const nombrado = /\((\d+h(?:\d\d)?|\d+m)\)$/.exec(titulo)?.[1] ?? "";
  expect(nombrado).not.toBe("");

  await opcion.getByRole("button", { name: /^Elegir: / }).click();
  await page.getByRole("button", { name: "Aceptar reparto" }).click();
  // Un toque humano llega unos cientos de ms después de cerrar la hoja.
  await page.waitForTimeout(700);
  await expect(toast(page)).toContainText("Listo, reacomodé el plan");
  // La entrega ya llega: ninguna opción habla de ella.
  await expect(
    page.locator(`button[aria-label^="Elegir: "][aria-label*="${INFORME}"]`),
  ).toHaveCount(0);

  // La ficha dice lo que falta para el mínimo (nunca más que lo que falta)...
  const texto = await ficha(page);
  expect(texto).toMatch(/Faltan \S+ \((para el mínimo, \S+|mínimo cubierto)\)/);
  // ...y el formulario, el mínimo que nombraba la opción (en horas).
  await sheet(page).getByRole("button", { name: "Editar" }).click();
  const horas = Number(
    (await sheet(page).getByLabel("Mínimo (horas)").inputValue()).replace(",", "."),
  );
  const [h = "0", m = "0"] = nombrado.replace("m", "").split("h");
  expect(Math.round(horas * 60)).toBe(Number(h) * 60 + Number(m || 0));
  while (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // La semana: ningún bloque de la entrega marcado «crítico».
  // Cerrar las hojas vuelve atrás en el historial: se reintenta hasta que la pestaña quede.
  await expect(async () => goTab(page, "Semana")).toPass();
  await expect(page.getByTestId("week")).toBeVisible();
  const criticos = page
    .getByTestId("week")
    .locator(`[aria-label*="${INFORME}"][aria-label*="crítico: no llega a tiempo"]`);
  await expect(criticos).toHaveCount(0);
});
