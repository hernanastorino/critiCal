import { expect, test } from "@playwright/test";
import { goTab, IPHONE_375, toast } from "./helpers";

test.use(IPHONE_375);
test.describe.configure({ timeout: 90_000 });

// Una rutina soltada en un día que no va (la demo de pruebas: Gym «No ese día» sábado y
// domingo) no desaparece: vuelve a su lugar con un aviso, sin ↶.
const MIERCOLES = new Date("2026-11-25T13:00:00Z");

test("Gym soltado en el domingo vuelve a su lugar y avisa", async ({ page }) => {
  await page.clock.install({ time: MIERCOLES });
  await page.goto("/?demo=pruebas");
  const week = page.getByTestId("week");
  await expect(week).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Modo edición").click();
  const gym = week.locator('.pill.planned.movable[aria-label^="Gym, "]').first();
  const label = await gym.getAttribute("aria-label");
  const from = await gym.boundingBox();
  const sunday = await week.locator("[data-date]").last().boundingBox();
  if (!from || !sunday) throw new Error("sin cajas");
  await page.mouse.move(from.x + from.width / 2, from.y + 4);
  await page.mouse.down();
  await page.mouse.move(sunday.x + sunday.width / 2, sunday.y + sunday.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await expect(toast(page)).toContainText("Gym no va los domingos: vuelve a su lugar");
  await expect(toast(page).getByRole("button", { name: "Deshacer" })).toHaveCount(0);
  // Sigue en la semana, donde estaba y sin fijar.
  await expect(week.locator(`.pill[aria-label="${label}"]`)).toHaveCount(1);
  await expect(week.locator(".pill.pinned")).toHaveCount(0);
  await goTab(page, "Bandeja");
  await expect(page.getByText(/Gym: entra 0 de/)).toHaveCount(0);
});
