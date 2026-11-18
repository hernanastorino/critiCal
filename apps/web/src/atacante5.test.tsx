import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { decisions, refreshPlan } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import { runningSince } from "./testing.js";

afterEach(cleanup);

// Thursday 19/11 at 16:40, with a single materia allowed per day: «Sugerencia» shows up.
const NOW = zonedInstant("America/Montevideo", "2026-11-19", 1000);
const oneAtATime = (): AppData => {
  const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
  return reducer(
    { ...d, settings: { ...d.settings, maxActivitiesPerDay: 1 } },
    {
      type: "refresh",
      now: NOW,
    },
  );
};

const renderInbox = (initial: () => AppData) =>
  render(
    <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Inbox />
      </ToastProvider>
    </StoreProvider>,
  );

describe("Hoy: «Hacelo por hoy»", () => {
  it("is a suggestion in this demo", () => {
    const r = refreshPlan(oneAtATime(), NOW);
    expect(decisions(r.input, r.result).recommendations).toHaveLength(1);
  });

  it("offers «Deshacer» and does not leave focus on another decision's", () => {
    // A decision taken before: its «Deshacer» is on a card further down.
    renderInbox(() => ({
      ...oneAtATime(),
      applied: [{ id: "antes", label: "Quedarme con el mínimo", at: NOW - 60_000, before: [] }],
    }));
    const suggestion = screen.getByText("Hacelo por hoy");
    suggestion.focus();
    fireEvent.click(suggestion);
    const undo = screen.getByRole("button", { name: "Deshacer" });
    expect(undo).toBeTruthy();
    expect(document.activeElement?.getAttribute("aria-label") ?? "").not.toMatch(/^Deshacer: /);
    fireEvent.click(undo);
    expect(screen.getByText("Hacelo por hoy")).toBeTruthy();
  });
});

function Log() {
  const { dispatch } = useStore();
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: "logProgress", taskId: "informe-fis", minutes: 120 })}
    >
      anotar
    </button>
  );
}

describe("Silos: «Esta semana: planificado vs. hecho»", () => {
  afterEach(() => vi.useRealTimers());

  it("counts what was just logged, though the screen's clock has not ticked yet", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false}>
        <ToastProvider>
          <Log />
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText(/1h40 de 1h40/)).toBeNull();
    // 30 s later, before the minute tick: the check-in is stamped after the screen's clock.
    vi.setSystemTime(NOW + 30_000);
    fireEvent.click(screen.getByText("anotar"));
    expect(screen.getByText("Esta semana: planificado vs. hecho")).toBeTruthy();
    expect(screen.getByText(/1h40 de 1h40/)).toBeTruthy();
  });
});

describe("«Usar tiempo libre para llegar al objetivo»", () => {
  const NOW18 = zonedInstant("America/Montevideo", "2026-11-18", 21);
  it("takes out the blocks it added when it is undone", { timeout: 30_000 }, () => {
    const d0 = reducer(demoData(NOW18), { type: "refresh", now: NOW18 });
    const withLeer = runningSince(
      reducer(d0, {
        type: "saveRoutine",
        name: "Leer",
        sessionsPerWeek: 14,
        sessionMinutes: 60,
        now: NOW18,
      }),
      NOW18,
    );
    const leer = withLeer.tasks.find((t) => t.title === "Leer");
    // An objective beyond the minimum that only free time can reach.
    const tight = reducer(withLeer, {
      type: "saveTask",
      task: {
        ...(withLeer.tasks.find((t) => t.id === "informe-fis") as AppData["tasks"][number]),
        minMinutes: 60,
        estimateMinutes: 6000,
        units: [],
      },
      now: NOW18,
    });
    const d = reducer(tight, {
      type: "applyOption",
      optionId: `lower-minimum:${leer?.id}`,
      now: NOW18,
    });
    const r = refreshPlan(d, NOW18);
    const option = decisions(r.input, r.result).options.find((o) => o.kind === "use-free-time");
    expect(option).toBeTruthy();
    const after = reducer(d, { type: "applyOption", optionId: option?.id as string, now: NOW18 });
    expect(after.plan.filter((b) => b.soft).length).toBeGreaterThan(
      d.plan.filter((b) => b.soft).length,
    );
    const record = after.applied?.at(-1);
    const undone = reducer(after, { type: "undoDecision", id: record?.id as string, now: NOW18 });
    expect(undone.freeTimeUntil).toBe(d.freeTimeUntil);
    expect(undone.plan.filter((b) => b.soft).length).toBe(d.plan.filter((b) => b.soft).length);
  });
});
