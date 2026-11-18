// biome-ignore-all lint/suspicious/noAssignInExpressions: each case edits one field of a copy
// biome-ignore-all lint/complexity/noCommaOperator: a case may edit two fields
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { Connected } from "./Connected.js";
import { Backup } from "./components/Backup.js";
import { Places } from "./components/Places.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { ESTIMATE_MINUTES_MAX } from "./limits.js";
import { type AppData, type AppTask, newId } from "./model.js";
import { clearLocal } from "./offline.js";
import { spotKey } from "./places.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import { syllabusTasks } from "./syllabus.js";
import { session, stubApi } from "./testing.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

const report = vi.fn();
vi.mock("./monitoring.js", async (original) => ({
  ...(await original<typeof import("./monitoring.js")>()),
  reportError: (e: unknown, context?: unknown) => report(e, context),
}));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  clearDrafts();
  vi.unstubAllGlobals();
  report.mockReset();
  await clearLocal();
});

const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
// biome-ignore lint/suspicious/noExplicitAny: edits a copy of the data to break it
type Loose = any;
const roundTrip = (d: AppData, opts?: { strictIds?: boolean }) =>
  parseBackup(exportJson(d, NOW), opts);
/** The demo, edited by `mutate`, as a backup file. */
const broken = (mutate: (d: Loose) => void, opts?: { strictIds?: boolean }) => {
  const d: Loose = plain(demoData(NOW));
  mutate(d);
  return parseBackup(
    JSON.stringify({ app: "critiCal", version: 2, exportedAt: NOW, data: d }),
    opts,
  );
};
const errorOf = (r: ReturnType<typeof parseBackup>) => ("error" in r ? r.error : "");
const GENERIC = "Al respaldo le faltan datos.";
const uuid = () => newId();

function Probe() {
  const { data } = useStore();
  return <output aria-label="dueño">{data.owner ?? "ninguno"}</output>;
}

function Poke() {
  const { dispatch } = useStore();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "saveActivity",
            activity: {
              id: uuid(),
              name: "MALA",
              color: "#FF8A00",
              academic: true,
              maxSessionMinutes: 120,
              minBlockMinutes: 60,
            },
          })
        }
      >
        mala
      </button>
      <button type="button" onClick={() => dispatch({ type: "newSubject", name: "Buena" })}>
        buena
      </button>
    </>
  );
}

describe("1. Estudio semanal de 0 a 168 h", () => {
  it.each([0.5, 1, 14, 15, 40, 100, 168])("%s h a la semana: ida y vuelta idéntica", (hours) => {
    const out = reducer(demoData(NOW), {
      type: "weeklyStudy",
      activityId: "calc",
      minutes: Math.round(hours * 60),
      now: NOW,
    });
    const back = roundTrip(out);
    expect(errorOf(back)).toBe("");
    expect("data" in back && back.data).toEqual(plain(out));
  });
});

describe("2. Texto largo y eventos grandes", () => {
  it("an event with a 400-character title and a 400-day span imports, title trimmed", () => {
    const d = demoData(NOW);
    const long: AppData = {
      ...d,
      events: [
        ...d.events,
        {
          id: "google:largo",
          title: "T".repeat(400),
          start: NOW,
          end: NOW + 400 * 86_400_000,
          busy: false,
          allDay: true,
          source: "google",
        },
      ],
    };
    const back = roundTrip(long);
    expect(errorOf(back)).toBe("");
    const data = (back as { data: AppData }).data;
    expect(data.events).toHaveLength(long.events.length);
    const ev = data.events.find((e) => e.id === "google:largo");
    expect(ev?.title).toHaveLength(300);
    expect(ev?.end).toBe(NOW + 400 * 86_400_000);
    // Everything else comes back as it was.
    expect(data.tasks).toEqual(plain(long.tasks));
  });

  it("saving an event address as a place keeps its alias short", () => {
    const text = "Calle ".repeat(100);
    const d: AppData = {
      ...demoData(NOW),
      spots: [{ key: spotKey(text), text, minutes: 10 }],
    };
    const out = reducer(d, {
      type: "saveSpot",
      key: spotKey(text),
      name: "N".repeat(200),
      now: NOW,
    });
    const place = out.places?.at(-1);
    expect(place?.aliases[0]?.length).toBeLessThanOrEqual(300);
    expect(place?.name.length).toBeLessThanOrEqual(60);
    expect(errorOf(roundTrip(out))).toBe("");
  });

  it("the place form bounds the alias and the spot name box has a limit", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
          <Places />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Agregar lugar"));
    fireEvent.change(screen.getByPlaceholderText("Facu"), { target: { value: "Gym" } });
    fireEvent.change(screen.getByPlaceholderText("FING, Facultad"), {
      target: { value: `corto, ${"a".repeat(400)}` },
    });
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByRole("alert").textContent).toMatch(/alias.*300/i);
  });
});

function openSettings(api: (name: string, body: Record<string, unknown>) => unknown) {
  const ok = Promise.resolve({ data: [], error: null });
  const client = {
    from: () => ({
      select: () =>
        Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    }),
    auth: session,
  } as never;
  stubApi(async (name, opts) => ({ data: api(name, opts.body), error: null }));
  render(
    <Connected client={client} session={{ user: { id: `t${Math.random()}` } } as never}>
      <Shell />
    </Connected>,
  );
}

describe("2b. El programa: nombres acotados", () => {
  it("limits the subject and assessment names, in the fields and when created", async () => {
    vi.useRealTimers();
    openSettings((name) =>
      name === "syllabus"
        ? {
            ok: true,
            syllabus: {
              subject: "M".repeat(120),
              units: [],
              assessments: [
                {
                  title: "E".repeat(120),
                  kind: "parcial",
                  date: `${new Date().getUTCFullYear() + 1}-09-20`,
                  hours: 4,
                  units: [],
                },
              ],
            },
          }
        : { connected: true },
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Ajustes"));
    const pdf = new File(["%PDF-1.4"], "programa.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf] } });
    });
    const subject = (await screen.findByLabelText("Nombre de la materia")) as HTMLInputElement;
    expect(subject.maxLength).toBe(60);
    expect((screen.getByLabelText("Nombre de a0") as HTMLInputElement).maxLength).toBe(80);
    await act(async () => fireEvent.click(screen.getByText("Crear")));
    expect(screen.getByText(`${"M".repeat(60)}: 1 evaluaciones agregadas ✓`)).toBeTruthy();
  });
});

describe("3. El respaldo rechaza lo que la base rechaza", () => {
  const cases: [string, (d: Loose) => void, RegExp][] = [
    ["maxActivitiesPerDay 51", (d) => (d.settings.maxActivitiesPerDay = 51), /materias por día/i],
    [
      "maxActivitiesPerDay decimal",
      (d) => (d.settings.maxActivitiesPerDay = 2.5),
      /materias por día/i,
    ],
    ["warnSlackMinutes 10081", (d) => (d.settings.warnSlackMinutes = 10_081), /aviso/i],
    ["timezone de 65 letras", (d) => (d.settings.timezone = "A".repeat(65)), /ajustes|zona/i],
    ["priority 5", (d) => (d.tasks[0].priority = 5), /prioridad/i],
    ["priority ausente", (d) => delete d.tasks[0].priority, /prioridad/i],
    ["status inventado", (d) => (d.tasks[0].status = "hecha"), /estado/i],
    ["kind de tarea inventado", (d) => (d.tasks[0].kind = "otra"), /tipo/i],
    ["estimateMinutes decimal", (d) => (d.tasks[0].estimateMinutes = 90.5), /enter/i],
    ["minMinutes decimal", (d) => (d.tasks[0].minMinutes = 10.5), /enter/i],
    ["sessionsPerWeek decimal", (d) => (d.tasks.at(-1).sessionsPerWeek = 2.5), /sesiones/i],
    ["sessionsPerWeek 169", (d) => (d.tasks.at(-1).sessionsPerWeek = 169), /sesiones/i],
    ["sessionMinutes decimal", (d) => (d.tasks.at(-1).sessionMinutes = 60.5), /sesión/i],
    ["maxPerDayMinutes 0", (d) => (d.tasks[0].maxPerDayMinutes = 0), /por día/i],
    ["título vacío", (d) => (d.tasks[0].title = ""), /título/i],
    ["sin título", (d) => delete d.tasks[0].title, /título/i],
    ["fecha de fin inválida", (d) => (d.tasks[0].endedAt = "ayer"), /fecha|endedAt|terminó/i],
    ["sourceRole inventado", (d) => (d.tasks[0].sourceRole = "x"), /origen|rol/i],
    ["peso de una parte 101", (d) => (d.tasks[0].units[0].weight = 101), /peso/i],
    ["parte con minutos decimales", (d) => (d.tasks[0].units[0].estimateMinutes = 30.5), /parte/i],
    ["kind de materia inventado", (d) => (d.activities[0].kind = "otra"), /tipo|materia/i],
    ["nombre de materia largo", (d) => (d.activities[0].name = "N".repeat(301)), /nombre.*300/i],
    ["nombre de materia vacío", (d) => (d.activities[0].name = "  "), /nombre/i],
    [
      "preferred con decimales",
      (d) => (d.activities[0].preferred = { start: 600.5, end: 700 }),
      /horario|preferid/i,
    ],
    ["maxSession decimal", (d) => (d.activities[0].maxSessionMinutes = 90.5), /sesión/i],
    ["studyMinutes decimal", (d) => (d.activities[0].studyMinutes = 50.5), /estudio|descanso/i],
    ["alias no texto", (d) => (d.activities[0].aliases = [1]), /alias/i],
    [
      "checkIn con minutos decimales",
      (d) =>
        d.checkIns.push({
          id: "c",
          blockId: "b",
          taskId: d.tasks[0].id,
          status: "done",
          minutesDone: 10.5,
          unitIds: [],
          createdAt: NOW,
        }),
      /registro|minutos/i,
    ],
    [
      "bloque con nivel inventado",
      (d) =>
        d.plan[0]
          ? (d.plan[0].level = "rojo")
          : d.plan.push({
              id: "b",
              taskId: d.tasks[0].id,
              activityId: "x",
              start: NOW,
              end: NOW + 3_600_000,
              level: "rojo",
            }),
      /nivel/i,
    ],
    [
      "lugar con id repetido",
      (d) =>
        (d.places = [
          { id: "p", name: "A", aliases: [] },
          { id: "p", name: "B", aliases: [] },
        ]),
      /lugares repetidos/i,
    ],
    [
      "traslado a un lugar que no está",
      (d) => (
        (d.places = [{ id: "p", name: "A", aliases: [] }]),
        (d.travelTimes = [{ from: "p", to: "q", minutes: 5, manual: false }])
      ),
      /traslado.*lugar/i,
    ],
    [
      "traslado repetido",
      (d) => (
        (d.places = [
          { id: "p", name: "A", aliases: [] },
          { id: "q", name: "B", aliases: [] },
        ]),
        (d.travelTimes = [
          { from: "p", to: "q", minutes: 5, manual: false },
          { from: "p", to: "q", minutes: 6, manual: true },
        ])
      ),
      /traslado.*repetido/i,
    ],
    [
      "día de ajuste repetido",
      (d) => (d.overrides = [{ date: "2026-12-01" }, { date: "2026-12-01", wake: 400 }]),
      /ajuste.*repetido|día.*repetido/i,
    ],
    [
      "parte compartida entre tareas",
      (d) => (d.tasks[1].units = [{ ...d.tasks[0].units[0] }]),
      /parte.*repetid|repetid.*parte/i,
    ],
  ];
  it.each(cases)("%s", (_name, mutate, message) => {
    const r = broken(mutate);
    expect("error" in r).toBe(true);
    expect(errorOf(r)).not.toBe(GENERIC);
    expect(errorOf(r)).toMatch(message);
  });

  it("ids that are not uuids are refused for an account, and fine in the demo", () => {
    const d = demoData(NOW);
    expect(errorOf(roundTrip(d))).toBe("");
    const r = roundTrip(d, { strictIds: true });
    expect(errorOf(r)).toMatch(/identificador|id/i);
    expect(errorOf(r)).not.toBe(GENERIC);
  });

  it("what the app creates with its own ids passes the strict check", () => {
    let d: AppData = { ...demoData(NOW), activities: [], tasks: [], plan: [], checkIns: [] };
    d = reducer(d, {
      type: "saveRoutine",
      name: "Gym",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      now: NOW,
    });
    expect(errorOf(roundTrip(d, { strictIds: true }))).toBe("");
  });

  it("a check-in whose unit is not a uuid is refused for an account", () => {
    const task = { ...(demoData(NOW).tasks[0] as AppTask), id: uuid(), activityId: uuid() };
    const d: AppData = {
      ...demoData(NOW),
      activities: [{ ...demoData(NOW).activities[0], id: task.activityId } as never],
      tasks: [{ ...task, units: [] }],
      plan: [],
      proposals: [],
      pins: [],
      checkIns: [
        {
          id: uuid(),
          blockId: "b",
          taskId: task.id,
          status: "done",
          minutesDone: 30,
          unitIds: ["u1"],
          createdAt: NOW,
        },
      ],
    };
    expect(errorOf(roundTrip(d, { strictIds: true }))).toMatch(/identificador|id/i);
  });
});

describe("3b. Un error permanente de la base no traba los guardados", () => {
  function clientRejecting() {
    const writes: { table: string; rows: Loose[] }[] = [];
    const ok = Promise.resolve({ data: [], error: null });
    const from = (table: string) => ({
      select: () =>
        Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      upsert: (rows: Loose[]) => {
        const bad = table === "activities" && rows.some((r) => r.name === "MALA");
        writes.push({ table, rows });
        return Promise.resolve({
          error: bad ? { code: "23514", message: "check constraint violated" } : null,
        });
      },
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    });
    stubApi(async () => ({ data: { connected: true }, error: null }));
    return { client: { from, auth: session } as never, writes };
  }

  it("reports it, tells the user and keeps saving what comes next", async () => {
    vi.useRealTimers();
    const { client, writes } = clientRejecting();
    render(
      <Connected client={client} session={{ user: { id: `t${Math.random()}` } } as never}>
        <Poke />
      </Connected>,
    );
    await screen.findByText("mala");
    await act(async () => fireEvent.click(screen.getByText("mala")));
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(report.mock.calls[0]?.[0]).toMatchObject({ code: "23514" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/no se pudo guardar/i);
    // The screen is not taken over, and the next save goes through.
    expect(screen.queryByText("Algo falló")).toBeNull();
    const before = writes.filter((w) => w.table === "activities").length;
    await act(async () => fireEvent.click(screen.getByText("buena")));
    await waitFor(() =>
      expect(
        writes
          .filter((w) => w.table === "activities")
          .slice(before)
          .some((w) => w.rows.some((r) => r.name === "Buena")),
      ).toBe(true),
    );
    // The bad row is not sent again with it.
    const last = writes.filter((w) => w.table === "activities").at(-1);
    expect(last?.rows.some((r) => r.name === "MALA")).toBe(false);
  });
});

describe("4. Datos sueltos del respaldo no rompen la app", () => {
  const bad: [string, (d: Loose) => void, RegExp][] = [
    ["calendars con id numérico", (d) => (d.calendars = [{ id: 1 }]), /calendario/i],
    [
      "calendars con rol inventado",
      (d) =>
        (d.calendars = [
          { id: "google:a", source: "google", externalId: "a", name: "A", role: "x" },
        ]),
      /calendario/i,
    ],
    ["applied sin tareas antes", (d) => (d.applied = [{ id: "a", before: "x" }]), /decisi/i],
    ["planHistory que no es lista", (d) => (d.planHistory = {}), /historial/i],
    ["planHistory con versión rota", (d) => (d.planHistory = [{ at: "x" }]), /historial/i],
    [
      "eventTravel con minutos de texto",
      (d) => (d.eventTravel = { e: { minutes: "5", key: "k" } }),
      /traslado/i,
    ],
    ["mealChoices rotas", (d) => (d.mealChoices = [{ date: "hoy", kind: "x" }]), /comida/i],
    ["movedEvents rotos", (d) => (d.movedEvents = [{ eventId: 1 }]), /movido/i],
    ["tentativeSeen roto", (d) => (d.tentativeSeen = ["x"]), /tentativ/i],
    ["noTravel con números", (d) => (d.noTravel = [1, 2]), /traslado|sin viaje/i],
    ["notSubjects con números", (d) => (d.notSubjects = [1]), /no son materia|clases/i],
    [
      "removedSubjects que no es lista",
      (d) => (d.removedSubjects = "x"),
      /materias.*borr|eliminad/i,
    ],
    ["freeTimeUntil de texto", (d) => (d.freeTimeUntil = "mañana"), /tiempo libre/i],
    ["evento con ubicación numérica", (d) => (d.events[0].location = 5), /evento/i],
  ];
  it.each(bad)("%s: se rechaza con mensaje", (_n, mutate, message) => {
    const r = broken(mutate);
    expect("error" in r).toBe(true);
    expect(errorOf(r)).not.toBe(GENERIC);
    expect(errorOf(r)).toMatch(message);
  });

  it("well-formed extras round-trip identical", () => {
    const d = demoData(NOW);
    const withExtras: AppData = {
      ...d,
      calendars: [
        { id: "google:a", source: "google", externalId: "a", name: "Parciales", role: "parcial" },
      ],
      applied: [{ id: "x", label: "Priorizar", at: NOW, before: [d.tasks[0] as AppTask] }],
      eventTravel: { "google:e": { minutes: 15, key: "casa" } },
      mealChoices: [{ date: "2026-11-18", kind: "cena", skip: true }],
      movedEvents: [
        { eventId: "google:e", from: NOW, start: NOW + 3_600_000, end: NOW + 7_200_000 },
      ],
      tentativeSeen: [{ id: "google:t", title: "Quizás", start: NOW, end: NOW + 3_600_000 }],
      noTravel: ["zoom"],
      planHistory: [
        { at: NOW, label: "Reorganizar", pins: [], today: [], overrides: [], proposals: [] },
      ],
    };
    const back = roundTrip(withExtras);
    expect(errorOf(back)).toBe("");
    expect("data" in back && back.data).toEqual(plain(withExtras));
  });
});

describe("5. Topes de horas coherentes", () => {
  it("the longest silo of the form fits the backup", () => {
    const d = demoData(NOW);
    const task: AppTask = {
      ...(d.tasks.find((t) => t.kind === "deliverable") as AppTask),
      units: [],
      estimateMinutes: ESTIMATE_MINUTES_MAX,
      minMinutes: ESTIMATE_MINUTES_MAX,
    };
    expect(errorOf(roundTrip({ ...d, tasks: [...d.tasks, { ...task, id: "gran" }] }))).toBe("");
  });

  it("an assessment of 40 units of 200 h is cut to what the backup takes", () => {
    const units = Array.from({ length: 40 }, (_, i) => ({ title: `U${i}`, minutes: 200 * 60 }));
    const { tasks, activity } = syllabusTasks({
      subject: "Física",
      activities: [],
      assessments: [{ title: "Examen", kind: "parcial", date: "2027-02-01", units, minutes: 0 }],
      timeZone: TIMEZONE,
      newId,
      color: "#FF8A00",
    });
    const task = tasks[0] as AppTask;
    expect(task.estimateMinutes).toBeLessThanOrEqual(ESTIMATE_MINUTES_MAX);
    expect(task.units.reduce((s, u) => s + u.estimateMinutes, 0)).toBeLessThanOrEqual(
      ESTIMATE_MINUTES_MAX,
    );
    expect(
      task.units.every((u) => Number.isInteger(u.estimateMinutes) && u.estimateMinutes >= 1),
    ).toBe(true);
    const d: AppData = {
      ...demoData(NOW),
      activities: [activity],
      tasks: [task],
      plan: [],
      checkIns: [],
      proposals: [],
      pins: [],
    };
    expect(errorOf(roundTrip(d))).toBe("");
  });
});

describe("6. El dueño del respaldo pasa a ser la cuenta actual", () => {
  it("importing another account's file keeps this account as the owner", async () => {
    vi.useRealTimers();
    // With an account the ids are uuids.
    const ids = new Map<string, string>();
    const demo = demoData(NOW);
    for (const id of [...demo.activities, ...demo.tasks, ...demo.tasks.flatMap((t) => t.units)].map(
      (x) => x.id,
    ))
      ids.set(id, uuid());
    const withUuids = (d: AppData): AppData => {
      let json = JSON.stringify(d);
      for (const [from, to] of ids) json = json.split(`"${from}"`).join(`"${to}"`);
      return JSON.parse(json);
    };
    const mine = (): AppData => ({ ...withUuids(demo), owner: "yo" });
    render(
      <ToastProvider>
        <StoreProvider initial={mine} persist={false} fixedNow={NOW}>
          <Backup />
          <Probe />
        </StoreProvider>
      </ToastProvider>,
    );
    const file = new File(
      [exportJson({ ...withUuids(demo), owner: "otra-cuenta" }, NOW)],
      "respaldo.json",
      { type: "application/json" },
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Archivo de respaldo"), { target: { files: [file] } });
    });
    await screen.findByText("Datos importados");
    expect(screen.getByLabelText("dueño").textContent).toBe("yo");
  });
});

describe("7. Mensajes que dicen qué falla", () => {
  it("names the silo with an empty title, the decimals and the long names", () => {
    expect(errorOf(broken((d) => (d.tasks[0].title = "")))).toContain("tiene el título vacío");
    expect(
      errorOf(broken((d) => (d.activities[0].preferred = { start: 600.5, end: 700 }))),
    ).toMatch(/minutos enteros/i);
    expect(errorOf(broken((d) => (d.activities[0].name = "N".repeat(301))))).toContain("300");
    expect(errorOf(broken((d) => (d.settings.slotMinutes = 20)))).toMatch(/ajustes/i);
    expect(errorOf(broken((d) => (d.tasks.at(-1).sessionsPerWeek = 500)))).toMatch(/sesiones/i);
  });
});
