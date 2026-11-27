import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { ANSWER_GUARD_MS, Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { refresh } from "./refresh.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";
import { withBreaksOnTop } from "./testing.js";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let api: ReturnType<typeof useStore> | undefined;
function Probe() {
  api = useStore();
  return null;
}
const store = () => {
  if (!api) throw new Error("no store");
  return api;
};

const inside = (now: number, initial: (now: number) => AppData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={now}>
        <Probe />
        <Inbox />
      </StoreProvider>
    </ToastProvider>,
  );

const planOf = () => JSON.stringify(store().data.plan);
const snack = () => document.querySelector(".snack");
const undoNotice = () => {
  const button = snack()?.querySelector("button");
  if (!button) throw new Error("the notice has no «Deshacer»");
  return button;
};

describe("Bandeja: elegir una opción se puede deshacer desde el aviso", () => {
  const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);
  const crowded = (now: number) =>
    reducer(reducer(withBreaksOnTop(demoData(now)), { type: "refresh", now }), {
      type: "saveRoutine",
      name: "Leer",
      sessionsPerWeek: 14,
      sessionMinutes: 60,
      now,
    });

  it("«Elegir» muestra «Deshacer» y deja el plan y las opciones como estaban", {
    timeout: 60_000,
  }, () => {
    inside(NOW, crowded);
    const planBefore = planOf();
    const optionsBefore = screen.getAllByRole("button", { name: /^Elegir: / }).length;
    const first = screen.getAllByRole("button", { name: /^Elegir: / }).at(0);
    if (!first) throw new Error("no options");
    fireEvent.click(first);
    expect(snack()?.textContent).toMatch(/Deshacer$/);
    expect(screen.queryAllByRole("button", { name: /^Deshacer: / })).toHaveLength(1);
    fireEvent.click(undoNotice());
    expect(screen.queryAllByRole("button", { name: /^Deshacer: / })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^Elegir: / })).toHaveLength(optionsBefore);
    expect(planOf()).toBe(planBefore);
  });
});

describe("Hecho y Deshacer dejan el plan idéntico", () => {
  // Wednesday: the plan a fresh load shows is not the one the planner gives from scratch.
  const NOW = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);

  it("en una carga fresca el plan vuelve igual, bloque por bloque", { timeout: 120_000 }, () => {
    inside(NOW, (n) => seedHistory(pruebasData(n), n));
    const before = planOf();
    const done = screen.getAllByRole("button", { name: /^Hecho: / }).at(0);
    if (!done) throw new Error("nothing to answer");
    fireEvent.click(done);
    // A task with parts asks which ones first.
    const confirm = screen.queryByRole("button", { name: "Anotar hecho" });
    if (confirm) {
      const part = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed"));
      if (!part) throw new Error("no part to pick");
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + ANSWER_GUARD_MS + 1);
      fireEvent.click(part);
      fireEvent.click(confirm);
    }
    fireEvent.click(undoNotice());
    expect(planOf()).toBe(before);
  });

  const answer = (start: AppData, plan: AppData["plan"]) => {
    const block = plan.at(-1);
    if (!block) throw new Error("no block");
    const checkIn = {
      id: "c1",
      blockId: block.id,
      taskId: block.taskId,
      status: "done" as const,
      minutesDone: 60,
      unitIds: [],
    };
    return reducer(start, { type: "checkIn", now: NOW, checkIn });
  };
  const start = () => refresh(seedHistory(pruebasData(NOW), NOW), NOW);
  // Something else changed meanwhile: a busy event on the first block still to come.
  const changed = (d: AppData): AppData => {
    const next = d.plan.find((b) => b.start > NOW);
    if (!next) throw new Error("no block to come");
    const event = { id: "otro", title: "Otro", start: next.start, end: next.end, busy: true };
    return { ...d, events: [...d.events, { ...event, source: "demo" as const }] };
  };

  it("sin el plan guardado, deshacer lo reacomoda (la raíz del problema)", {
    timeout: 60_000,
  }, () => {
    const first = start();
    const answered = answer(
      first,
      first.plan.filter((b) => b.end <= NOW),
    );
    const undone = reducer(changed(answered), { type: "undoCheckIn", now: NOW, id: "c1" });
    expect(JSON.stringify(undone.plan)).not.toBe(JSON.stringify(first.plan));
  });

  it("con el plan de antes, deshacer lo deja idéntico", { timeout: 60_000 }, () => {
    const first = start();
    const answered = answer(
      first,
      first.plan.filter((b) => b.end <= NOW),
    );
    const plans = { before: first.plan, after: answered.plan };
    const undone = reducer(answered, { type: "undoCheckIn", now: NOW, id: "c1", plans });
    expect(JSON.stringify(undone.plan)).toBe(JSON.stringify(first.plan));
  });

  it("si el plan cambió por otro lado desde la respuesta, no se pisa con el viejo", {
    timeout: 60_000,
  }, () => {
    const first = start();
    const answered = answer(
      first,
      first.plan.filter((b) => b.end <= NOW),
    );
    const plans = { before: first.plan, after: [] };
    const undone = reducer(changed(answered), {
      type: "undoCheckIn",
      now: NOW,
      id: "c1",
      plans,
    });
    expect(JSON.stringify(undone.plan)).not.toBe(JSON.stringify(first.plan));
  });
});

describe("la ventanita de un bloque retiene el Tab", () => {
  const NOW = zonedInstant(TIMEZONE, "2026-11-02", 8 * 60);
  const tab = (shiftKey = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey });

  const openBubble = () => {
    localStorage.setItem("critical.mode", "demo");
    render(<App fixedNow={NOW} initial={() => demoData(NOW)} />);
    const pill = screen.getByTestId("week").querySelector<HTMLElement>(".pill.planned");
    if (!pill) throw new Error("no block");
    pill.focus();
    fireEvent.click(pill);
    const card = document.querySelector<HTMLElement>(".bubble-card");
    if (!card) throw new Error("no bubble");
    const buttons = [...card.querySelectorAll<HTMLElement>("button")];
    const last = buttons.at(-1);
    if (!last) throw new Error("no controls");
    return { pill, card, first: buttons.at(0), last };
  };

  it("Tab desde el último control vuelve al primero, y Shift+Tab al revés", () => {
    const { card, first, last } = openBubble();
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it("con el foco perdido, Tab lo trae de vuelta adentro y Escape lo devuelve al bloque", () => {
    const { pill, card } = openBubble();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    tab();
    expect(card.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".bubble-card")).toBeNull();
    expect(document.activeElement).toBe(pill);
  });
});

describe("Planificación semanal: «No llega al mínimo» es de la semana que se planifica", () => {
  const SUNDAY = zonedInstant(TIMEZONE, "2026-11-22", 18 * 60);
  const big = (id: string, title: string, deadline: number): AppTask => ({
    id,
    activityId: "a",
    title,
    kind: "deliverable",
    deadline,
    estimateMinutes: 6000,
    minMinutes: 6000,
    priority: 2,
    status: "active",
    units: [],
  });

  it("lista lo que vence dentro de esa semana y no lo que vence en otra", {
    timeout: 120_000,
  }, () => {
    const data = (): AppData => ({
      ...emptyData(),
      activities: [
        {
          id: "a",
          name: "Mate",
          color: "#f80",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      tasks: [
        big("dentro", "Vence dentro", zonedInstant(TIMEZONE, "2026-11-27", 20 * 60)),
        big("despues", "Vence después", zonedInstant(TIMEZONE, "2026-12-10", 20 * 60)),
      ],
      plan: [],
    });
    render(
      <ToastProvider>
        <StoreProvider initial={data} persist={false} fixedNow={SUNDAY}>
          <WeeklyPlan onClose={() => undefined} onInbox={() => undefined} />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.getByText(/Vence dentro: faltan/)).toBeTruthy();
    expect(screen.queryByText(/Vence después: faltan/)).toBeNull();
  });
});
