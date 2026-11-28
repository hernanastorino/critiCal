import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { saveEvents } from "./backupSave.js";
import { type BusRoute, routeRow } from "./busRoutes.js";
import { Connected } from "./Connected.js";
import { applyWrites, diffData, loadData } from "./data.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { demoPlan } from "./demoTransit.js";
import { zonedInstant } from "./engine.js";
import { forgetImport } from "./importUndo.js";
import type { AppData, AppEvent } from "./model.js";
import { clearLocal } from "./offline.js";
import { refresh } from "./refresh.js";
import { dbClient, type Row } from "./testingDb.js";
import { dayTypeOf, type PlanOk } from "./transit.js";

// Una cuenta A completa se baja como respaldo y se carga en una cuenta B vacía: todas las
// pantallas dicen lo mismo, los datos son los mismos y sincronizar el calendario después no
// duplica nada (SPEC §18 punto 20). Contra una base que guarda lo que se le escribe.

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DAY = 86_400_000;
const FIXED = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

/** The events of the demo as a Google calendar's: `google:work|id`, the way the sync keys them. */
function asGoogle(d: AppData): AppData {
  let text = JSON.stringify(d);
  for (const e of d.events) text = text.split(`"${e.id}"`).join(`"google:work|${e.id}"`);
  const g: AppData = JSON.parse(text);
  const events: AppEvent[] = g.events.map((e) => ({
    ...e,
    source: "google",
    calendarId: "google:work",
  }));
  events.push({
    id: "icloud:https://caldav.icloud.com/p/|uid-1|",
    title: "Cumple de Fran",
    start: zonedInstant(TIMEZONE, "2026-11-27", 21 * 60),
    end: zonedInstant(TIMEZONE, "2026-11-27", 23 * 60),
    busy: false,
    source: "icloud",
    calendarId: "icloud:https://caldav.icloud.com/p/",
  });
  return {
    ...g,
    events,
    calendars: [
      { id: "google:work", source: "google", externalId: "work", name: "Trabajo", role: "busy" },
      {
        id: "icloud:https://caldav.icloud.com/p/",
        source: "icloud",
        externalId: "https://caldav.icloud.com/p/",
        name: "Personal",
      },
    ],
  };
}

/** Everything an account can have, made through the real parts (a backup of the demo for the ids). */
function accountA(now: number): { data: AppData; routes: Omit<BusRoute, "id">[] } {
  const base = asGoogle(pruebasData(now));
  const task = base.tasks.find((t) => t.id === "parcial-calc");
  const trip = base.events.find((e) => e.title === "Clase en la Facultad");
  if (!task || !trip) throw new Error("the demo changed");
  const day = (n: number) => new Date(now + n * DAY).toISOString().slice(0, 10);
  const full: AppData = {
    ...base,
    owner: A_ID,
    settings: {
      ...base.settings,
      travelMarginMinutes: 12,
      maxActivitiesPerDay: 3,
      warnSlackMinutes: 180,
      week: base.settings.week.map((w, i) => (i === 2 ? { ...w, wake: 7 * 60 + 30 } : w)),
    },
    // Routines that have been running for weeks (the database stamps a date on its own).
    tasks: base.tasks.map((t) => (t.kind === "habit" ? { ...t, createdAt: now - 60 * DAY } : t)),
    checkIns: [
      {
        id: "done-1",
        blockId: `${task.id}@${now - 2 * DAY}`,
        taskId: task.id,
        status: "done",
        minutesDone: 60,
        unitIds: task.units.slice(0, 1).map((u) => u.id),
        createdAt: now - 2 * DAY,
      },
    ],
    applied: [{ id: "dec-1", label: "Priorizar por peso", at: now - DAY, before: [task] }],
    tripModes: { [trip.id]: "bus" },
    tripMinutes: { [trip.id]: { minutes: 42, start: trip.start, back: 48 } },
    mealChoices: [
      { date: day(1), kind: "cena", start: 21 * 60 },
      { date: day(2), kind: "almuerzo", skip: true },
    ],
    noTravel: ["zoom"],
    notSubjects: ["charla"],
    relaxContextUntil: now + DAY,
    preferences: {
      ...base.preferences,
      holidaysOff: false,
      notifications: { critical: false, proposals: true, sunday: true, sundayAt: 19 * 60 },
      importDefaults: { parcial: { estimate: 600, min: 300, priority: 3 } },
    },
  };
  // As an account has it: ids that are uuids, owned, planned.
  const file = parseBackup(exportJson(full, now), { account: A_ID });
  if ("error" in file) throw new Error(file.error);
  const data = refresh({ ...file.data, busRoutes: undefined }, now);
  const place = (name: string) => data.places?.find((p) => p.name === name);
  const [home, fing] = [place("Casa"), place("Facultad")];
  if (!home || !fing) throw new Error("the demo has no places");
  const answer = demoPlan({
    action: "plan",
    from: { lat: home.lat ?? 0, lon: home.lon ?? 0 },
    to: { lat: fing.lat ?? 0, lon: fing.lon ?? 0 },
    date: day(1),
    time: "13:30",
    mode: "arrive",
  }) as PlanOk;
  const option = answer.options.at(0);
  if (!option) throw new Error("no plan");
  const slot = (weekday: number | null) => ({
    from_place: home.id,
    to_place: fing.id,
    weekday,
    time_minutes: 13 * 60 + 30,
    mode: "arrive" as const,
  });
  return {
    data,
    routes: [slot(2), slot(null), { ...slot(4), mode: "depart" as const }].map((s) =>
      routeRow(s, option, answer, dayTypeOf(day(1))),
    ),
  };
}

/** A database holding the account (what the sync wrote over its life). */
async function seeded(data: AppData, routes: Omit<BusRoute, "id">[], userId: string) {
  const db = dbClient(userId);
  await applyWrites(db.client, diffData(emptyData(), data));
  await saveEvents(db.client, data.events);
  if (routes.length) await db.client.from("bus_routes").insert(routes);
  return db;
}

/** What a screen says: its text and what its fields hold (the text alone leaves the values out). */
function textOf(el: Element | null): string {
  const words = (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const fields = [...(el?.querySelectorAll("input, select, textarea") ?? [])].map((f) =>
    f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")
      ? String(f.checked)
      : (f as HTMLInputElement).value,
  );
  // The blocks and events of the week are read by their labels, not by their text.
  const labels = [...(el?.querySelectorAll("[aria-label]") ?? [])].map((x) =>
    x.getAttribute("aria-label"),
  );
  return `${words} ‹${fields.join("|")}› ${labels.join(";")}`;
}

async function weekReady() {
  await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy(), { timeout: 20_000 });
  await waitFor(() => expect(screen.queryByLabelText("Cargando el historial")).toBeNull());
}

const press = (name: string, scope: HTMLElement = document.body) => {
  const found = within(scope)
    .getAllByRole("button")
    .find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").startsWith(name));
  if (!found) throw new Error(`no button «${name}»`);
  fireEvent.click(found);
};

const PAGES = [
  "Mi semana",
  "Materias",
  "Rutinas",
  "Reglas",
  "Horas para lo detectado",
  "Lugares y traslados",
  "Calendarios",
  "Notificaciones",
];

const settingsList = (dialog: HTMLElement): HTMLElement => {
  const list = dialog.querySelector<HTMLElement>(".settings-list");
  if (!list) throw new Error("no list of settings");
  return list;
};

/** What every screen says, by name: the tabs and each page of Ajustes. */
async function screens(): Promise<Map<string, string>> {
  const said = new Map<string, string>();
  const nav = screen.getByRole("navigation", { name: "Secciones" });
  for (const tab of ["Silos", "Bandeja", "Semana"]) {
    press(tab, nav);
    await waitFor(() =>
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain(tab),
    );
    said.set(tab, textOf(document.querySelector("main.main")));
  }
  press("Ajustes");
  const dialog = await screen.findByRole("dialog", { name: "Ajustes" });
  const list = dialog.querySelector<HTMLElement>(".settings-list");
  if (!list) throw new Error("no list of settings");
  said.set("Ajustes", textOf(list));
  for (const page of PAGES) {
    press(page, list);
    await waitFor(() =>
      expect(dialog.querySelector(".settings-page:not([hidden]) h2")).toBeTruthy(),
    );
    said.set(page, textOf(dialog.querySelector(".settings-page:not([hidden])")));
    const back = dialog.querySelector(".settings-page:not([hidden]) .settings-back");
    if (!back) throw new Error("no way back");
    fireEvent.click(back);
  }
  fireEvent.click(within(dialog).getByLabelText("Cerrar"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ajustes" })).toBeNull());
  return said;
}

/** Ajustes › Respaldo › «Descargar respaldo»: the file that would be saved, as text. */
async function download(): Promise<{ text: string; name: string }> {
  let blob: Blob | null = null;
  let name = "";
  const made = URL.createObjectURL;
  const revoked = URL.revokeObjectURL;
  URL.createObjectURL = (b: Blob) => {
    blob = b;
    return "blob:respaldo";
  };
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    name = this.download;
  });
  press("Ajustes");
  const dialog = await screen.findByRole("dialog", { name: "Ajustes" });
  press("Respaldo", settingsList(dialog));
  press("Descargar respaldo", dialog);
  click.mockRestore();
  URL.createObjectURL = made;
  URL.revokeObjectURL = revoked;
  if (!blob) throw new Error("nothing was saved");
  fireEvent.click(within(dialog).getByLabelText("Cerrar"));
  return { text: await (blob as Blob).text(), name };
}

/** Ajustes › Respaldo › «Cargar un respaldo» with the file. */
async function load(text: string) {
  press("Ajustes");
  const dialog = await screen.findByRole("dialog", { name: "Ajustes" });
  press("Respaldo", settingsList(dialog));
  const file = new File([text], "critical-respaldo.json", { type: "application/json" });
  await act(async () => {
    fireEvent.change(within(dialog).getByLabelText("Archivo de respaldo"), {
      target: { files: [file] },
    });
  });
  await waitFor(() => expect(document.body.textContent).toContain("Importé"), { timeout: 20_000 });
  fireEvent.click(within(dialog).getByLabelText("Cerrar"));
}

function open(db: ReturnType<typeof dbClient>, userId: string) {
  return render(
    <Connected client={db.client} session={{ user: { id: userId } } as never}>
      <Shell />
    </Connected>,
  );
}

/** The data with names where the ids were, and the lists in a fixed order: the same account reads the same. */
function canon(d: AppData, routes: readonly Row[]): unknown {
  const names = new Map<string, string>();
  for (const a of d.activities) names.set(a.id, `materia:${a.name}`);
  for (const t of d.tasks) {
    names.set(t.id, `tarea:${t.title}`);
    for (const u of t.units) names.set(u.id, `parte:${t.title}/${u.title}`);
  }
  for (const p of d.places ?? []) names.set(p.id, `lugar:${p.name}`);
  for (const c of d.checkIns) {
    const title = d.tasks.find((t) => t.id === c.taskId)?.title;
    names.set(c.id, `registro:${title}@${c.createdAt}`);
  }
  const swap = (s: string) => [...names].reduce((r, [id, name]) => r.split(id).join(name), s);
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return swap(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      return Object.fromEntries(Object.entries(x).map(([k, v]) => [swap(k), walk(v)]));
    }
    return x;
  };
  const { owner: _owner, ...rest } = d;
  const lists = new Map(
    Object.entries(walk(rest) as Record<string, unknown>).map(([k, v]) => [
      k,
      Array.isArray(v) && k !== "week" ? v.map((e) => JSON.stringify(e)).sort() : v,
    ]),
  );
  const saved = routes.map((r) =>
    JSON.stringify(
      walk({
        from: r.from_place,
        to: r.to_place,
        weekday: r.weekday,
        time: r.time_minutes,
        mode: r.mode,
        feed: r.feed_version,
        theoretical: r.theoretical,
        plan: r.plan,
      }),
    ),
  );
  return { ...Object.fromEntries(lists), routes: saved.sort() };
}

async function read(db: ReturnType<typeof dbClient>) {
  return canon(await loadData(db.client), db.rows("bus_routes"));
}

describe.each([
  ["fecha fija", FIXED],
  ["fecha real", Date.now()],
])("respaldo completo: de una cuenta a otra (%s)", (_name, now) => {
  const account = () => accountA(now);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });

  it("la cuenta B vacía queda como la A: pantallas, datos y rutas", async () => {
    const a = account();
    const dbA = await seeded(a.data, a.routes, A_ID);
    // A: sus pantallas y su respaldo.
    open(dbA, A_ID);
    await weekReady();
    const screensA = await screens();
    const file = await download();
    cleanup();
    expect(file.name).toBe(`critical-respaldo-${new Date(now).toISOString().slice(0, 10)}.json`);
    const parsed = JSON.parse(file.text);
    expect(parsed.version).toBe(3);
    expect(parsed.data.busRoutes).toHaveLength(3);
    expect(parsed.data.planHistory).toBeUndefined();

    // B: una cuenta vacía carga el archivo.
    await clearLocal();
    const dbB = dbClient(B_ID);
    open(dbB, B_ID);
    await weekReady();
    await load(file.text);
    await waitFor(() => expect(dbB.rows("bus_routes")).toHaveLength(3), { timeout: 20_000 });
    await waitFor(() => expect(dbB.rows("plan_blocks").length).toBeGreaterThan(0));
    await waitFor(() => expect(dbB.rows("calendar_events")).toHaveLength(a.data.events.length));
    const screensB = await screens();
    cleanup();
    // Recién cargado, el ↶ de la cabecera ofrece deshacer la carga (lo único que cambia).
    const undo = "Deshacer: cargar un respaldo;";
    expect(screensB.get("Semana")).toContain(undo);
    for (const [name, said] of screensB) screensB.set(name, said.replace(undo, ""));

    // Lo que quedó en la base de B es lo de A, con otros ids.
    expect(await read(dbB)).toEqual(await read(dbA));
    expect(dbB.rows("places").every((p) => p.user_id === B_ID)).toBe(true);
    const idsA = new Set(dbA.rows("places").map((p) => p.id));
    expect(dbB.rows("places").some((p) => idsA.has(p.id))).toBe(false);
    // Las rutas apuntan a los lugares nuevos.
    const placesB = new Set(dbB.rows("places").map((p) => p.id));
    expect(
      dbB.rows("bus_routes").every((r) => placesB.has(r.from_place) && placesB.has(r.to_place)),
    ).toBe(true);

    // Las pantallas, una por una (y no están vacías: dicen lo de la cuenta).
    expect(screensA.get("Silos")).toContain("Parcial Cálculo II");
    expect(screensA.get("Lugares y traslados")).toContain("Facultad");
    expect(screensA.get("Lugares y traslados")).toContain("Rutas de ómnibus 3");
    expect(screensA.get("Calendarios")).toContain("Trabajo");
    expect(screensA.get("Reglas")).toContain("‹3|12|3›");
    expect(screensA.get("Mi semana")).toContain("07:30");
    expect(screensA.get("Semana")).toContain("Cálculo II");

    for (const [name, said] of screensA) expect([name, screensB.get(name)]).toEqual([name, said]);
    expect(screensB.size).toBe(screensA.size);

    // Abrir B de cero (otro aparato, el ↶ de la carga vive solo en memoria) muestra lo mismo.
    forgetImport();
    await clearLocal();
    open(dbB, B_ID);
    await weekReady();
    const again = await screens();
    for (const [name, said] of screensA) expect([name, again.get(name)]).toEqual([name, said]);
  }, 120_000);
});
