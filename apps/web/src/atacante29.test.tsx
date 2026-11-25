import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, AppTask } from "./model.js";
import { pendingConfirmations, splitPastSilos } from "./planning.js";
import { reducer, StoreProvider, seedHistory } from "./store.js";

// 29.ª vuelta del agente atacante (modo demo, 375×812).
const at = (day: string, hour: number) => zonedInstant(TIMEZONE, day, hour * 60);
const NOW = at("2026-11-23", 15);
const noop = () => undefined;
const casa = { id: "casa", name: "Casa", aliases: [], isHome: true };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  sessionStorage.clear();
});
afterEach(cleanup);

const inside = (ui: React.ReactNode, initial: () => AppData, fixedNow = NOW) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={fixedNow}>
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

describe("ALTA 1: «faltan» se mide por partes y la pantalla lo dice", () => {
  it("un «Hecho» de la Bandeja cuenta en lo hecho de la semana pero no baja «faltan»", () => {
    inside(<Silos />, () => seedHistory(demoData(NOW), NOW));
    expect(screen.getByText("Esta semana: hecho / planificado")).toBeTruthy();
    expect(screen.getByLabelText(/^Parcial Cálculo II: faltan 10h/)).toBeTruthy();
    expect(screen.queryByText(/«faltan» baja al marcar/)).toBeNull();
  });
});

describe("ALTA 2: cambiar la hora de levantarse no deja bloques futuros de madrugada", () => {
  it("los bloques que todavía no empezaron salen de antes de la nueva hora", () => {
    const now = at("2026-11-23", 3);
    let d = demoData(now);
    d = {
      ...d,
      tasks: d.tasks.map((t, i) =>
        i === 0
          ? { ...t, estimateMinutes: 3000, minMinutes: 2000, deadline: at("2026-11-23", 20) }
          : t,
      ),
    };
    d = reducer(d, { type: "refresh", now });
    d = reducer(d, {
      type: "override",
      now,
      override: { date: "2026-11-23", wake: 120, bed: 0 },
    });
    // Study of the early morning, as set.
    expect(d.plan.some((b) => b.start > now && b.start < at("2026-11-23", 7.5))).toBe(true);
    const later = at("2026-11-23", 3 + 10 / 60);
    d = reducer(d, {
      type: "override",
      now: later,
      override: { date: "2026-11-23", wake: 450, bed: 0 },
    });
    expect(d.plan.some((b) => b.start > later && b.start < at("2026-11-23", 7.5))).toBe(false);
    // Lo que ya había pasado antes de esa hora queda «dormías»: no va a «¿Cómo te fue?».
    expect(pendingConfirmations(d, later).some((b) => b.start < at("2026-11-23", 7.5))).toBe(false);
  });
});

describe("MEDIA 3: «anteriores» solo lo que ya venció", () => {
  const task = (id: string, deadline: number): AppTask => ({
    id,
    activityId: "fis",
    title: id,
    kind: "deliverable",
    deadline,
    estimateMinutes: 60,
    minMinutes: 30,
    priority: 2,
    status: "active",
    units: [],
  });
  const p = (id: string, deadline: number) => ({
    task: task(id, deadline),
    totalMinutes: 60,
    remainingMinutes: 60,
    minRemainingMinutes: 30,
    deadline,
  });

  it("con la semana próxima planeada, lo que vence esta semana sigue vigente", () => {
    const planned = (): AppData => {
      const d = demoData(NOW);
      const physics = d.activities.find((a) => a.name === "Física I");
      const entrega: AppTask = {
        ...task("parcial-fisica", at("2026-11-26", 18)),
        activityId: physics?.id ?? "fis",
        title: "PARCIAL física i",
        estimateMinutes: 99 * 60,
        minMinutes: 50 * 60,
      };
      return {
        ...d,
        tasks: [...d.tasks, entrega],
        settings: { ...d.settings, weekPlannedFor: "2026-11-30" },
      };
    };
    inside(<Silos />, planned);
    expect(screen.getByLabelText(/^PARCIAL física i: faltan/)).toBeTruthy();
    expect(screen.queryByText(/Ver anteriores/)).toBeNull();
  });

  it("split: lo de hoy en adelante es vigente y lo de antes de la semana, anterior", () => {
    const now = at("2026-11-23", 15);
    const { current, past } = splitPastSilos(
      [
        p("hoy", at("2026-11-23", 9)),
        p("jueves", at("2026-11-26", 18)),
        p("viejo", at("2026-11-10", 9)),
      ],
      TIMEZONE,
      now,
    );
    expect(current.map((x) => x.task.id)).toEqual(["hoy", "jueves"]);
    expect(past.map((x) => x.task.id)).toEqual(["viejo"]);
  });
});

describe("MEDIA 4: la Planificación semanal aclara de qué semana es la Bandeja", () => {
  const pending: AppEvent = {
    id: "x",
    title: "Zoom",
    start: at("2026-11-24", 10),
    end: at("2026-11-24", 11),
    busy: true,
    source: "google",
  };
  it("con pendientes, ofrece el botón sin notas explicativas", () => {
    inside(
      <WeeklyPlan onClose={noop} onInbox={noop} />,
      () => ({ ...emptyData(), places: [casa], events: [pending] }),
      at("2026-11-22", 18),
    );
    expect(screen.queryByText(/Lo de la Bandeja es de esta semana/)).toBeNull();
    expect(screen.getByRole("button", { name: /Ver la Bandeja/ })).toBeTruthy();
  });
  it("sin pendientes no hay aviso ni botón", () => {
    inside(<WeeklyPlan onClose={noop} onInbox={noop} />, () => emptyData(), at("2026-11-22", 18));
    expect(screen.queryByText(/Lo de la Bandeja/)).toBeNull();
  });
});

describe("MEDIA 5: «No hace falta traslado» se puede deshacer", () => {
  it("ofrece «Deshacer» y la pregunta vuelve", () => {
    const event: AppEvent = {
      id: "x",
      title: "Zoom",
      start: at("2026-11-23", 17),
      end: at("2026-11-23", 18),
      busy: true,
      source: "google",
    };
    inside(<Inbox />, () => ({ ...emptyData(), places: [casa], events: [event] }));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "No hace falta traslado" }));
    });
    expect(screen.queryByText("¿Dónde es?")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    });
    expect(screen.getByText("¿Dónde es?")).toBeTruthy();
  });
});
