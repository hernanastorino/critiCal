import { expect, type Page, type Route, test } from "@playwright/test";
import { MONDAY } from "./helpers";

// Una cuenta con más de 1000 registros contra un Supabase simulado (el build «connected»
// apunta a localhost:54321): la semana actual aparece mientras el resto del historial
// sigue en camino, y después todo llega.

// El service worker atiende los pedidos por su cuenta y `page.route` no los ve.
test.use({ serviceWorkers: "block" });

const DAY = 86_400_000;
const API = "http://localhost:54321";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*",
};

type Row = Record<string, string | boolean | null>;

/** 2500 eventos: uno cada 5 horas, desde 400 días antes del lunes de la prueba. */
function history(): Row[] {
  const from = MONDAY.getTime() - 400 * DAY;
  const rows: Row[] = Array.from({ length: 2500 }, (_, i) => {
    const start = from + i * 5 * 3_600_000;
    return {
      source: "google",
      external_id: `e${String(i).padStart(5, "0")}`,
      calendar_id: "c",
      title: `Evento ${i}`,
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 3_600_000).toISOString(),
      busy: true,
      all_day: false,
    };
  });
  const noon = MONDAY.getTime() + DAY + 6 * 3_600_000;
  rows.push({
    source: "google",
    external_id: "esta-semana",
    calendar_id: "c",
    title: "Reunión de esta semana",
    start_at: new Date(noon).toISOString(),
    end_at: new Date(noon + 3_600_000).toISOString(),
    busy: true,
    all_day: false,
  });
  return rows;
}

const FAR_FUTURE = 4_102_444_800; // 2100

async function signedIn(page: Page): Promise<void> {
  await page.addInitScript((expiresAt) => {
    localStorage.setItem(
      "sb-localhost-auth-token",
      JSON.stringify({
        access_token: "e2e-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: expiresAt,
        refresh_token: "e2e-refresh",
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          aud: "authenticated",
          email: "e2e@example.com",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    );
  }, FAR_FUTURE);
}

/** Una celda de la fila, por columna (sin claves calculadas). */
const cellOf = (row: Row, col: string) => new Map(Object.entries(row)).get(col);

/** Lo que pide la app a la tabla, ya filtrado y paginado como lo haría PostgREST. */
function answer(rows: Row[], url: URL): Row[] {
  const p = url.searchParams;
  let out = rows;
  for (const [key, value] of p.entries()) {
    const m = /^(lt|gt|gte)\.(.*)$/.exec(value);
    if (!m) continue;
    const [, op, v] = m;
    out = out.filter((r) => {
      const cell = String(cellOf(r, key));
      return op === "lt" ? cell < String(v) : op === "gt" ? cell > String(v) : cell >= String(v);
    });
  }
  const orders = p.getAll("order").map((o) => {
    const [col = "", dir] = o.split(".");
    return { col, sign: dir === "desc" ? -1 : 1 };
  });
  out = [...out].sort((a, b) => {
    for (const { col, sign } of orders) {
      const [x, y] = [String(cellOf(a, col)), String(cellOf(b, col))];
      if (x !== y) return (x < y ? -1 : 1) * sign;
    }
    return 0;
  });
  const offset = Number(p.get("offset") ?? 0);
  const limit = Math.min(Number(p.get("limit") ?? 1000), 1000);
  const cols = p.get("select");
  return out
    .slice(offset, offset + limit)
    .map((r) => (cols && cols !== "*" ? Object.fromEntries([[cols, cellOf(r, cols)]]) : r));
}

test("con más de 1000 registros: la semana actual aparece antes de que llegue el resto", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const events = history();
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let open = false;
  /** Semanas distintas pedidas por separado (un pedido de menos de 10 días). */
  const weeks = new Set<string>();
  let narrowAfterRelease = 0;
  const started = Date.now();
  /** Pedidos de «solo lo que cambió» a la tabla grande, y los que pidieron más de una página. */
  let changesOnly = 0;
  let pagedChanges = 0;

  await signedIn(page);
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const table = url.pathname.replace("/rest/v1/", "");
    // The server's clock, in the time of the page's fake clock (it starts on MONDAY).
    if (table === "rpc/server_now")
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: new Date(MONDAY.getTime() + (Date.now() - started)).toISOString(),
      });
    if (!url.pathname.startsWith("/rest/v1/")) return route.fulfill({ status: 404, headers: CORS });
    const asksOne = (await req.headerValue("accept"))?.includes("vnd.pgrst.object");
    if (asksOne)
      return route.fulfill({
        status: 406,
        headers: CORS,
        json: { code: "PGRST116", details: "0 rows", hint: null, message: "0 rows" },
      });
    const lt = url.searchParams.get("start_at")?.replace(/^lt\./, "");
    const gt = url.searchParams.get("end_at")?.replace(/^gt\./, "");
    const narrow = lt && gt && Date.parse(lt) - Date.parse(gt) < 10 * DAY;
    if (narrow && gt) {
      weeks.add(gt);
      if (!open) await held;
      else narrowAfterRelease++;
    }
    if (table === "calendar_events" && url.searchParams.get("updated_at")?.startsWith("gt.")) {
      changesOnly++;
      if (url.searchParams.has("offset")) pagedChanges++;
    }
    // Nada cambió en el servidor desde que se abrió: ni filas cambiadas ni lápidas.
    const changed = url.searchParams.get("updated_at")?.startsWith("gt.");
    const rows = table === "calendar_events" && !changed ? answer(events, url) : [];
    return route.fulfill({ status: 200, headers: CORS, json: rows });
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 200, json: { connected: false, error: "not_connected" } }),
  );

  await page.clock.install({ time: MONDAY });
  await page.goto("/");

  // The week is there, with this week's event, while the history is still held back.
  const week = page.getByTestId("week");
  await expect(week).toBeVisible();
  await expect(week.getByRole("button", { name: /^Reunión de esta semana/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cargando el historial" })).toBeVisible();
  // Two weeks at a time, no more.
  expect(weeks.size).toBeLessThanOrEqual(2);

  // An old week that has not come yet is grey, not an empty week that looks free.
  const previous = page.getByRole("button", { name: /Semana anterior/ });
  for (let i = 0; i < 20; i++) await previous.click();
  await expect(week).toHaveAttribute("aria-busy", "true");

  open = true;
  release();
  await expect(page.getByRole("button", { name: "Cargando el historial" })).toBeHidden({
    timeout: 90_000,
  });
  await expect(week).not.toHaveAttribute("aria-busy", "true");
  // Every week of the history was asked for, once each, and the weeks asked first were the
  // one in view and its neighbours.
  expect(narrowAfterRelease).toBeGreaterThan(40);
  expect(weeks.size).toBeGreaterThan(40);

  // Con todo cargado, volver a la app (otra sincronización) trae solo lo que cambió:
  // un pedido filtrado por updated_at, sin páginas de más, en vez de las 2500 filas.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => changesOnly).toBeGreaterThan(0);
  expect(pagedChanges).toBe(0);
  // Y la semana vieja que se mira sigue con sus eventos (la sincronización no los borró).
  await expect(week.getByRole("button", { name: /^Evento / }).first()).toBeVisible();
});
