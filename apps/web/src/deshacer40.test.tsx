import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY, pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { clipName } from "./format.js";
import type { AppData, AppTask } from "./model.js";
import { decisions, pendingConfirmations, refreshPlan, standingCheckIns } from "./planning.js";
import { type Action, loadDemo, reducer, seedHistory } from "./store.js";

// 40.ª vuelta: la pila del ↶ (SPEC §14). Domingo 22/11, 10:00, Demo de pruebas.
const NOW = zonedInstant(TIMEZONE, "2026-11-22", 10 * 60);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
});
afterEach(cleanup);

const demo = (): AppData => reducer(loadDemo(NOW), { type: "refresh", now: NOW });
/** The demo once the «No llegás a todo» card asks for time: «No hacer» de Informe corto SD. */
const tight = (): AppData =>
  reducer(demo(), { type: "applyOption", optionId: "drop:entrega-corta", now: NOW });
const must = <T,>(v: T | undefined): T => {
  if (v === undefined) throw new Error("missing");
  return v;
};
const undo = (d: AppData) => reducer(d, { type: "undoPlan", now: NOW });
const asked = (d: AppData) => {
  const r = refreshPlan(d, NOW);
  return decisions(r.input, r.result, { data: d, now: NOW });
};
/** A part as it is shown: none and empty are the same. */
const shown = (d: AppData, k: string) => {
  // The log only grows: what counts is the answer that stands for each block.
  const v = k === "checkIns" ? standingCheckIns(d) : Reflect.get(d, k);
  if (!Array.isArray(v)) return JSON.stringify(v);
  // A deleted materia comes back with its silos at the end of the list: same entries, any order.
  return v.length === 0 ? undefined : JSON.stringify(v.map((e) => JSON.stringify(e)).sort());
};
/** The parts of the data that differ (the history itself aside). */
const differing = (a: AppData, b: AppData) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => k !== "planHistory" && shown(a, k) !== shown(b, k),
  );

describe("Falla 1: ↶ deshace solo lo último", () => {
  it("«Usar tiempo libre» después de un avance: ↶ saca el tiempo libre y deja el avance", {
    timeout: 60_000,
  }, () => {
    const start = tight();
    const logged = reducer(start, {
      type: "logProgress",
      taskId: "entrega-sd",
      minutes: 60,
      now: NOW,
    });
    expect(logged.planHistory?.at(-1)?.label).toBe("registrar avance");
    const free = must(asked(logged).options.find((o) => o.kind === "use-free-time"));
    const chosen = reducer(logged, { type: "applyOption", optionId: free.id, now: NOW });
    expect(chosen.planHistory).toHaveLength((logged.planHistory?.length ?? 0) + 1);
    expect(chosen.planHistory?.at(-1)?.label).toBe(
      clipName(chosen.applied?.at(-1)?.label ?? "", 40),
    );

    const first = undo(chosen);
    // Only the decision goes: the log and the plan are as they were right after it.
    expect(first.applied ?? []).toEqual(logged.applied ?? []);
    expect(first.freeTimeUntil).toBe(logged.freeTimeUntil);
    expect(first.planHistory?.at(-1)?.label).toBe("registrar avance");
    expect(JSON.stringify(first.plan)).toBe(JSON.stringify(logged.plan));
    expect(standingCheckIns(first)).toEqual(standingCheckIns(logged));
    expect(first.tasks).toEqual(logged.tasks);
    // The Bandeja offers it again, and does not list it among the decisions taken.
    expect(asked(first).options.some((o) => o.kind === "use-free-time")).toBe(true);

    const second = undo(first);
    expect(second.tasks).toEqual(start.tasks);
    expect(standingCheckIns(second)).toEqual(standingCheckIns(start));
  });

  it("deshacer el avance no pisa la decisión tomada después (fuera de la pila)", {
    timeout: 60_000,
  }, () => {
    const logged = reducer(tight(), {
      type: "logProgress",
      taskId: "entrega-sd",
      minutes: 60,
      now: NOW,
    });
    const free = must(asked(logged).options.find((o) => o.kind === "use-free-time"));
    const chosen = reducer(logged, { type: "applyOption", optionId: free.id, now: NOW });
    // The decision is undone from the list of the Bandeja, not from the ↶.
    const record = must(chosen.applied?.at(-1));
    const listed = reducer(chosen, { type: "undoDecision", id: record.id, now: NOW });
    expect(listed.planHistory?.map((v) => v.label)).toEqual(
      logged.planHistory?.map((v) => v.label),
    );
    // And one taken after the avance, with its version no longer on top, stays put.
    const again = reducer(listed, { type: "applyOption", optionId: free.id, now: NOW });
    const kept = { ...again, planHistory: logged.planHistory };
    const back = undo(kept);
    expect(back.freeTimeUntil).toBe(again.freeTimeUntil);
    expect(back.applied).toEqual(again.applied);
  });

  it("deshacer un traslado no replanifica el día: el resto queda idéntico", {
    timeout: 60_000,
  }, () => {
    const d = demo();
    const trip = must(d.events.find((e) => e.start > NOW && e.location && e.id !== "evento-gran"));
    const adjusted = reducer(d, {
      type: "tripMinutes",
      eventId: trip.id,
      minutes: 25,
      start: trip.start,
      now: NOW,
    });
    expect(adjusted.planHistory?.at(-1)?.label).toBe("ajustar un traslado");
    const pinned = must(adjusted.plan.find((b) => b.start > NOW + 3 * 3600_000));
    const moved = reducer(adjusted, {
      type: "pin",
      blockId: pinned.id,
      start: pinned.start + 30 * 60_000,
      now: NOW,
    });
    const back = undo(moved);
    expect(differing(back, adjusted)).toEqual([]);
    // The seeded history has nothing the user did not do.
    expect(demo().planHistory ?? []).toEqual([]);
  });
});

describe("El historial sembrado de la demo", () => {
  it("no trae entradas del ↶ (ni la demo común ni la de pruebas)", () => {
    expect(seedHistory(pruebasData(NOW), NOW).planHistory ?? []).toEqual([]);
    localStorage.clear();
    expect(loadDemo(NOW).planHistory ?? []).toEqual([]);
  });
});

describe("Falla 2: cada acción deja una entrada y ↶ la deshace sola", () => {
  const task = (d: AppData, id: string): AppTask => must(d.tasks.find((t) => t.id === id));
  /** Every action of the person that changes data: its label and how to make it. */
  const ACTIONS: [label: string, make: (...args: [AppData]) => Action][] = [
    [
      "registrar avance",
      () => ({ type: "logProgress", taskId: "entrega-sd", minutes: 60, now: NOW }),
    ],
    [
      "marcar Hecho",
      (d) => {
        const b = must(pendingConfirmations(d, NOW).at(0));
        return {
          type: "checkIn",
          checkIn: {
            blockId: b.id,
            taskId: b.taskId,
            status: "done",
            minutesDone: 30,
            unitIds: [],
          },
          now: NOW,
        };
      },
    ],
    [
      "guardar Leer",
      () => ({
        type: "saveRoutine",
        name: "Leer",
        sessionsPerWeek: 2,
        sessionMinutes: 60,
        now: NOW,
      }),
    ],
    ["crear Arte", () => ({ type: "newSubject", name: "Arte", now: NOW })],
    [
      "guardar Informe nuevo",
      (d) => ({
        type: "saveTask",
        task: { ...task(d, "entrega-sd"), title: "Informe nuevo" },
        now: NOW,
      }),
    ],
    [
      "guardar Física nueva",
      (d) => ({
        type: "saveActivity",
        activity: { ...must(d.activities.find((a) => a.id === "fis")), name: "Física nueva" },
        now: NOW,
      }),
    ],
    [
      "ignorar Parcial SD (del calendar…",
      () => ({ type: "review", taskId: "parcial-nuevo", keep: false, now: NOW }),
    ],
    [
      "planificar Parcial SD (del calendar…",
      () => ({ type: "review", taskId: "parcial-nuevo", keep: true, now: NOW }),
    ],
    ["ordenar Charla", () => ({ type: "classTitle", title: "Charla", as: "event", now: NOW })],
    [
      "ordenar Física I",
      () => ({ type: "sortActivity", activityId: "fis", as: "rutina", now: NOW }),
    ],
    [
      "ajustar el día",
      () => ({ type: "override", override: { date: "2026-11-22", wake: 600 }, now: NOW }),
    ],
    [
      "mezclar materias por hoy",
      () => ({ type: "relaxContext", until: NOW + 3_600_000, now: NOW }),
    ],
    [
      "mover o sacar una comida",
      () => ({ type: "mealChoice", date: "2026-11-23", kind: "almuerzo", skip: true, now: NOW }),
    ],
    [
      "guardar Reglas",
      (d) => ({
        type: "settings",
        settings: { ...d.settings, maxActivitiesPerDay: d.settings.maxActivitiesPerDay + 1 },
        now: NOW,
      }),
    ],
    [
      "mover o fijar un bloque",
      (d) => {
        const b = must(d.plan.find((x) => x.start > NOW + 3 * 3_600_000));
        return { type: "pin", blockId: b.id, start: b.start + 30 * 60_000, now: NOW };
      },
    ],
    ["eliminar Física I", () => ({ type: "deleteActivity", activityId: "fis", now: NOW })],
    [
      "guardar Preferencias",
      () => ({ type: "preferences", preferences: { holidaysOff: false }, now: NOW }),
    ],
    [
      "pausar Informe corto SD",
      () => ({ type: "recurrence", taskId: "entrega-corta", change: "pause", now: NOW }),
    ],
    ["Elegir", () => ({ type: "applyOption", optionId: "drop:entrega-corta", now: NOW })],
  ];

  it.each(ACTIONS)("%s", { timeout: 60_000 }, (label, make) => {
    const before = demo();
    const action = make(before);
    const after = reducer(before, action);
    expect(after).not.toBe(before);
    const stack = after.planHistory ?? [];
    // Exactly one entry, with its label.
    expect(stack).toHaveLength((before.planHistory?.length ?? 0) + 1);
    const made = must(stack.at(-1)).label;
    if (label === "Elegir") expect(made).toBe(clipName(after.applied?.at(-1)?.label ?? "", 40));
    else expect(made).toBe(label);
    // ↶ takes back only that one and leaves everything else as it was.
    const back = undo(after);
    expect(back.planHistory ?? []).toHaveLength(before.planHistory?.length ?? 0);
    // The plan is derived: a materia coming back is planned again, so only its past is compared.
    const rest = differing(back, before).filter(
      (k) => k !== "plan" || label !== "eliminar Física I",
    );
    expect(rest).toEqual([]);
  });

  it("después de una acción, deshacer otra más nueva no toca a la anterior", {
    timeout: 60_000,
  }, () => {
    const one = reducer(demo(), {
      type: "saveRoutine",
      name: "Leer",
      sessionsPerWeek: 2,
      sessionMinutes: 60,
      now: NOW,
    });
    const two = reducer(one, { type: "review", taskId: "parcial-nuevo", keep: false, now: NOW });
    expect(two.planHistory?.map((v) => v.label)).toEqual([
      "guardar Leer",
      "ignorar Parcial SD (del calendar…",
    ]);
    const back = undo(two);
    expect(differing(back, one)).toEqual([]);
    expect(back.tasks.some((t) => t.title === "Leer")).toBe(true);
  });
});

describe("Falla 3: Salir borra la pila del ↶", () => {
  it("al salir y volver a la Demo de pruebas, el ↶ arranca vacío", async () => {
    localStorage.setItem("critical.mode", "demo");
    // A demo with something done: the header offers its ↶.
    const done = reducer(demo(), {
      type: "logProgress",
      taskId: "entrega-sd",
      minutes: 60,
      now: NOW,
    });
    localStorage.setItem("critical.demo.v2", JSON.stringify(done));
    const first = render(<App fixedNow={NOW} />);
    expect(await screen.findByRole("button", { name: "Deshacer: registrar avance" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Demo de pruebas" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Ajustes" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^Deshacer:/ })).toBeNull();
    first.unmount();
  }, 60_000);
});
