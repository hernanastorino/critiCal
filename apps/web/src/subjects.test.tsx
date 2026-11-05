import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { importFromCalendars } from "./calendars.js";
import { Inbox } from "./components/Inbox.js";
import { ActivitySettings } from "./components/Preferences.js";
import { diffData } from "./data.js";
import { emptyData } from "./demo.js";
import { type Activity, zonedInstant } from "./engine.js";
import type { AppData, AppEvent } from "./model.js";
import { loadDemo, reducer, resetDemo, StoreProvider, useStore } from "./store.js";
import {
  aliasFrom,
  hasClasses,
  NO_SUBJECT,
  newClassTitles,
  subjectFor,
  subjectsOf,
  unassignedTasks,
  unsortedActivities,
} from "./subjects.js";

afterEach(cleanup);

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-04", 8 * 60);
const at = (day: string, hour: number) => zonedInstant(tz, day, hour * 60);

const add: Activity = {
  id: "add",
  name: "Análisis y Diseño",
  color: "#0a84ff",
  academic: true,
  kind: "materia",
  aliases: ["add"],
  maxSessionMinutes: 120,
  minBlockMinutes: 60,
};

const event = (id: string, title: string, calendar: string, day: string, hour = 10): AppEvent => ({
  id,
  title,
  start: at(day, hour),
  end: at(day, hour + 2),
  busy: true,
  source: "icloud",
  calendarId: `icloud:${calendar}`,
});

function data(extra: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    owner: "me",
    activities: [add],
    calendars: [
      { id: "icloud:work", source: "icloud", externalId: "work", name: "Work", role: "clases" },
      { id: "icloud:parciales", source: "icloud", externalId: "parciales", name: "Parciales" },
    ],
    ...extra,
  };
}

const ids = (seed: string) => `id:${seed}`;

describe("materias", () => {
  it("finds an evaluation's materia by name or alias, and learns short names", () => {
    const d = data();
    expect(subjectFor(d, "P2 ADD")?.id).toBe("add");
    expect(subjectFor(d, "Parcial de Análisis y Diseño")?.id).toBe("add");
    expect(subjectFor(d, "Parcial de Física")).toBeUndefined();
    expect(aliasFrom("P2 ADD")).toBe("add");
    expect(aliasFrom("Pres ADD")).toBe("add");
    expect(aliasFrom("ADD Preentrega")).toBe("add");
    expect(aliasFrom("Prac PROG AV")).toBe("prog av");
  });

  it("never creates a materia from an evaluation once there is a class schedule", () => {
    const d = data({
      events: [
        event("p1", "P2 ADD", "parciales", "2026-11-10"),
        event("p2", "Parcial Física", "parciales", "2026-11-12"),
      ],
    });
    const out = importFromCalendars(d, NOW, ids);
    expect(out.tasks.find((t) => t.title === "P2 ADD")?.activityId).toBe("add");
    const waiting = out.activities.find((a) => a.name === NO_SUBJECT);
    expect(waiting?.id).toBe("id:activity:sin-materia");
    expect(out.tasks.find((t) => t.title === "Parcial Física")?.activityId).toBe(waiting?.id);
    expect(out.activities.filter((a) => a.kind === "materia")).toEqual([add]);
    expect(unassignedTasks(out).map((t) => t.title)).toEqual(["Parcial Física"]);
    // Without a class schedule, the old behaviour stays.
    const old = importFromCalendars({ ...d, calendars: d.calendars?.slice(1) }, NOW, ids);
    expect(old.activities.some((a) => a.name === NO_SUBJECT)).toBe(false);
  });

  it("asks once about each new class title that is not a materia yet", () => {
    const d = data({
      notSubjects: ["charla de bienvenida"],
      events: [
        event("c1", "Análisis y Diseño", "work", "2026-11-05"),
        event("c2", "Física II", "work", "2026-11-05", 14),
        event("c3", "Física II", "work", "2026-11-07", 14),
        event("c4", "Charla de bienvenida", "work", "2026-11-06"),
        event("x", "Dentista", "parciales", "2026-11-06"),
      ],
    });
    expect(newClassTitles(d).map((c) => c.title)).toEqual(["Física II"]);
    expect(newClassTitles({ ...d, calendars: [] })).toEqual([]);
  });

  it("turns class titles into materias, aliases or plain events", () => {
    const d = data({ events: [event("c2", "Física II", "work", "2026-11-05")] });
    const created = reducer(d, { type: "classTitle", title: "Física II", as: "materia", now: NOW });
    expect(created.activities.find((a) => a.name === "Física II")?.kind).toBe("materia");
    expect(newClassTitles(created)).toEqual([]);
    const skipped = reducer(d, { type: "classTitle", title: "Física II", as: "event", now: NOW });
    expect(skipped.notSubjects).toEqual(["fisica ii"]);
    const alias = reducer(d, { type: "classOf", title: "Física II", activityId: "add", now: NOW });
    expect(alias.activities.find((a) => a.id === "add")?.aliases).toEqual(["add", "fisica ii"]);
  });

  it("assigns a waiting evaluation and learns the name it used", () => {
    const d = importFromCalendars(
      data({ events: [event("p", "P1 IO", "parciales", "2026-11-10")] }),
      NOW,
      ids,
    );
    const task = unassignedTasks(d)[0];
    const done = reducer(d, {
      type: "assignSubject",
      taskId: task?.id as string,
      activityId: "add",
      now: NOW,
    });
    expect(done.tasks.find((t) => t.id === task?.id)?.activityId).toBe("add");
    expect(done.activities.find((a) => a.id === "add")?.aliases).toEqual(["add", "io"]);
    // Nothing waits any more, so "Sin materia" is gone.
    expect(done.activities.some((a) => a.name === NO_SUBJECT)).toBe(false);
    const fresh = reducer(d, {
      type: "newSubject",
      name: "Investigación Operativa",
      taskId: task?.id as string,
      now: NOW,
    });
    const io = fresh.activities.find((a) => a.name === "Investigación Operativa");
    expect(io?.kind).toBe("materia");
    expect(fresh.tasks.find((t) => t.id === task?.id)?.activityId).toBe(io?.id);
  });

  it("sorts old activities into materias and rutinas, or merges them", () => {
    const pres: Activity = { ...add, id: "pres", name: "Pres ADD", kind: undefined, aliases: [] };
    const gym: Activity = { ...add, id: "gym", name: "gym", kind: undefined, aliases: [] };
    const d = data({
      activities: [add, pres, gym],
      tasks: [
        {
          id: "t",
          activityId: "pres",
          title: "Pres ADD",
          kind: "deliverable",
          deadline: at("2026-11-10", 10),
          estimateMinutes: 120,
          minMinutes: 60,
          priority: 2,
          status: "active",
          units: [],
        },
      ],
    });
    expect(unsortedActivities(d).map((a) => a.id)).toEqual(["pres", "gym"]);
    const merged = reducer(d, { type: "mergeActivity", activityId: "pres", into: "add", now: NOW });
    expect(merged.activities.map((a) => a.id)).toEqual(["add", "gym"]);
    expect(merged.tasks[0]?.activityId).toBe("add");
    expect(merged.plan.every((b) => b.activityId !== "pres")).toBe(true);
    const sorted = reducer(merged, {
      type: "sortActivity",
      activityId: "gym",
      as: "rutina",
      now: NOW,
    });
    expect(sorted.activities.find((a) => a.id === "gym")).toMatchObject({
      kind: "rutina",
      academic: false,
    });
    expect(unsortedActivities(sorted)).toEqual([]);
    expect(reducer(d, { type: "mergeActivity", activityId: "pres", into: "pres", now: NOW })).toBe(
      d,
    );
  });

  it("keeps a materia's weekly study and adds routines", () => {
    // Another weekly silo of the materia is not its study and is never touched.
    const practice = {
      id: "practice",
      activityId: "add",
      title: "Ejercicios",
      kind: "habit" as const,
      estimateMinutes: 0,
      minMinutes: 90,
      sessionsPerWeek: 2,
      sessionMinutes: 45,
      priority: 2,
      status: "active" as const,
      units: [],
    };
    let d = data({ tasks: [practice] });
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 150, now: NOW });
    const study = d.tasks.find((t) => t.title === "Estudio Análisis y Diseño");
    expect(study).toMatchObject({ minMinutes: 150, sessionsPerWeek: 3, sessionMinutes: 60 });
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 60, now: NOW });
    expect(d.tasks.filter((t) => t.kind === "habit")).toHaveLength(2);
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 0, now: NOW });
    expect(d.tasks.find((t) => t.id === study?.id)?.status).toBe("dropped");
    expect(d.tasks.find((t) => t.id === "practice")).toMatchObject({
      status: "active",
      minMinutes: 90,
    });

    d = reducer(d, {
      type: "saveRoutine",
      name: "Gimnasio",
      sessionsPerWeek: 3,
      sessionMinutes: 90,
      now: NOW,
    });
    const gym = d.activities.find((a) => a.name === "Gimnasio");
    expect(gym).toMatchObject({ kind: "rutina", academic: false });
    expect(d.tasks.find((t) => t.activityId === gym?.id)).toMatchObject({
      kind: "habit",
      sessionsPerWeek: 3,
      sessionMinutes: 90,
      minMinutes: 270,
    });
  });

  it("enters class mode only when the user picks the role", () => {
    const named = data({
      calendars: [{ id: "icloud:h", source: "icloud", externalId: "h", name: "Horarios" }],
    });
    expect(hasClasses(named)).toBe(false);
    expect(hasClasses(data())).toBe(true);
    // Without a schedule, old activities hold exams and study; with one, only materias.
    const old: Activity = { ...add, id: "old", name: "Física", kind: undefined };
    const gym: Activity = { ...add, id: "g", name: "Gym", kind: "rutina" };
    const all = { activities: [add, old, gym] };
    expect(subjectsOf({ ...named, ...all }).map((a) => a.id)).toEqual(["add", "old"]);
    expect(subjectsOf({ ...data(), ...all }).map((a) => a.id)).toEqual(["add"]);
  });

  it("refuses endless study or routines and drops the study's future pins", () => {
    const d = reducer(data(), { type: "weeklyStudy", activityId: "add", minutes: 120, now: NOW });
    expect(
      reducer(d, {
        type: "weeklyStudy",
        activityId: "add",
        minutes: Number.POSITIVE_INFINITY,
        now: NOW,
      }),
    ).toBe(d);
    for (const [times, minutes] of [
      [Number.POSITIVE_INFINITY, 60],
      [3, Number("1e309")],
      [0, 60],
      [3, 0],
    ] as const)
      expect(
        reducer(d, {
          type: "saveRoutine",
          name: "Gym",
          sessionsPerWeek: times,
          sessionMinutes: minutes,
          now: NOW,
        }),
      ).toBe(d);
    const study = d.tasks.find((t) => t.kind === "habit") as AppData["tasks"][number];
    const pin = (start: number) => ({
      id: `pin:${study.id}@${start}`,
      taskId: study.id,
      activityId: "add",
      start,
      end: start + 3_600_000,
    });
    // One already under way stays; one ahead goes.
    const pinned = { ...d, pins: [pin(NOW - 1_800_000), pin(NOW + 86_400_000)] };
    const dropped = reducer(pinned, {
      type: "weeklyStudy",
      activityId: "add",
      minutes: 0,
      now: NOW,
    });
    expect(dropped.pins?.map((p) => p.start)).toEqual([NOW - 1_800_000]);
  });

  it("keeps the weekly study of a renamed materia, even next to a habit with its title", () => {
    // A habit the user made, already called like the study will be after the rename.
    const lookalike = {
      id: "lookalike",
      activityId: "add",
      title: "Estudio ADD",
      kind: "habit" as const,
      estimateMinutes: 0,
      minMinutes: 30,
      sessionsPerWeek: 1,
      sessionMinutes: 30,
      priority: 2,
      status: "active" as const,
      units: [],
    };
    let d = reducer(data({ tasks: [lookalike] }), {
      type: "weeklyStudy",
      activityId: "add",
      minutes: 120,
      now: NOW,
    });
    d = reducer(d, { type: "saveActivity", activity: { ...add, name: "ADD" }, now: NOW });
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 0, now: NOW });
    expect(d.tasks.find((t) => t.id === "lookalike")).toMatchObject({
      status: "active",
      minMinutes: 30,
    });
    d = { ...d, tasks: d.tasks.filter((t) => t.id !== "lookalike" && t.status === "active") };
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 120, now: NOW });
    expect(d.tasks.filter((t) => t.kind === "habit").map((t) => t.title)).toEqual(["Estudio ADD"]);
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 180, now: NOW });
    expect(d.tasks.filter((t) => t.kind === "habit" && t.status === "active")).toHaveLength(1);
    expect(d.tasks.find((t) => t.kind === "habit")?.minMinutes).toBe(180);
  });

  it("keeps one weekly study when merging and marks old backups' study", () => {
    const old: Activity = { ...add, id: "old", name: "Viejo", kind: undefined, aliases: [] };
    let d = data({ activities: [add, old] });
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 60, now: NOW });
    d = reducer(d, { type: "weeklyStudy", activityId: "old", minutes: 120, now: NOW });
    d = reducer(d, { type: "mergeActivity", activityId: "old", into: "add", now: NOW });
    // The target's study wins; the other one ends, so only 60 minutes are planned.
    const active = d.tasks.filter(
      (t) => t.activityId === "add" && t.kind === "habit" && t.status === "active",
    );
    expect(active.map((t) => [t.minMinutes, !!t.study])).toEqual([[60, true]]);
    expect(d.tasks.filter((t) => t.kind === "habit" && t.status === "dropped")).toHaveLength(1);
    const planned = d.plan
      .filter((b) => b.activityId === "add" && b.taskId === active[0]?.id)
      .reduce((m, b) => m + (b.end - b.start) / 60_000, 0);
    expect(
      d.plan.every((b) => b.taskId === active[0]?.id || b.activityId !== "add" || b.start < NOW),
    ).toBe(true);
    expect(planned).toBeGreaterThan(0);

    // A backup from before the mark: its «Estudio <materia>» becomes the study.
    const legacy = {
      ...data(),
      tasks: [
        {
          id: "s",
          activityId: "add",
          title: "Estudio Análisis y Diseño",
          kind: "habit" as const,
          estimateMinutes: 0,
          minMinutes: 120,
          sessionsPerWeek: 2,
          sessionMinutes: 60,
          priority: 2,
          status: "active" as const,
          units: [],
        },
      ],
    };
    // A version 1 file, from before the mark: its «Estudio <materia>» is the study, once.
    const twice = { ...legacy, tasks: [legacy.tasks[0], { ...legacy.tasks[0], id: "s2" }] };
    const v1 = JSON.stringify({ app: "critiCal", version: 1, exportedAt: 1, data: twice });
    const restored = parseBackup(v1);
    expect("data" in restored && restored.data.tasks.map((t) => !!t.study)).toEqual([true, false]);
    // Current files already carry the mark: an unmarked lookalike stays unmarked.
    const current = parseBackup(exportJson(legacy, 1));
    expect("data" in current && current.data.tasks[0]?.study).toBeUndefined();
  });

  it("stores kinds, aliases and the titles that are not materias", () => {
    const before = data();
    const after = {
      ...before,
      activities: [{ ...add, aliases: ["add", "a y d"] }],
      notSubjects: ["charla"],
    };
    const writes = diffData(before, after);
    expect(writes.upserts.find((u) => u.table === "activities")?.rows[0]).toMatchObject({
      kind: "materia",
      aliases: ["add", "a y d"],
    });
    expect(writes.upserts.find((u) => u.table === "settings")?.rows[0]).toMatchObject({
      state: { notSubjects: ["charla"] },
    });
  });
});

function Probe() {
  const { data } = useStore();
  return <output data-testid="subjects">{JSON.stringify(data.activities)}</output>;
}

describe("inbox", () => {
  it("asks about new classes and which materia an evaluation is", async () => {
    render(
      <StoreProvider
        initial={() =>
          data({
            events: [
              event("c2", "Física II", "work", "2026-11-05"),
              event("p", "P1 IO", "parciales", "2026-11-10"),
            ],
          })
        }
        persist={false}
        fixedNow={NOW}
      >
        <Inbox />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText("Clases nuevas en tu calendario")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Es una materia" }));
    });
    expect(screen.queryByText("Clases nuevas en tu calendario")).toBeNull();
    expect(screen.getByTestId("subjects").textContent).toContain('"name":"Física II"');

    expect(screen.getByText("¿De qué materia es?")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Materia de P1 IO"), { target: { value: "anal" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Análisis y Diseño/ }));
    });
    expect(screen.queryByText("¿De qué materia es?")).toBeNull();
    expect(screen.getByTestId("subjects").textContent).toContain('"io"');
  });

  it("sorts old activities", async () => {
    const gym: Activity = { ...add, id: "gym", name: "gym", kind: undefined, aliases: [] };
    render(
      <StoreProvider
        initial={() => data({ activities: [add, gym] })}
        persist={false}
        fixedNow={NOW}
      >
        <Inbox />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText("Ordenar tus actividades")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rutina" }));
    });
    expect(screen.queryByText("Ordenar tus actividades")).toBeNull();
    expect(screen.getByTestId("subjects").textContent).toContain('"kind":"rutina"');
  });
});

it("does not save a weekly study longer than a week", () => {
  render(
    <StoreProvider initial={() => data()} persist={false} fixedNow={NOW}>
      <ActivitySettings />
    </StoreProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Análisis y Diseño/ }));
  const field = screen.getByLabelText(/Estudio semanal/);
  const save = screen.getByRole("button", {
    name: /Guardar Análisis y Diseño/,
  }) as HTMLButtonElement;
  fireEvent.change(field, { target: { value: "169" } });
  expect(save.disabled).toBe(true);
  fireEvent.change(field, { target: { value: "3" } });
  expect(save.disabled).toBe(false);
});

it("migrates a demo saved before the study mark, once", () => {
  localStorage.clear();
  const old = {
    ...data(),
    tasks: [
      {
        id: "s",
        activityId: "add",
        title: "Estudio Análisis y Diseño",
        kind: "habit" as const,
        estimateMinutes: 0,
        minMinutes: 60,
        priority: 2,
        status: "active" as const,
        units: [],
      },
    ],
  };
  localStorage.setItem("critical.demo.v1", JSON.stringify(old));
  expect(loadDemo(NOW).tasks[0]?.study).toBe(true);
  expect(localStorage.getItem("critical.demo.v1")).toBeNull();
  expect(JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}").tasks[0].study).toBe(true);
  // If the migrated copy cannot be stored, the old one stays and the data is still used.
  localStorage.clear();
  localStorage.setItem("critical.demo.v1", JSON.stringify(old));
  const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  expect(loadDemo(NOW).tasks[0]?.study).toBe(true);
  full.mockRestore();
  expect(localStorage.getItem("critical.demo.v1")).not.toBeNull();
  // The first edit saved makes room by dropping the old copy, so edits are not lost.
  let room = false;
  const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (!room) throw new DOMException("full", "QuotaExceededError");
    Object.defineProperty(this, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (key === "critical.demo.v1") room = true;
    delete (this as unknown as Record<string, string>)[key];
  });
  render(
    <StoreProvider initial={loadDemo} persist fixedNow={NOW}>
      {null}
    </StoreProvider>,
  );
  quota.mockRestore();
  remove.mockRestore();
  expect(room).toBe(true);
  // Not even that fits: the old copy is put back, never neither.
  localStorage.clear();
  localStorage.setItem("critical.demo.v1", JSON.stringify(old));
  const full2 = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === "critical.demo.v2") throw new DOMException("full", "QuotaExceededError");
    Object.defineProperty(this, key, {
      value,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });
  render(
    <StoreProvider initial={loadDemo} persist fixedNow={NOW}>
      {null}
    </StoreProvider>,
  );
  full2.mockRestore();
  expect(localStorage.getItem("critical.demo.v1")).not.toBeNull();
  // Blocked storage: the demo keeps working in memory.
  const blocked = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  expect(() =>
    render(
      <StoreProvider initial={() => data()} persist fixedNow={NOW}>
        {null}
      </StoreProvider>,
    ),
  ).not.toThrow();
  blocked.mockRestore();
  localStorage.setItem("critical.demo.v1", "{}");
  resetDemo();
  expect(localStorage.getItem("critical.demo.v1")).toBeNull();
  expect(localStorage.getItem("critical.demo.v2")).toBeNull();
});

it("edits a materia's study and break minutes", async () => {
  render(
    <StoreProvider initial={() => data()} persist={false} fixedNow={NOW}>
      <ActivitySettings />
      <Probe />
    </StoreProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Análisis y Diseño/ }));
  expect((screen.getByLabelText(/Estudio antes del descanso/) as HTMLInputElement).value).toBe(
    "50",
  );
  expect((screen.getByLabelText(/Descanso \(min/) as HTMLInputElement).value).toBe("10");
  fireEvent.change(screen.getByLabelText(/Estudio antes del descanso/), {
    target: { value: "25" },
  });
  fireEvent.change(screen.getByLabelText(/Descanso \(min/), { target: { value: "5" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Guardar Análisis y Diseño/ }));
  });
  expect(screen.getByTestId("subjects").textContent).toContain('"studyMinutes":25');
  expect(screen.getByTestId("subjects").textContent).toContain('"breakMinutes":5');
});
