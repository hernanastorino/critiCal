import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { addDays, localParts, weekdayOf, zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { pinRefusal } from "./moveBounds.js";
import { weekStart } from "./planning.js";
import { refresh } from "./refresh.js";
import { reducer, seedHistory } from "./store.js";

// 43.ª vuelta: un bloque de una rutina que se suelta donde la rutina no va (por ejemplo
// «No ese día») vuelve a su lugar con un aviso, no desaparece de la semana.
const FIXED = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
// La fecha real: el lunes de la semana de hoy, para tener toda la semana por delante.
const REAL = zonedInstant(TIMEZONE, weekStart(TIMEZONE, Date.now()), 8 * 60);
const NOWS = [
  ["fecha fija", FIXED],
  ["fecha real", REAL],
] as const;

const start = (now: number) => refresh(seedHistory(pruebasData(now), now), now);
const gymId = (d: AppData) => d.tasks.find((t) => /^gym$/i.test(t.title))?.id;
const gymBlocks = (d: AppData, now: number) =>
  d.plan.filter((b) => b.taskId === gymId(d) && b.start > now);
const at = (date: string, hour: number) => zonedInstant(TIMEZONE, date, hour * 60);
const weekdayDate = (now: number, weekday: number) =>
  addDays(weekStart(TIMEZONE, now), (weekday + 6) % 7);
const pinsOf = () =>
  (JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData).pins ?? [];

describe("pinRefusal", () => {
  it.each(NOWS)(
    "%s: un día «No ese día» se rechaza con el motivo",
    { timeout: 60_000 },
    (_n, now) => {
      const d = start(now);
      const gym = gymBlocks(d, now).at(0);
      if (!gym) throw new Error("sin Gym");
      expect(pinRefusal(d, now, gym, at(weekdayDate(now, 0), 18))).toBe(
        "Gym no va los domingos: vuelve a su lugar",
      );
      expect(pinRefusal(d, now, gym, at(weekdayDate(now, 6), 18))).toBe(
        "Gym no va los sábados: vuelve a su lugar",
      );
    },
  );

  it.each(NOWS)(
    "%s: fuera de la franja pero en un día válido se deja fijado",
    {
      timeout: 60_000,
    },
    (_n, now) => {
      const d = start(now);
      const gym = gymBlocks(d, now).at(0);
      if (!gym) throw new Error("sin Gym");
      expect(pinRefusal(d, now, gym, at(weekdayDate(now, 5), 18))).toBeNull();
    },
  );

  it("lo que no es una rutina no se rechaza", { timeout: 60_000 }, () => {
    const d = start(FIXED);
    const other = d.plan.find((b) => b.taskId !== gymId(d) && b.start > FIXED);
    if (!other) throw new Error("sin otro bloque");
    expect(pinRefusal(d, FIXED, other, at(weekdayDate(FIXED, 0), 18))).toBeNull();
  });
});

describe("Semana: la rutina suelta en un día que no va vuelve a su lugar", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
    // Columnas de 50px en el orden en que se dibujan: lunes a domingo.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const cols = [...document.querySelectorAll<HTMLElement>("[data-date]")];
      const i = cols.indexOf(this);
      const box = i >= 0 ? { left: i * 50, right: i * 50 + 50, top: 0, bottom: 1000 } : null;
      const own = box ?? { left: 0, right: 30, top: 100, bottom: 160 };
      return {
        ...own,
        width: own.right - own.left,
        height: own.bottom - own.top,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      };
    });
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const gymPill = (d: AppData, now: number) => {
    const first = gymBlocks(d, now).at(0);
    if (!first) throw new Error("sin Gym");
    const tz = d.settings.timezone;
    const day = localParts(tz, first.start);
    const label = new RegExp(
      `^Gym, .* ${String(Math.floor(day.minuteOfDay / 60)).padStart(2, "0")}:`,
    );
    const pills = [...document.querySelectorAll<HTMLElement>(".pill.planned.movable")];
    const pill = pills.find((p) => label.test(p.getAttribute("aria-label") ?? ""));
    if (!pill) throw new Error("sin pastilla de Gym");
    return pill;
  };

  /** El puntero que suelta a las 18:00 en la columna de `weekday` (lunes = 0 columnas). */
  const spotOn = (d: AppData, weekday: number) => {
    const week = d.settings.week;
    const startMin = Math.min(...week.map((w) => w.wake));
    const endMin = Math.max(...week.map((w) => (w.bed <= w.wake ? w.bed + 1440 : w.bed)));
    return {
      x: ((weekday + 6) % 7) * 50 + 25,
      y: ((18 * 60 - startMin) / (endMin - startMin)) * 1000 + 10,
    };
  };

  it.each(NOWS)(
    "%s: arrastrarlo al domingo lo deja donde estaba y avisa",
    {
      timeout: 120_000,
    },
    (_n, now) => {
      const d = start(now);
      render(<App fixedNow={now} initial={() => d} />);
      fireEvent.click(screen.getByLabelText("Modo edición"));
      const pill = gymPill(d, now);
      const before = gymBlocks(d, now).length;
      const { x, y } = spotOn(d, 0);
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 1 });
      fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 1 });
      fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 1 });
      expect(screen.getByText("Gym no va los domingos: vuelve a su lugar")).toBeTruthy();
      expect(pinsOf()).toEqual([]);
      expect(document.querySelectorAll(".pill.pinned")).toHaveLength(0);
      expect(document.contains(pill)).toBe(true);
      // Sin ↶: nada que deshacer, la semana no cambió.
      expect(screen.queryAllByRole("button", { name: "Deshacer" })).toHaveLength(0);
      expect(gymBlocks(reducer(d, { type: "refresh", now }), now)).toHaveLength(before);
    },
  );

  it.each(NOWS)(
    "%s: el sábado también vuelve; el día válido, aunque fuera de franja, queda fijado",
    {
      timeout: 120_000,
    },
    (_n, now) => {
      const d = start(now);
      render(<App fixedNow={now} initial={() => d} />);
      fireEvent.click(screen.getByLabelText("Modo edición"));
      const pill = gymPill(d, now);
      const sat = spotOn(d, 6);
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 1 });
      fireEvent.pointerMove(pill, { clientX: sat.x, clientY: sat.y, pointerId: 1 });
      fireEvent.pointerUp(pill, { clientX: sat.x, clientY: sat.y, pointerId: 1 });
      expect(screen.getByText("Gym no va los sábados: vuelve a su lugar")).toBeTruthy();
      expect(pinsOf()).toEqual([]);
      // Un día válido: el jueves a las 18:00 queda fijado, como siempre.
      const thu = spotOn(d, 4);
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 2 });
      fireEvent.pointerMove(pill, { clientX: thu.x, clientY: thu.y, pointerId: 2 });
      fireEvent.pointerUp(pill, { clientX: thu.x, clientY: thu.y, pointerId: 2 });
      expect(pinsOf()).toHaveLength(1);
      expect(weekdayOf(localParts(TIMEZONE, pinsOf()[0]?.start ?? 0).date)).toBe(4);
    },
  );

  it.each(NOWS)(
    "%s: con las flechas, del viernes al sábado vuelve a su lugar",
    {
      timeout: 120_000,
    },
    (_n, now) => {
      const base = start(now);
      const gym = gymBlocks(base, now).at(0);
      if (!gym) throw new Error("sin Gym");
      const friday = weekdayDate(now, 5);
      const d = reducer(base, { type: "pin", blockId: gym.id, start: at(friday, 12), now });
      expect(d.pins).toHaveLength(1);
      render(<App fixedNow={now} initial={() => d} />);
      fireEvent.click(screen.getByLabelText("Modo edición"));
      const pill = document.querySelector<HTMLElement>(".pill.pinned");
      if (!pill) throw new Error("sin bloque fijado");
      pill.focus();
      fireEvent.keyDown(pill, { key: "ArrowRight" });
      expect(screen.getByText("Gym no va los sábados: vuelve a su lugar")).toBeTruthy();
      expect(document.querySelectorAll(".pill.pinned")).toHaveLength(1);
      expect(document.querySelector(".pill.pinned")?.getAttribute("aria-label")).toMatch(
        /vie 12:00/,
      );
    },
  );
});
