import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { type BackupRoute, type BusRoute, replaceRoutes } from "./busRoutes.js";
import { applyWrites, diffData, loadData } from "./data.js";
import { demoData } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { dbClient } from "./testingDb.js";
import type { SavedPlan } from "./transit.js";

// SPEC §18 punto 20: lo que viaja en el respaldo, lo que se acepta de archivos viejos y lo que
// se dice cuando algo está mal.

const NOW = Date.UTC(2026, 10, 25, 13);
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.useRealTimers();
});

const plan: SavedPlan = {
  option: {
    leaveMin: 768,
    arriveMin: 810,
    totalMinutes: 42,
    walkMinutes: 12,
    waitMinutes: 4,
    rideMinutes: 26,
    transfers: 1,
    theoretical: true,
    legs: [],
  },
  dayType: 1,
  validTo: null,
};

const route = (from: string, to: string, weekday: number | null = 2): BackupRoute => ({
  from_place: from,
  to_place: to,
  weekday,
  time_minutes: 810,
  mode: "arrive",
  feed_version: "demo",
  plan,
});

const withRoutes = (routes: BackupRoute[]) => {
  const d = pruebasData(NOW);
  const [a, b] = [d.places?.at(0), d.places?.at(1)];
  if (!a || !b) throw new Error("the demo has no places");
  const saved: BusRoute[] = routes.map((r, i) => ({ ...r, id: `r-${i}` }));
  return { d, a, b, routes: saved, backup: routes };
};

function parsed(text: string, account?: string) {
  const r = parseBackup(text, account === undefined ? {} : { account });
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("qué viaja en el respaldo", () => {
  it("es de la versión 3, lleva las rutas sin su id y no lleva el historial del ↶", () => {
    const { d, a, b, routes } = withRoutes([route("casa", "fing"), route("casa", "fing", null)]);
    const text = exportJson(
      {
        ...d,
        planHistory: [{ at: NOW, label: "x", pins: [], today: [], overrides: [], proposals: [] }],
      },
      NOW,
      routes,
    );
    const file = JSON.parse(text);
    expect(file.version).toBe(3);
    expect(file.data.planHistory).toBeUndefined();
    expect(file.data.busRoutes).toHaveLength(2);
    expect(file.data.busRoutes.every((r: { id?: string }) => r.id === undefined)).toBe(true);
    expect([a.id, b.id]).toContain("casa");
    // Nada de conexiones, claves ni borradores en el archivo.
    expect(text).not.toMatch(/refresh_token|apple|gemini|widget_token|push|draft/i);
  });

  it("un archivo de antes (versión 2, sin rutas) se sigue aceptando y no toca las rutas", () => {
    const d = pruebasData(NOW);
    const old = JSON.stringify({ app: "critiCal", version: 2, exportedAt: NOW, data: d });
    const r = parsed(old);
    expect(r.data.busRoutes).toBeUndefined();
    expect(
      parseBackup(JSON.stringify({ app: "critiCal", version: 4, exportedAt: NOW, data: d })),
    ).toEqual({
      error: "El respaldo es de una versión más nueva.",
    });
  });

  it("al cargarlo en otra cuenta las rutas siguen a sus lugares nuevos", () => {
    const { d, routes } = withRoutes([route("casa", "fing")]);
    const r = parsed(exportJson({ ...d, owner: "otro" }, NOW, routes), ACCOUNT);
    const places = new Map((r.data.places ?? []).map((p) => [p.id, p.name]));
    const kept = r.data.busRoutes?.at(0);
    if (!kept) throw new Error("the route is gone");
    expect(places.get(kept.from_place)).toBe("Casa");
    expect(places.get(kept.to_place)).toBe("Facultad");
    expect(kept.plan).toEqual(plan);
  });

  it("una ruta mal armada, a un lugar que no está o repetida se deja afuera y se avisa", () => {
    const { d, routes } = withRoutes([
      route("casa", "fing"),
      route("casa", "fing"),
      route("casa", "nadie", 3),
      route("casa", "casa", 4),
      { ...route("casa", "fing", 5), time_minutes: 2000 },
    ]);
    const r = parsed(exportJson(d, NOW, routes));
    expect(r.data.busRoutes).toHaveLength(1);
    expect(r.dropped).toEqual(["rutas de ómnibus (3)"]);
  });
});

describe("mensajes al cargar un respaldo con datos que faltan", () => {
  const edited = (change: (...args: [ReturnType<typeof demoData>]) => unknown) => {
    const d = demoData(NOW);
    return parseBackup(
      JSON.stringify({ app: "critiCal", version: 3, exportedAt: NOW, data: change(d) }),
    );
  };

  it("un evento que termina antes de empezar dice cuál", () => {
    const r = edited((d) => ({
      ...d,
      events: d.events.map((e, i) =>
        i === 0 ? { ...e, title: "Clase de Cálculo", end: e.start - 60_000 } : e,
      ),
    }));
    expect(r).toEqual({ error: 'El evento "Clase de Cálculo" termina antes de empezar.' });
  });

  it("sin semana tipo dice que falta, y con otra cantidad de días dice cuántos", () => {
    expect(edited((d) => ({ ...d, settings: { ...d.settings, week: [] } }))).toEqual({
      error: "Falta tu semana tipo.",
    });
    expect(edited((d) => ({ ...d, settings: { ...d.settings, week: undefined } }))).toEqual({
      error: "Falta tu semana tipo.",
    });
    expect(
      edited((d) => ({ ...d, settings: { ...d.settings, week: d.settings.week.slice(0, 5) } })),
    ).toEqual({
      error: "Tu semana tipo tiene 5 días: tienen que ser los 7.",
    });
  });

  it("lo demás sigue diciendo lo de siempre", () => {
    expect(edited((d) => ({ ...d, tasks: [{ ...d.tasks[0], priority: 9 }] }))).toHaveProperty(
      "error",
    );
    expect(
      edited((d) => ({
        ...d,
        events: d.events.map((e, i) => (i === 0 ? { ...e, busy: "sí" } : e)),
      })),
    ).toEqual({ error: "Al respaldo le faltan datos." });
  });
});

describe("rutas de ómnibus en la base de la cuenta que carga", () => {
  const seed = async () => {
    const { d, backup } = withRoutes([route("casa", "fing"), route("casa", "fing", null)]);
    const db = dbClient(ACCOUNT);
    await applyWrites(db.client, diffData({ ...d, places: [], travelTimes: [] }, d));
    return { db, routes: backup };
  };

  it("espera a que estén los lugares y reintenta", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { d, backup: routes } = withRoutes([route("casa", "fing")]);
    const db = dbClient(ACCOUNT);
    // Los lugares se guardan en el segundo intento (el sync todavía no había escrito).
    let calls = 0;
    const flush = async () => {
      calls += 1;
      if (calls === 2) await applyWrites(db.client, diffData({ ...d, places: [] }, d));
    };
    const done = replaceRoutes(db.client, routes, flush);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await done).toBe(true);
    expect(calls).toBe(2);
    expect(db.rows("bus_routes")).toHaveLength(1);
  });

  it("reemplaza las de la cuenta: cargar lo mismo otra vez no choca ni duplica", async () => {
    const { db, routes } = await seed();
    const flush = () => Promise.resolve(true);
    expect(await replaceRoutes(db.client, routes, flush)).toBe(true);
    expect(await replaceRoutes(db.client, routes, flush)).toBe(true);
    expect(db.rows("bus_routes")).toHaveLength(2);
    // Un respaldo sin rutas las deja sin ninguna.
    expect(await replaceRoutes(db.client, [], flush)).toBe(true);
    expect(db.rows("bus_routes")).toHaveLength(0);
  });

  it("se rinde si los lugares no aparecen (no se queda esperando)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const db = dbClient(ACCOUNT);
    const done = replaceRoutes(db.client, [route("casa", "fing")], () => Promise.resolve(true));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toBe(false);
  });
});

describe("las comidas pasadas de una cuenta que carga un respaldo", () => {
  it("las que el respaldo no trae se borran de la base, no se mezclan con las nuevas", async () => {
    const d = pruebasData(NOW);
    const runs = d.mealRuns ?? [];
    const first = runs.at(0);
    if (!first) throw new Error("the demo has no meal runs");
    const next = { ...d, mealRuns: runs.slice(1) };
    const writes = diffData(d, next);
    expect(writes.deletes).toEqual([
      { table: "meal_runs", ids: [`${first.meal}|${first.weekday}|${first.from}`] },
    ]);
    const db = dbClient(ACCOUNT);
    await applyWrites(db.client, diffData({ ...d, mealRuns: [] }, d));
    expect(db.rows("meal_runs")).toHaveLength(runs.length);
    await applyWrites(db.client, writes);
    expect(db.rows("meal_runs")).toHaveLength(runs.length - 1);
    expect((await loadData(db.client)).mealRuns).toHaveLength(runs.length - 1);
    // Sin la lista (una copia que no la cargó) no se borra nada.
    expect(diffData(d, { ...d, mealRuns: undefined }).deletes).toEqual([]);
  });
});

describe("el orden de las listas al cargar en otra cuenta", () => {
  it("los ids nuevos van en el orden del archivo (la base devuelve por id)", () => {
    const d = pruebasData(NOW);
    const r = parsed(exportJson({ ...d, owner: "otro" }, NOW), ACCOUNT).data;
    // (The demo's routine shares its id with its materia: it takes the materia's new one.)
    const tasks = r.tasks.filter((t) => t.title !== "Gym");
    for (const list of [r.activities, tasks, r.places ?? []]) {
      const ids = list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort());
    }
    expect(r.activities.map((a) => a.name)).toEqual(d.activities.map((a) => a.name));
  });
});
