import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { DetectedDefaults } from "./components/Preferences.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { type Activity, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, AppTask } from "./model.js";
import { StoreProvider, useStore } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);
const at = (day: string, hour: number) => zonedInstant(TIMEZONE, day, hour * 60);

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const inside = (ui: React.ReactNode, initial: (now: number) => AppData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );
const click = (name: string | RegExp) =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
const undo = () => click("Deshacer");
/** The parts of the data an answer of the inbox may touch. */
const parts = (d?: AppData) => ({
  tasks: d?.tasks,
  activities: d?.activities,
  notSubjects: d?.notSubjects,
  plan: d?.plan,
  pins: d?.pins,
  applied: d?.applied,
  proposals: d?.proposals,
  tentativeHoldUntil: d?.tentativeHoldUntil,
  planHistory: d?.planHistory,
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearDrafts();
});

const materia = (id: string, name: string): Activity => ({
  id,
  name,
  color: "#0a84ff",
  academic: true,
  kind: "materia",
  maxSessionMinutes: 120,
  minBlockMinutes: 60,
});
const classEvent = (id: string, title: string): AppEvent => ({
  id,
  title,
  start: at("2026-11-19", 10),
  end: at("2026-11-19", 12),
  busy: true,
  source: "icloud",
  calendarId: "icloud:work",
});
/** A class schedule, so the inbox sorts activities and asks about new class titles. */
const withClasses = (extra: Partial<AppData>) => (now: number) => ({
  ...emptyData(),
  owner: "me",
  calendars: [
    {
      id: "icloud:work",
      source: "icloud" as const,
      externalId: "work",
      name: "Work",
      role: "clases" as const,
    },
  ],
  ...extra,
  settings: demoData(now).settings,
});

describe("1. Bandeja: Deshacer en vez de confirmar", () => {
  it("Ignorar a detected task goes back exactly", () => {
    inside(<Inbox />, (now) => {
      const d = demoData(now);
      const first = d.tasks.find((t) => t.status === "active" && t.kind === "deliverable");
      return {
        ...d,
        tasks: d.tasks.map((t) => (t.id === first?.id ? { ...t, needsReview: true } : t)),
      };
    });
    const before = structuredClone(parts(latest));
    expect(latest?.tasks.filter((t) => t.needsReview).length).toBe(1);
    click("Ignorar");
    expect(latest?.tasks.filter((t) => t.needsReview).length).toBe(0);
    expect(latest?.tasks.some((t) => t.status === "dropped" && t.needsReview === false)).toBe(true);
    undo();
    expect(parts(latest)).toEqual(before);
  });

  it("Juntar con una materia goes back exactly", () => {
    const pres: Activity = { ...materia("pres", "Pres ADD"), kind: undefined, aliases: [] };
    inside(<Inbox />, withClasses({ activities: [materia("add", "Análisis"), pres] }));
    const before = structuredClone(parts(latest));
    fireEvent.change(screen.getByLabelText("Juntar Pres ADD con una materia"), {
      target: { value: "anal" },
    });
    click(/Análisis/);
    expect(latest?.activities.map((a) => a.id)).toEqual(["add"]);
    undo();
    expect(parts(latest)).toEqual(before);
  });

  it("Es una materia / Evento suelto go back exactly", () => {
    for (const label of ["Es una materia", "Evento suelto"]) {
      inside(<Inbox />, withClasses({ events: [classEvent("c1", "Física II")] }));
      const before = structuredClone(parts(latest));
      click(label);
      expect(parts(latest)).not.toEqual(before);
      undo();
      expect(parts(latest)).toEqual(before);
      cleanup();
    }
  });

  it("Materia / Rutina go back exactly", () => {
    for (const label of ["Materia", "Rutina"]) {
      const gym: Activity = { ...materia("gym", "Gimnasio"), kind: undefined };
      inside(<Inbox />, withClasses({ activities: [gym] }));
      const before = structuredClone(parts(latest));
      click(label);
      expect(latest?.activities[0]?.kind).toBe(label === "Rutina" ? "rutina" : "materia");
      undo();
      expect(parts(latest)).toEqual(before);
      cleanup();
    }
  });

  it("Dejar como está goes back exactly", () => {
    inside(<Inbox />, (now) => {
      const d = demoData(now);
      const future = d.plan.filter((b) => b.start > now).slice(0, 1);
      return {
        ...d,
        proposals: [
          {
            id: "tentative@x",
            message: "Plan B",
            plan: [],
            conflicts: future.map((b) => b.id),
            createdAt: now,
          },
        ],
      };
    });
    const before = structuredClone(parts(latest));
    expect(latest?.proposals.length).toBe(1);
    click("Dejar como está");
    expect(latest?.proposals.length).toBe(0);
    undo();
    expect(parts(latest)).toEqual(before);
  });

  it("Volver todo lo detectado a estas horas goes back exactly", () => {
    const ev: AppEvent = { ...classEvent("e1", "Parcial X"), calendarId: "icloud:p" };
    const task: AppTask = {
      id: "det",
      activityId: "add",
      title: "Parcial X",
      kind: "deliverable",
      deadline: at("2026-11-25", 10),
      estimateMinutes: 90,
      minMinutes: 45,
      priority: 2,
      status: "active",
      units: [],
      sourceEventId: "e1",
    };
    const seed = (now: number): AppData => ({
      ...withClasses({
        activities: [materia("add", "Análisis")],
        events: [ev],
        tasks: [task],
        calendars: [
          { id: "icloud:p", source: "icloud", externalId: "p", name: "P", role: "parcial" },
        ],
      })(now),
    });
    inside(<DetectedDefaults />, seed);
    const before = structuredClone(parts(latest));
    click("Volver todo lo detectado a estas horas");
    expect(latest?.tasks[0]?.estimateMinutes).not.toBe(90);
    undo();
    expect(parts(latest)).toEqual(before);
  });
});

describe("1b. Editar entrega detectada: Volver a las horas por defecto", () => {
  it("goes back exactly", () => {
    const ev: AppEvent = { ...classEvent("e1", "Parcial X"), calendarId: "icloud:p" };
    const task: AppTask = {
      id: "det",
      activityId: "add",
      title: "Parcial X",
      kind: "deliverable",
      deadline: at("2026-11-25", 10),
      estimateMinutes: 90,
      minMinutes: 45,
      priority: 2,
      status: "active",
      units: [],
      sourceEventId: "e1",
    };
    const seed = (now: number): AppData =>
      withClasses({
        activities: [materia("add", "Análisis")],
        events: [ev],
        tasks: [task],
        calendars: [
          { id: "icloud:p", source: "icloud", externalId: "p", name: "P", role: "parcial" },
        ],
      })(now);
    inside(<TaskEditor task={task} onClose={() => {}} />, seed);
    const before = structuredClone(parts(latest));
    click("Volver a las horas por defecto");
    expect(latest?.tasks[0]?.estimateMinutes).not.toBe(90);
    undo();
    expect(parts(latest)).toEqual(before);
  });
});
