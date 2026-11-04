import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { importFromCalendars } from "./calendars.js";
import { Inbox } from "./components/Inbox.js";
import { diffData } from "./data.js";
import { emptyData } from "./demo.js";
import { type Activity, zonedInstant } from "./engine.js";
import type { AppData, AppEvent } from "./model.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import {
  aliasFrom,
  NO_SUBJECT,
  newClassTitles,
  subjectFor,
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
    let d = data();
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 150, now: NOW });
    const study = d.tasks.find((t) => t.activityId === "add" && t.kind === "habit");
    expect(study).toMatchObject({ minMinutes: 150, sessionsPerWeek: 3, sessionMinutes: 60 });
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 60, now: NOW });
    expect(d.tasks.filter((t) => t.kind === "habit")).toHaveLength(1);
    d = reducer(d, { type: "weeklyStudy", activityId: "add", minutes: 0, now: NOW });
    expect(d.tasks.find((t) => t.id === study?.id)?.status).toBe("dropped");

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
      fireEvent.click(screen.getByRole("option", { name: /Análisis y Diseño/ }));
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
