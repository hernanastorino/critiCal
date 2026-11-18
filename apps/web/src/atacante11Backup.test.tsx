import { describe, expect, it } from "vitest";
import { type Edit, edited, errorOf, GENERIC, NOW, plain, roundTrip } from "./atacante11Kit.js";
import { demoData } from "./demo.js";
import { type AppData, newId } from "./model.js";
import { reducer } from "./store.js";

const TASK = "parcial-calc";
const places = (...ids: string[]) => ids.map((id) => ({ id, name: id, aliases: [] }));

describe("3. El respaldo rechaza lo que la base rechaza", () => {
  const cases: [string, Edit[], RegExp][] = [
    ["maxActivitiesPerDay 51", [["settings.maxActivitiesPerDay", 51]], /materias por día/i],
    ["maxActivitiesPerDay decimal", [["settings.maxActivitiesPerDay", 2.5]], /materias por día/i],
    ["warnSlackMinutes 10081", [["settings.warnSlackMinutes", 10_081]], /aviso/i],
    ["timezone de 65 letras", [["settings.timezone", "A".repeat(65)]], /ajustes|zona/i],
    ["priority 5", [["tasks.0.priority", 5]], /prioridad/i],
    ["priority ausente", [["tasks.0.priority", undefined]], /prioridad/i],
    ["status inventado", [["tasks.0.status", "hecha"]], /estado/i],
    ["kind de tarea inventado", [["tasks.0.kind", "otra"]], /tipo/i],
    ["estimateMinutes decimal", [["tasks.0.estimateMinutes", 90.5]], /enter/i],
    ["minMinutes decimal", [["tasks.0.minMinutes", 10.5]], /enter/i],
    ["sessionsPerWeek decimal", [["tasks.last.sessionsPerWeek", 2.5]], /sesiones/i],
    ["sessionsPerWeek 169", [["tasks.last.sessionsPerWeek", 169]], /sesiones/i],
    ["sessionMinutes decimal", [["tasks.last.sessionMinutes", 60.5]], /sesión/i],
    ["maxPerDayMinutes 0", [["tasks.0.maxPerDayMinutes", 0]], /por día/i],
    ["título vacío", [["tasks.0.title", ""]], /título/i],
    ["sin título", [["tasks.0.title", undefined]], /título/i],
    ["fecha de fin inválida", [["tasks.0.endedAt", "ayer"]], /fecha/i],
    ["sourceRole inventado", [["tasks.0.sourceRole", "x"]], /origen/i],
    ["peso de una parte 101", [["tasks.0.units.0.weight", 101]], /peso/i],
    ["parte con minutos decimales", [["tasks.0.units.0.estimateMinutes", 30.5]], /parte/i],
    ["kind de materia inventado", [["activities.0.kind", "otra"]], /tipo/i],
    ["nombre de materia largo", [["activities.0.name", "N".repeat(301)]], /nombre.*300/i],
    ["nombre de materia vacío", [["activities.0.name", "  "]], /nombre/i],
    [
      "preferred con decimales",
      [["activities.0.preferred", { start: 600.5, end: 700 }]],
      /horario/i,
    ],
    ["maxSession decimal", [["activities.0.maxSessionMinutes", 90.5]], /sesión/i],
    ["studyMinutes decimal", [["activities.0.studyMinutes", 50.5]], /estudio/i],
    ["alias no texto", [["activities.0.aliases", [1]]], /alias/i],
    [
      "registro con minutos decimales",
      [
        [
          "checkIns",
          [
            {
              id: "c",
              blockId: "b",
              taskId: TASK,
              status: "done",
              minutesDone: 10.5,
              unitIds: [],
              createdAt: NOW,
            },
          ],
        ],
      ],
      /registro/i,
    ],
    [
      "bloque con nivel inventado",
      [
        [
          "plan",
          [
            {
              id: "b",
              taskId: TASK,
              activityId: "x",
              start: NOW,
              end: NOW + 3_600_000,
              level: "rojo",
            },
          ],
        ],
      ],
      /nivel/i,
    ],
    ["lugar con id repetido", [["places", places("p", "p")]], /lugares repetidos/i],
    [
      "traslado a un lugar que no está",
      [
        ["places", places("p")],
        ["travelTimes", [{ from: "p", to: "q", minutes: 5, manual: false }]],
      ],
      /traslado.*lugar/i,
    ],
    [
      "traslado repetido",
      [
        ["places", places("p", "q")],
        [
          "travelTimes",
          [
            { from: "p", to: "q", minutes: 5, manual: false },
            { from: "p", to: "q", minutes: 6, manual: true },
          ],
        ],
      ],
      /traslado.*repetido/i,
    ],
    [
      "día de ajuste repetido",
      [["overrides", [{ date: "2026-12-01" }, { date: "2026-12-01", wake: 400 }]]],
      /día.*repetido/i,
    ],
    [
      "parte compartida entre tareas",
      [["tasks.1.units", [{ id: "u1", title: "x", estimateMinutes: 60 }]]],
      /parte.*repetid/i,
    ],
  ];
  it.each(cases)("%s", (_name, edits, message) => {
    const r = edited(edits);
    expect(r).toHaveProperty("error");
    expect(errorOf(r)).not.toBe(GENERIC);
    expect(errorOf(r)).toMatch(message);
  });

  it("ids that are not uuids are refused for an account, and fine in the demo", () => {
    const d = demoData(NOW);
    expect(errorOf(roundTrip(d))).toBe("");
    const r = roundTrip(d, { strictIds: true });
    expect(errorOf(r)).toMatch(/identificador/i);
    expect(errorOf(r)).not.toBe(GENERIC);
  });

  it("what the app creates with its own ids passes the strict check", () => {
    const start: AppData = { ...demoData(NOW), activities: [], tasks: [], plan: [], checkIns: [] };
    const d = reducer(start, {
      type: "saveRoutine",
      name: "Gym",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      now: NOW,
    });
    expect(errorOf(roundTrip(d, { strictIds: true }))).toBe("");
  });

  it("a check-in whose unit is not a uuid is refused for an account", () => {
    const activity = demoData(NOW).activities.at(0);
    const task = demoData(NOW).tasks.at(0);
    if (!activity || !task) throw new Error("the demo has no data");
    const [activityId, taskId] = [newId(), newId()];
    const checkIn = {
      id: newId(),
      blockId: "b",
      taskId,
      status: "done" as const,
      minutesDone: 30,
      unitIds: ["u1"],
      createdAt: NOW,
    };
    const d: AppData = {
      ...demoData(NOW),
      activities: [{ ...activity, id: activityId }],
      tasks: [{ ...task, id: taskId, activityId, units: [] }],
      plan: [],
      proposals: [],
      pins: [],
      checkIns: [checkIn],
    };
    expect(errorOf(roundTrip(d, { strictIds: true }))).toMatch(/identificador/i);
  });
});

describe("4. Datos sueltos del respaldo no rompen la app", () => {
  const calendar = { id: "google:a", source: "google", externalId: "a", name: "A" };
  const bad: [string, Edit[], RegExp][] = [
    ["calendars con id numérico", [["calendars", [{ id: 1 }]]], /calendario/i],
    ["calendars con rol inventado", [["calendars", [{ ...calendar, role: "x" }]]], /calendario/i],
    ["applied sin tareas antes", [["applied", [{ id: "a", before: "x" }]]], /decisi/i],
    ["planHistory que no es lista", [["planHistory", {}]], /historial/i],
    ["planHistory con versión rota", [["planHistory", [{ at: "x" }]]], /historial/i],
    [
      "eventTravel con minutos de texto",
      [["eventTravel", { e: { minutes: "5", key: "k" } }]],
      /traslado/i,
    ],
    ["mealChoices rotas", [["mealChoices", [{ date: "hoy", kind: "x" }]]], /comida/i],
    ["movedEvents rotos", [["movedEvents", [{ eventId: 1 }]]], /movido/i],
    ["tentativeSeen roto", [["tentativeSeen", ["x"]]], /tentativ/i],
    ["noTravel con números", [["noTravel", [1, 2]]], /traslado/i],
    ["notSubjects con números", [["notSubjects", [1]]], /clases/i],
    ["removedSubjects que no es lista", [["removedSubjects", "x"]], /eliminadas/i],
    ["freeTimeUntil de texto", [["freeTimeUntil", "mañana"]], /tiempo libre/i],
    ["evento con ubicación numérica", [["events.0.location", 5]], /evento/i],
  ];
  it.each(bad)("%s: se rechaza con mensaje", (_name, edits, message) => {
    const r = edited(edits);
    expect(r).toHaveProperty("error");
    expect(errorOf(r)).not.toBe(GENERIC);
    expect(errorOf(r)).toMatch(message);
  });

  it("well-formed extras round-trip identical", () => {
    const d = demoData(NOW);
    const task = d.tasks.at(0);
    if (!task) throw new Error("the demo has no tasks");
    const withExtras: AppData = {
      ...d,
      calendars: [
        { id: "google:a", source: "google", externalId: "a", name: "Parciales", role: "parcial" },
      ],
      applied: [{ id: "x", label: "Priorizar", at: NOW, before: [task] }],
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

describe("7. Mensajes que dicen qué falla", () => {
  it("names the silo with an empty title, the decimals, the long names and the settings", () => {
    expect(errorOf(edited([["tasks.0.title", ""]]))).toContain("tiene el título vacío");
    expect(errorOf(edited([["activities.0.preferred", { start: 600.5, end: 700 }]]))).toMatch(
      /minutos enteros/i,
    );
    expect(errorOf(edited([["activities.0.name", "N".repeat(301)]]))).toContain("300");
    expect(errorOf(edited([["settings.slotMinutes", 20]]))).toMatch(/ajustes/i);
    expect(errorOf(edited([["tasks.last.sessionsPerWeek", 500]]))).toMatch(/sesiones/i);
  });
});
