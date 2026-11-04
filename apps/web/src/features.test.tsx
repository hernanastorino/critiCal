import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { isPlanCalendar, visibleEvents } from "./calendars.js";
import { demoData, emptyData } from "./demo.js";
import type { AppData, AppTask } from "./model.js";
import { reducer } from "./store.js";
import { held } from "./updates.js";

const NOW = Date.UTC(2026, 10, 2, 20);
const stored = (): AppData => JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("progress log", () => {
  it("logs minutes and topics for a task without parts", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByLabelText(/Entrega TP Programación: faltan/));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByPlaceholderText("40"), { target: { value: "40" } });
    fireEvent.change(within(sheet).getByPlaceholderText("10"), { target: { value: "10" } });
    fireEvent.change(within(sheet).getByPlaceholderText("6"), { target: { value: "6" } });
    fireEvent.click(within(sheet).getByText("Guardar avance"));
    const task = stored().tasks.find((t) => t.id === "tp-prog");
    expect(task?.units).toHaveLength(10);
    expect(task?.units.filter((u) => u.doneAt)).toHaveLength(6);
    expect(stored().checkIns.at(-1)).toMatchObject({ taskId: "tp-prog", minutesDone: 40 });
  });

  it("ticks parts of a task that has them", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByLabelText(/Parcial Cálculo II: faltan/));
    fireEvent.click(screen.getByLabelText(/Práctico 4/));
    fireEvent.click(screen.getByText("Guardar avance"));
    const task = stored().tasks.find((t) => t.id === "parcial-calc");
    expect(task?.units.find((u) => u.id === "u1")?.doneAt).toBe(NOW);
    expect(stored().checkIns.at(-1)).toMatchObject({ minutesDone: 0, unitIds: ["u1"] });
  });

  it("ignores progress for an unknown task and logs nothing when empty", () => {
    const d = demoData(NOW);
    expect(reducer(d, { type: "logProgress", taskId: "nope", minutes: 5, now: NOW })).toBe(d);
    expect(
      reducer(d, { type: "logProgress", taskId: "gym", minutes: 0, now: NOW }).checkIns,
    ).toHaveLength(0);
  });
});

describe("decisions and defaults", () => {
  const tight = (): AppData => {
    const d = demoData(NOW);
    return {
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === "parcial-calc" ? { ...t, minMinutes: 1500, estimateMinutes: 1500, units: [] } : t,
      ),
    };
  };

  it("undoes an applied decision", () => {
    const start = reducer(tight(), { type: "refresh", now: NOW });
    const after = reducer(start, { type: "applyOption", optionId: "proportional", now: NOW });
    expect(after.applied).toHaveLength(1);
    expect(after.tasks.find((t) => t.id === "parcial-calc")?.minMinutes).toBeLessThan(1500);
    const undone = reducer(after, {
      type: "undoDecision",
      id: after.applied?.[0]?.id as string,
      now: NOW,
    });
    expect(undone.tasks.find((t) => t.id === "parcial-calc")?.minMinutes).toBe(1500);
    expect(undone.applied).toEqual([]);
    // Only tasks the decision really changed are recorded, so later edits elsewhere survive.
    const record = after.applied?.[0];
    for (const t of record?.before ?? []) {
      const n = after.tasks.find((x) => x.id === t.id);
      expect(
        n?.minMinutes !== t.minMinutes ||
          n?.estimateMinutes !== t.estimateMinutes ||
          n?.status !== t.status,
      ).toBe(true);
    }
    expect(reducer(undone, { type: "undoDecision", id: "nope", now: NOW })).toBe(undone);
  });

  it("never brings back silos deleted or ended after a decision", () => {
    const d = demoData(NOW);
    const [a, b, c] = d.tasks.filter((t) => t.status === "active");
    if (!a || !b || !c) throw new Error("demo needs three tasks");
    const decision = {
      id: "cut@1",
      label: "Recorte proporcional",
      at: NOW,
      // Before the cut: A and B had more minutes, C was active (the cut dropped it).
      before: [
        { ...a, minMinutes: a.minMinutes + 60 },
        { ...b, minMinutes: b.minMinutes + 60 },
        { ...c, status: "active" as const },
      ],
      dropped: [c.id],
    };
    const start: AppData = {
      ...d,
      tasks: d.tasks.map((t) => (t.id === c.id ? { ...t, status: "dropped" as const } : t)),
      applied: [decision],
    };
    // B ends by hand: the decision forgets it.
    const ended = reducer(start, {
      type: "recurrence",
      taskId: b.id,
      change: "endFromToday",
      now: NOW,
    });
    expect(ended.applied?.[0]?.before.map((t) => t.id)).toEqual([a.id, c.id]);
    const undone = reducer(ended, { type: "undoDecision", id: "cut@1", now: NOW });
    expect(undone.tasks.find((t) => t.id === a.id)?.minMinutes).toBe(a.minMinutes + 60);
    expect(undone.tasks.find((t) => t.id === b.id)?.status).toBe("dropped");
    // C was dropped by the decision itself: undo brings it back.
    expect(undone.tasks.find((t) => t.id === c.id)?.status).toBe("active");

    // A silo dropped later by other means is not revived either.
    const later: AppData = {
      ...start,
      tasks: start.tasks.map((t) => (t.id === a.id ? { ...t, status: "dropped" as const } : t)),
    };
    const kept = reducer(later, { type: "undoDecision", id: "cut@1", now: NOW });
    expect(kept.tasks.find((t) => t.id === a.id)?.status).toBe("dropped");

    // With the statuses it left recorded, any later change wins: finished, or dropped
    // and brought back and dropped again.
    const recorded: AppData = {
      ...start,
      applied: [{ ...decision, after: { [a.id]: "active", [b.id]: "active", [c.id]: "dropped" } }],
      tasks: start.tasks.map((t) => (t.id === a.id ? { ...t, status: "done" as const } : t)),
    };
    const kept2 = reducer(recorded, { type: "undoDecision", id: "cut@1", now: NOW });
    expect(kept2.tasks.find((t) => t.id === a.id)?.status).toBe("done");
    expect(kept2.tasks.find((t) => t.id === b.id)?.minMinutes).toBe(b.minMinutes + 60);
    expect(kept2.tasks.find((t) => t.id === c.id)?.status).toBe("active");

    // Dropped by the decision, brought back, dropped again: the same status, but the
    // later drop is the user's, so undo leaves it alone.
    const fromDecision: AppData = {
      ...start,
      applied: [{ ...decision, after: { [a.id]: "active", [b.id]: "active", [c.id]: "dropped" } }],
    };
    const back = reducer(fromDecision, {
      type: "saveTask",
      task: { ...(fromDecision.tasks.find((t) => t.id === c.id) as AppTask), status: "active" },
      now: NOW,
    });
    const again = reducer(back, {
      type: "saveTask",
      task: { ...(back.tasks.find((t) => t.id === c.id) as AppTask), status: "dropped" },
      now: NOW,
    });
    const undoneAgain = reducer(again, { type: "undoDecision", id: "cut@1", now: NOW });
    expect(undoneAgain.tasks.find((t) => t.id === c.id)?.status).toBe("dropped");

    // The same with an old record (no `after`): the later change takes it out.
    const legacyBack = reducer(start, {
      type: "saveTask",
      task: { ...(start.tasks.find((t) => t.id === c.id) as AppTask), status: "active" },
      now: NOW,
    });
    const legacyAgain = reducer(legacyBack, {
      type: "saveTask",
      task: { ...(legacyBack.tasks.find((t) => t.id === c.id) as AppTask), status: "dropped" },
      now: NOW,
    });
    expect(legacyAgain.applied?.[0]?.before.map((t) => t.id)).not.toContain(c.id);
    // Data loaded from elsewhere keeps its decision history as it comes.
    const loaded = reducer(fromDecision, {
      type: "replace",
      data: {
        ...fromDecision,
        tasks: fromDecision.tasks.map((t) =>
          t.id === c.id ? { ...t, status: "active" as const } : t,
        ),
      },
      now: NOW,
    });
    expect(loaded.applied?.[0]?.after?.[c.id]).toBe("dropped");

    // Every silo it touched deleted: the decision is gone.
    let gone = start;
    for (const t of [a, b, c])
      gone = reducer(gone, { type: "recurrence", taskId: t.id, change: "deleteAll", now: NOW });
    expect(gone.applied).toEqual([]);
  });

  it("shows applied decisions in the inbox with an undo button", () => {
    render(<App fixedNow={NOW} initial={tight} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    fireEvent.click(screen.getAllByText("Elegir")[0] as HTMLElement);
    expect(screen.getByText("Decisiones que tomaste")).toBeTruthy();
    fireEvent.click(screen.getByText("Deshacer"));
    expect(screen.queryByText("Decisiones que tomaste")).toBeNull();
  });

  it("resets detected tasks to their category's default hours", () => {
    const d: AppData = {
      ...emptyData(),
      calendars: [{ id: "google:p", source: "google", externalId: "p", name: "Parciales" }],
      events: [
        {
          id: "e",
          title: "Parcial Física",
          start: NOW + 86_400_000,
          end: NOW + 90_000_000,
          busy: true,
          source: "google",
          calendarId: "google:p",
        },
      ],
    };
    const imported = reducer(d, { type: "refresh", now: NOW });
    const id = imported.tasks[0]?.id as string;
    const edited = reducer(imported, {
      type: "saveTask",
      task: {
        ...(imported.tasks[0] as AppData["tasks"][number]),
        minMinutes: 10,
        estimateMinutes: 20,
      },
      now: NOW,
    });
    const reset = reducer(edited, { type: "resetDetected", taskId: id, now: NOW });
    expect(reset.tasks[0]).toMatchObject({ estimateMinutes: 600, minMinutes: 360 });
    const all = reducer(edited, { type: "resetDetected", now: NOW });
    expect(all.tasks[0]?.minMinutes).toBe(360);
    // Resetting everything keeps ignored tasks ignored; a single reset brings one back.
    const ignored = reducer(edited, { type: "review", taskId: id, keep: false, now: NOW });
    expect(reducer(ignored, { type: "resetDetected", now: NOW }).tasks[0]?.status).toBe("dropped");
    expect(reducer(ignored, { type: "resetDetected", taskId: id, now: NOW }).tasks[0]?.status).toBe(
      "active",
    );
  });
});

describe("week", () => {
  it("replans the week from now keeping history", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const past = {
      id: "old",
      taskId: "gym",
      activityId: "gym",
      start: NOW - 7_200_000,
      end: NOW - 3_600_000,
    };
    const future = {
      id: "later",
      taskId: "gym",
      activityId: "gym",
      start: NOW + 3_600_000,
      end: NOW + 7_200_000,
    };
    const replanned = reducer(
      {
        ...d,
        plan: [past, future],
        proposals: [{ id: "p", message: "", plan: [], conflicts: [], createdAt: NOW }],
      },
      { type: "replanWeek", now: NOW },
    );
    expect(replanned.plan.some((b) => b.id === "old")).toBe(true);
    expect(replanned.plan.some((b) => b.id === "later")).toBe(false);
    expect(replanned.proposals).toEqual([]);
  });

  it("has a replan button with feedback and names what is short in critical mode", () => {
    const tight = (now: number) => {
      const d = demoData(now);
      return {
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === "parcial-calc"
            ? { ...t, minMinutes: 3000, estimateMinutes: 3000, units: [] }
            : t,
        ),
      };
    };
    render(<App fixedNow={NOW} initial={tight} />);
    const replan = screen.getByLabelText("Reacomodar semana") as HTMLButtonElement;
    fireEvent.click(replan);
    // No second replan (and no overlapping timers) while one is running.
    expect(replan.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Camino crítico/ }));
    expect(screen.getByText(/No llegás: faltan .* de Parcial Cálculo II/)).toBeTruthy();
  });

  it("keeps a new version waiting while the demo cannot be stored", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<App fixedNow={NOW} initial={demoData} />);
      const replan = screen.getByLabelText("Reacomodar semana");
      const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
      fireEvent.click(replan);
      expect(held()).toBe(true);
      blocked.mockRestore();
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      // The next edit that is stored lets it go.
      fireEvent.click(replan);
      expect(held()).toBe(false);
      // Leaving the demo while it cannot be stored lets it go too.
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      fireEvent.click(replan);
      expect(held()).toBe(true);
      cleanup();
      expect(held()).toBe(false);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("answers a replan with a tick on its button, not a notice over the week", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(<App fixedNow={NOW} initial={demoData} />);
      const replan = screen.getByLabelText("Reacomodar semana");
      fireEvent.click(replan);
      // The edit was handed to its save, so it no longer keeps a new version waiting.
      expect(held()).toBe(false);
      expect(replan.className).toContain("spinning");
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(replan.className).toContain("done");
      expect(replan.className).not.toContain("spinning");
      // Only screen readers hear it; nothing is drawn over the calendar.
      expect(screen.getByText(/Semana reacomodada/).className).toBe("sr-only");
      expect(document.querySelector(".snack")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(replan.className).not.toContain("done");
      // A second replan in the same minute empties the status first, so it is heard again.
      fireEvent.click(replan);
      expect(document.querySelector(".sr-only")?.textContent).toBe("");
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByText(/Semana reacomodada/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never treats a Plan calendar as an input", () => {
    expect(isPlanCalendar("📚 Plan")).toBe(true);
    expect(isPlanCalendar("Planificación")).toBe(false);
    const d: AppData = {
      ...emptyData(),
      calendars: [
        { id: "google:x", source: "google", externalId: "x", name: "📚 Plan", role: "busy" },
      ],
      events: [
        {
          id: "e",
          title: "Bloque",
          start: NOW,
          end: NOW + 1,
          busy: true,
          source: "google",
          calendarId: "google:x",
        },
      ],
    };
    expect(visibleEvents(d)).toEqual([]);
  });
});
