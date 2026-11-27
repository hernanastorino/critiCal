import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { DetectedDefaults } from "./components/Preferences.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { addDays, localParts, zonedInstant } from "./engine.js";
import { inboxRows } from "./inbox.js";
import type { AppData, AppEvent, AppTask, Place } from "./model.js";
import { mealOffers, mealOutOfOrder, mealTimes } from "./planning.js";
import { StoreProvider, useStore } from "./store.js";
import { sessionShown } from "./taskForm.js";

// 41.ª vuelta: comidas a mano sobre un evento, orden de comidas, duración de rutinas y
// horas de lo detectado (decisiones del 2026-11-27).
const FIXED = zonedInstant(TIMEZONE, "2026-11-02", 8 * 60);
const REAL = zonedInstant(TIMEZONE, localParts(TIMEZONE, Date.now()).date, 8 * 60);
const NOWS = [
  ["fecha fija", FIXED],
  ["fecha real", REAL],
] as const;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const dayOf = (now: number) => addDays(localParts(TIMEZONE, now).date, 1);
const at = (date: string, minute: number) => zonedInstant(TIMEZONE, date, minute);

const casa: Place = {
  id: "casa",
  name: "Casa",
  aliases: [],
  isHome: true,
  lat: -34.9,
  lon: -56.19,
};
const club: Place = { id: "club", name: "Club", aliases: [], lat: -34.89, lon: -56.26 };

/** Mañana: un taller de 20:30 a 22:00 y la cena puesta a mano a las 21:00, encima. */
const scenario =
  (extra: Partial<AppData> = {}) =>
  (now: number): AppData => {
    const date = dayOf(now);
    const taller: AppEvent = {
      id: "taller",
      title: "Taller",
      start: at(date, 20 * 60 + 30),
      end: at(date, 22 * 60),
      busy: true,
      location: "Club",
      source: "demo",
    };
    return {
      ...demoData(now),
      events: [taller],
      places: [casa, club],
      travelTimes: [
        { from: "casa", to: "club", minutes: 20, manual: true },
        { from: "club", to: "casa", minutes: 20, manual: true },
      ],
      preferences: { holidaysOff: false },
      mealChoices: [{ date, kind: "cena", start: 21 * 60 }],
      ...extra,
    };
  };

describe("1. Comida a mano sobre un evento: se queda y se pregunta una vez", () => {
  it.each(NOWS)("%s: la Bandeja ofrece mover la cena a un hueco libre", (_n, now) => {
    const data = scenario()(now);
    const date = dayOf(now);
    const dinner = mealTimes(data, now, now, now + 3 * 86_400_000).find(
      (m) => m.date === date && m.kind === "cena",
    );
    // Se queda encima del evento.
    expect(dinner?.chosen).toBe(true);
    expect(dinner?.at?.start).toBe(at(date, 21 * 60));
    const [offer] = mealOffers(data, now);
    expect(offer?.kind).toBe("cena");
    expect(offer?.date).toBe(date);
    expect(offer?.to).not.toBe(at(date, 21 * 60));
    expect(inboxRows(data, now).some((r) => r.title.startsWith("¿Movés Cena a "))).toBe(true);
  });

  it.each(NOWS)("%s: una vez respondida no vuelve a preguntar", (_n, now) => {
    const date = dayOf(now);
    const data = scenario({ mealChoices: [{ date, kind: "cena", start: 21 * 60, asked: true }] })(
      now,
    );
    expect(mealOffers(data, now)).toEqual([]);
    expect(inboxRows(data, now).some((r) => r.title.startsWith("¿Movés"))).toBe(false);
  });

  it("una comida a mano en un lugar libre no pregunta", () => {
    const date = dayOf(FIXED);
    const data = scenario({ mealChoices: [{ date, kind: "cena", start: 19 * 60 }] })(FIXED);
    expect(mealOffers(data, FIXED)).toEqual([]);
  });

  it("una comida que puso el plan no pregunta: se mueve sola", () => {
    const date = dayOf(FIXED);
    const data = scenario({ mealChoices: [] })(FIXED);
    const dinner = mealTimes(data, FIXED, FIXED, FIXED + 3 * 86_400_000).find(
      (m) => m.date === date && m.kind === "cena",
    );
    expect(dinner?.chosen).toBeUndefined();
    expect(mealOffers(data, FIXED)).toEqual([]);
  });

  const open = (now: number) => {
    render(<App fixedNow={now} initial={scenario()} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
  };

  it("«Mover» la lleva al hueco, deja ↶ y no vuelve a preguntar", () => {
    open(FIXED);
    const title = screen.getByText(/^¿Movés Cena a \d\d:\d\d\?/).textContent ?? "";
    const hhmm = /(\d\d:\d\d)/.exec(title)?.[1] ?? "";
    fireEvent.click(screen.getByRole("button", { name: `Mover Cena a ${hhmm}` }));
    expect(screen.queryByText(/^¿Movés/)).toBeNull();
    // El aviso ofrece deshacer y volver a preguntar.
    fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }));
    expect(screen.getByText(/^¿Movés Cena a/)).toBeTruthy();
  });

  it("«Dejarla ahí» la deja donde está y no vuelve a preguntar", () => {
    open(FIXED);
    fireEvent.click(screen.getByRole("button", { name: "Dejarla ahí" }));
    expect(screen.queryByText(/^¿Movés/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Dejarla ahí" })).toBeNull();
  });
});

describe("2. Las comidas guardan su orden", () => {
  // Sábado: desayuno, almuerzo y cena de la demo.
  const SAT = zonedInstant(TIMEZONE, "2026-11-28", 8 * 60);
  const date = "2026-11-28";
  const times = (d: AppData, now: number) =>
    mealTimes(d, now, at(date, 0), at(date, 1440)).filter((m) => m.date === date);

  it.each(NOWS)("%s: mealOutOfOrder dice cuándo pasa a otra comida", (_n, now) => {
    const d = demoData(now);
    const day = dayOf(now);
    const meals = mealTimes(d, now, at(day, 0), at(day, 1440)).filter((m) => m.date === day);
    const lunch = meals.find((m) => m.kind === "almuerzo");
    const dinner = meals.find((m) => m.kind === "cena");
    expect(lunch?.at && dinner?.at).toBeTruthy();
    if (!lunch?.at || !dinner?.at) return;
    const length = (lunch.at.end - lunch.at.start) / 60_000;
    // El almuerzo antes de las 6 de la mañana pasa al desayuno; después de la cena también.
    expect(mealOutOfOrder(d, now, day, "almuerzo", 6 * 60, length)).toBe(true);
    expect(mealOutOfOrder(d, now, day, "almuerzo", 23 * 60, length)).toBe(true);
    const mid = Math.round((lunch.at.start - at(day, 0)) / 60_000) + 15;
    expect(mealOutOfOrder(d, now, day, "almuerzo", mid, length)).toBe(false);
  });

  it("sábado: «Mover a» 09:15 el almuerzo avisa y vuelve a su lugar, sin ↶", () => {
    render(<App fixedNow={SAT} initial={demoData} />);
    const before = times(demoData(SAT), SAT).map((m) => `${m.kind}${m.at?.start}`);
    const lunch = document.querySelector('[aria-label^="Almuerzo, sáb"]');
    if (!lunch) throw new Error("falta el almuerzo");
    const label = lunch.getAttribute("aria-label");
    fireEvent.click(lunch);
    fireEvent.change(screen.getByLabelText("Mover almuerzo a"), { target: { value: "09:15" } });
    fireEvent.click(screen.getByText("Mover"));
    expect(screen.getByRole("alert").textContent).toContain("la comida vuelve a su lugar");
    expect(
      document.querySelector('[aria-label^="Almuerzo, sáb"]')?.getAttribute("aria-label"),
    ).toBe(label);
    expect(before.length).toBeGreaterThan(1);
  });

  it("sábado: «Mover a» 20:00 el almuerzo, que sería pasada la cena, vuelve a su lugar", () => {
    render(<App fixedNow={SAT} initial={demoData} />);
    const lunch = document.querySelector('[aria-label^="Almuerzo, sáb"]');
    if (!lunch) throw new Error("falta el almuerzo");
    fireEvent.click(lunch);
    fireEvent.change(screen.getByLabelText("Mover almuerzo a"), { target: { value: "23:00" } });
    fireEvent.click(screen.getByText("Mover"));
    expect(screen.getByRole("alert").textContent).toContain("la comida vuelve a su lugar");
  });
});

describe("3. La duración de una rutina es lo que ocupa en el plan", () => {
  it.each([
    [15, 30, "30 min (pediste 15 min)"],
    [100, 30, "2h (pediste 100 min)"],
    [90, 30, "90 min"],
    [60, 30, "60 min"],
    [45, 15, "45 min"],
    [20, 30, "30 min (pediste 20 min)"],
  ])("%i min con bloques de %i se ve «%s»", (minutes, slot, shown) => {
    expect(sessionShown(minutes, slot)).toBe(shown);
  });
});

let store: ReturnType<typeof useStore> | undefined;
function Probe() {
  store = useStore();
  return null;
}

describe("3b. La lista de Rutinas lo muestra", () => {
  it("una rutina de 100 min se lista como «2h (pediste 100 min)»", () => {
    const seed = (now: number): AppData => {
      const d = demoData(now);
      return {
        ...d,
        tasks: d.tasks.map((t) => (t.sessionMinutes === 90 ? { ...t, sessionMinutes: 100 } : t)),
      };
    };
    render(<App fixedNow={FIXED} initial={seed} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Rutinas/ }));
    expect(screen.getByText(/× 2h \(pediste 100 min\)/)).toBeTruthy();
  });
});

describe("4. Lo detectado sin aceptar toma las horas nuevas", () => {
  const parcial = (now: number): AppTask => ({
    id: "parcial-nuevo",
    activityId: "sd",
    title: "Parcial SD (del calendario)",
    kind: "deliverable",
    exam: true,
    deadline: now + 9 * 86_400_000,
    estimateMinutes: 300,
    minMinutes: 180,
    priority: 2,
    status: "active",
    needsReview: true,
    // Su evento ya no está entre los eventos de la cuenta.
    sourceEventId: "google:parcial-sd",
    units: [],
  });
  const seed = (now: number): AppData => {
    const d = demoData(now);
    return { ...d, tasks: [...d.tasks.filter((t) => t.id !== "parcial-nuevo"), parcial(now)] };
  };
  const change = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it.each(NOWS)("%s: Guardar horas cambia lo detectado y el botón lo cuenta", (_n, now) => {
    render(
      <ToastProvider>
        <StoreProvider initial={seed} persist={false} fixedNow={now}>
          <Probe />
          <DetectedDefaults />
        </StoreProvider>
      </ToastProvider>,
    );
    change("Horas de Parcial / examen", "8");
    change("Mínimo de Parcial / examen", "4");
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    const task = store?.data.tasks.find((t) => t.id === "parcial-nuevo");
    expect(task?.estimateMinutes).toBe(480);
    expect(task?.minMinutes).toBe(240);
    // Ya tomó las horas nuevas: no queda nada que volver.
    fireEvent.click(screen.getByRole("button", { name: "Volver todo lo detectado a estas horas" }));
    expect(screen.queryByText("No hay nada detectado para cambiar")).not.toBeNull();
  });

  it("«Volver todo lo detectado» cuenta lo detectado cuyo evento ya no está", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={seed} persist={false} fixedNow={FIXED}>
          <Probe />
          <DetectedDefaults />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Volver todo lo detectado a estas horas" }));
    expect(screen.queryByText("No hay nada detectado para cambiar")).toBeNull();
    expect(store?.data.tasks.find((t) => t.id === "parcial-nuevo")?.estimateMinutes).not.toBe(300);
  });
});
