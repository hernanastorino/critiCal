import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstStepsCard } from "./components/FirstSteps.js";
import { isGhostTap, notePress } from "./components/modal.js";
import { Places } from "./components/Places.js";
import { Routines } from "./components/Preferences.js";
import { Settings } from "./components/Settings.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { Week } from "./components/Week.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { addDays, weekdayOf, zonedInstant } from "./engine.js";
import { isBlank, stripInvisible } from "./limits.js";
import type { AppData } from "./model.js";
import { freezeMeals } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";

// 27.ª vuelta del agente atacante (modo demo, 375×812).
const DAY = "2026-11-23"; // lunes
const NOW = zonedInstant(TIMEZONE, DAY, 60 + 42);
const HIDDEN = "\u202e\u200b\u200c";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const inside = (ui: React.ReactNode, initial: (now: number) => AppData = demoData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

describe("MEDIA 1: la comida de hoy que ya empezó no desaparece al volver Mi semana", () => {
  const dayWith = (d: AppData, wake: number, bed: number, breakfast: number) => ({
    ...d.settings,
    week: d.settings.week.map((w, i) =>
      i === weekdayOf(DAY)
        ? {
            ...w,
            wake,
            bed,
            meals: w.meals.map((m) =>
              m.kind === "desayuno" ? { ...m, start: breakfast, end: breakfast + 30 } : m,
            ),
          }
        : w,
    ),
  });
  const reverted = () => {
    const fresh = freezeMeals(demoData(NOW), NOW);
    const early = reducer(fresh, {
      type: "settings",
      settings: dayWith(fresh, 60, 22 * 60 + 30, 90),
      now: NOW,
    });
    return reducer(early, {
      type: "settings",
      settings: dayWith(early, 7 * 60 + 30, 0, 7 * 60 + 30),
      now: NOW,
    });
  };

  it("la Semana sigue dibujando el desayuno de las 01:30 (la grilla se ensancha)", () => {
    const data = reverted();
    render(
      <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Week day={DAY} onSettings={() => {}} />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.getByRole("button", { name: /^Desayuno, lun 01:30 a 02:00/ })).toBeTruthy();
    // Los demás días siguen con su horario.
    expect(screen.getByRole("button", { name: /^Desayuno, mar 07:30 a 08:00/ })).toBeTruthy();
  });

  it("el motor lo conserva en el tramo de hoy", () => {
    const run = (reverted().mealRuns ?? []).find(
      (r) => r.meal === "desayuno" && r.weekday === weekdayOf(DAY) && r.from === DAY,
    );
    expect(run?.start).toBe(90);
    expect(addDays(DAY, 1)).toBe("2026-11-24");
  });
});

describe("MEDIA 2: nombres de solo caracteres invisibles", () => {
  it("isBlank y stripInvisible los toman por vacíos", () => {
    expect(isBlank(HIDDEN)).toBe(true);
    expect(isBlank(`${HIDDEN} \u2060\u3164\u2800`)).toBe(true);
    expect(isBlank("Gym")).toBe(false);
    expect(stripInvisible(HIDDEN)).toBe("");
    expect(stripInvisible(`A${HIDDEN}B`)).toBe("A B");
  });

  it("Lugares no guarda un nombre invisible", () => {
    inside(<Places />);
    const before = latest?.places?.length ?? 0;
    fireEvent.click(screen.getByRole("button", { name: /Agregar lugar/ }));
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: HIDDEN } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(latest?.places?.length ?? 0).toBe(before);
  });

  it("Silos > Nueva no guarda un título invisible", () => {
    const onClose = vi.fn();
    inside(<TaskEditor onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: HIDDEN } });
    const before = latest?.tasks.length;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(latest?.tasks.length).toBe(before);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Rutinas dice que el nombre está vacío y no lo muestra con el RLO", () => {
    inside(<Routines />);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    const field = screen.getByLabelText("Rutina") as HTMLInputElement;
    fireEvent.change(field, { target: { value: `\u202eGym${HIDDEN}` } });
    expect(field.value.includes("\u202e")).toBe(false);
  });
});

describe("BAJAS", () => {
  it("«Saltar por ahora» deja pasar el segundo toque de un doble toque", () => {
    render(
      <StoreProvider initial={emptyData} persist={false} fixedNow={NOW}>
        <FirstStepsCard google={false} onSettings={vi.fn()} />
      </StoreProvider>,
    );
    notePress(100, 200);
    fireEvent.click(screen.getByRole("button", { name: "Saltar por ahora" }));
    const second = { isTrusted: true, target: document.body, clientX: 102, clientY: 201 };
    expect(isGhostTap(second)).toBe(true);
  });

  it("el buscador de Ajustes cita la búsqueda sin RLO ni invisibles", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
        <Settings onClose={() => {}} onReset={() => {}} onSignOut={() => {}} />
      </StoreProvider>,
    );
    const box = screen.getByRole("searchbox", { name: "Buscar un ajuste" });
    fireEvent.change(box, { target: { value: "\u202ezzzqq\u200b" } });
    const text = screen.getByText(/No hay ningún ajuste con/).textContent ?? "";
    expect(text).toBe("No hay ningún ajuste con «zzzqq».");
  });

  it("Silos > Nueva: etiquetas asociadas a sus campos", () => {
    inside(<TaskEditor onClose={() => {}} />);
    for (const label of ["Horas estimadas", "Mínimo (horas)"]) {
      const input = screen.getByLabelText(label);
      expect(input.id).toBeTruthy();
      expect(document.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    }
    const exam = screen.getByLabelText(/^Es un parcial/);
    expect(document.querySelector(`label[for="${exam.id}"]`)).toBeTruthy();
  });

  it("Mi semana: «Me levanto» y «Me acuesto» tienen su etiqueta asociada", async () => {
    const { WeekSettings } = await import("./components/Preferences.js");
    inside(<WeekSettings />);
    for (const label of ["Me levanto", "Me acuesto"]) {
      const input = screen.getByLabelText(label);
      expect(document.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    }
  });

  it("con una hoja abierta la Semana de fondo queda inert", async () => {
    inside(
      <>
        <main>
          <Week day={DAY} onSettings={() => {}} />
        </main>
        <Settings onClose={() => {}} onReset={() => {}} onSignOut={() => {}} />
      </>,
    );
    await act(async () => {});
    const main = document.querySelector("main") as HTMLElement;
    expect(main.querySelector(".week")).toBeTruthy();
    expect(main.inert).toBe(true);
  });
});
