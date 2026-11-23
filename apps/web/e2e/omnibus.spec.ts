import { expect, type Page, test } from "@playwright/test";
import { IPHONE_375, MONDAY, openSettings, sheet } from "./helpers";

test.use(IPHONE_375);

// La tarjeta de un evento en ómnibus (SPEC §15) de punta a punta, sin red ni cuenta: la
// «Demo de pruebas» trae dos eventos futuros con lugar en modo Ómnibus, una casa con dirección
// y horarios inventados (src/demoTransit.ts).
//   · «Clase en la Facultad» (mañana de lunes, 14:00–16:00): hay ómnibus, con un transbordo.
//   · «Taller en el Cerro» (pasado mañana, 10:00–11:30): sin datos de tránsito, va en auto.

const MIN = 60_000;

async function abrirDemoDePruebas(page: Page) {
  await page.clock.install({ time: MONDAY });
  await page.goto("/?demo=pruebas");
  // La demo de pruebas arma un plan cargado: en una máquina lenta tarda en aparecer.
  await expect(page.getByTestId("week")).toBeVisible({ timeout: 20_000 });
}

/** Abre la tarjeta del evento que se toca en la semana. */
async function abrirTarjeta(page: Page, titulo: string) {
  await page
    .getByTestId("week")
    .getByRole("button", { name: new RegExp(`^${titulo},`) })
    .click();
  const tarjeta = page.getByRole("dialog", { name: titulo });
  await expect(tarjeta.getByText("Cómo llegar")).toBeVisible();
  return tarjeta;
}

/** El estado guardado de la demo (lo que ve el plan). */
const guardado = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}"));

test.describe("tarjeta del evento en ómnibus", () => {
  // La demo de pruebas arma un plan cargado: en una máquina lenta cada prueba tarda.
  test.describe.configure({ timeout: 60_000 });

  test("muestra solo las líneas y la hora de salida de ida y de vuelta; las paradas, al tocar", async ({
    page,
  }) => {
    await abrirDemoDePruebas(page);
    const tarjeta = await abrirTarjeta(page, "Clase en la Facultad");
    await expect(tarjeta.getByRole("button", { name: "Ómnibus" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Llega a las 14:00: 42 min puerta a puerta → sale 13:18. Vuelve al terminar, 16:00 → 16:05.
    const ida = tarjeta.getByRole("region", { name: "Ida" });
    const vuelta = tarjeta.getByRole("region", { name: "Vuelta" });
    await expect(ida.locator("summary")).toHaveText("Ida · salís 13:18 · 128 → 710");
    await expect(vuelta.locator("summary")).toHaveText("Vuelta · salís 16:05 · 128 → 710");

    // Cerrada, nada más: ni paradas, ni transbordos, ni caminatas.
    await expect(ida.locator("details")).not.toHaveAttribute("open", "");
    await expect(ida.locator(".bus-steps")).toBeHidden();
    await expect(ida.getByText(/transbordo/)).toBeHidden();

    // Al tocar: las paradas con su hora, el transbordo y la llegada.
    await ida.locator("summary").click();
    await expect(
      ida.getByText("Salí a las 13:18 · llegás a las 14:00 (42 min) · 1 transbordo"),
    ).toBeVisible();
    await expect(
      ida.getByText("Línea 128 a Tres Cruces · parada Rivera y Ellauri a las 13:23"),
    ).toBeVisible();
    await expect(
      ida.getByText(/Línea 710 a Facultad · parada Tres Cruces a las 13:41/),
    ).toBeVisible();
    await expect(ida.getByText(/bajás en Tres Cruces/)).toBeVisible();
    await expect(ida.getByText(/Caminá 5 min hasta Rivera y Ellauri/)).toBeVisible();
    // La vuelta sigue cerrada: cada tramo se abre por separado.
    await expect(vuelta.locator(".bus-steps")).toBeHidden();
  });

  test("la fuente de los horarios está en Ajustes y no en la tarjeta", async ({ page }) => {
    await abrirDemoDePruebas(page);
    const tarjeta = await abrirTarjeta(page, "Clase en la Facultad");
    await tarjeta.getByRole("region", { name: "Ida" }).locator("summary").click();
    await expect(
      tarjeta.getByText(/Intendencia de Montevideo|datos abiertos|Horarios teóricos/),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Clase en la Facultad" })).toBeHidden();
    await openSettings(page);
    await expect(
      sheet(page).getByText(/Horarios teóricos: Intendencia de Montevideo \(STM\)/),
    ).toBeVisible();
    await expect(sheet(page).getByText(/Son horarios teóricos, sin tiempo real/)).toBeVisible();
  });

  test("el plan reserva el tiempo del viaje antes y después del evento", async ({ page }) => {
    await abrirDemoDePruebas(page);
    const tarjeta = await abrirTarjeta(page, "Clase en la Facultad");
    await expect(tarjeta.getByRole("region", { name: "Vuelta" }).locator("summary")).toBeVisible();

    // Los minutos del ómnibus quedan guardados con el evento: 42 de ida y 48 de vuelta.
    await expect
      .poll(async () => (await guardado(page)).tripMinutes?.["clase-fing"])
      .toMatchObject({ minutes: 42, back: 48 });
    const d = await guardado(page);
    const clase = d.events.find((e: { id: string }) => e.id === "clase-fing");
    const margen: number = d.settings.travelMarginMinutes;

    // Nada del plan cae en esa ventana: 42 min + el margen antes, 48 min después.
    const desde = clase.start - (42 + margen) * MIN;
    const hasta = clase.end + 48 * MIN;
    const choques = d.plan.filter(
      (b: { start: number; end: number }) => b.start < hasta && b.end > desde,
    );
    expect(choques).toEqual([]);
    // Y la ventana es la del ómnibus, no la del auto: el último bloque anterior cabe justo o antes.
    expect(d.tripMinutes["clase-fing"].start).toBe(clase.start);
  });

  test("sin dato de tránsito el plan usa el tiempo de auto y la tarjeta lo avisa", async ({
    page,
  }) => {
    await abrirDemoDePruebas(page);
    const tarjeta = await abrirTarjeta(page, "Taller en el Cerro");
    await expect(tarjeta.getByRole("button", { name: "Ómnibus" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      tarjeta.getByText("No hay paradas cerca de alguno de los dos lugares."),
    ).toHaveCount(2);
    await expect(
      tarjeta.getByText("Todavía no tengo los minutos del ómnibus: el plan usa los del auto."),
    ).toBeVisible();
    await expect(tarjeta.locator("summary")).toHaveCount(0);

    // No se guardó nada del ómnibus de este evento: el plan sigue con el auto.
    expect((await guardado(page)).tripMinutes?.["taller-cerro"]).toBeUndefined();
  });

  test("la tarjeta no desborda y los campos no bajan de 16 px, también con letra grande", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "iphone", "solo en el proyecto iphone");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrirDemoDePruebas(page);
    for (const px of [16, 24]) {
      await page.evaluate((v) => {
        document.documentElement.style.fontSize = `${v}px`;
      }, px);
      const tarjeta = await abrirTarjeta(page, "Clase en la Facultad");
      await tarjeta.getByRole("region", { name: "Ida" }).locator("summary").click();
      await tarjeta.getByRole("region", { name: "Vuelta" }).locator("summary").click();

      const medidas = await tarjeta.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hijos = [...el.querySelectorAll("*")]
          .map((c) => c.getBoundingClientRect())
          .filter((c) => c.width > 0);
        const campos = [...el.querySelectorAll("input, textarea, select")].map((c) =>
          Number.parseFloat(getComputedStyle(c).fontSize),
        );
        return {
          izquierda: r.left,
          derecha: r.right,
          ancho: window.innerWidth,
          fuera: hijos.filter((c) => c.left < r.left - 1 || c.right > r.right + 1).length,
          campos,
          scroll: el.scrollWidth - el.clientWidth,
          pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(medidas.izquierda, `izquierda a ${px}px`).toBeGreaterThanOrEqual(0);
      expect(medidas.derecha, `derecha a ${px}px`).toBeLessThanOrEqual(medidas.ancho);
      expect(medidas.fuera, `hijos fuera de la tarjeta a ${px}px`).toBe(0);
      expect(medidas.scroll, `desborde horizontal de la tarjeta a ${px}px`).toBeLessThanOrEqual(0);
      expect(medidas.pagina, `desborde de la página a ${px}px`).toBeLessThanOrEqual(0);
      for (const f of medidas.campos) expect(f).toBeGreaterThanOrEqual(16);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Clase en la Facultad" })).toBeHidden();
    }
  });
});
