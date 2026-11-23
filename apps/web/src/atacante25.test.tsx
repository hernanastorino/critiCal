import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { errorOf, roundTrip } from "./atacante11Kit.js";
import { BlockSheet } from "./components/BlockSheet.js";
import { Places } from "./components/Places.js";
import { Semester } from "./components/Semester.js";
import { ToastProvider } from "./components/Toast.js";
import { Week } from "./components/Week.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { stripBidi } from "./limits.js";
import type { AppData } from "./model.js";
import { pendingConfirmations } from "./planning.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";

// 25.ª vuelta del agente atacante (modo demo): las Bajas de §5.3.
const NOW = Date.UTC(2026, 10, 2, 20);
const LATER = zonedInstant(TIMEZONE, "2026-11-04", 17 * 60 + 50);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  sessionStorage.clear();
});
afterEach(cleanup);

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};

describe("Lugares: largo de dirección y alias", () => {
  const form = () => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
          <Places />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Agregar lugar/ }));
  };

  it("los campos de dirección y alias tienen tope, como el nombre", () => {
    form();
    const max = (label: RegExp) => Number(screen.getByLabelText(label).getAttribute("maxlength"));
    expect(max(/^Nombre/)).toBe(60);
    expect(max(/^Dirección/)).toBe(200);
    expect(max(/^Alias/)).toBe(500);
  });

  it("«Cancelar» con texto escrito pregunta; sin texto cierra directo", () => {
    form();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText(/^Nombre/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Agregar lugar/ }));
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Gym" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    const ask = screen.getByRole("alertdialog", { name: "¿Descartar los cambios?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Seguir editando" }));
    expect((screen.getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe("Gym");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByLabelText(/^Nombre/)).toBeNull();
  });

  it("el importador rechaza una dirección de más de 300 caracteres", () => {
    const d: AppData = {
      ...demoData(NOW),
      places: [{ id: "p1", name: "Facu", aliases: [], address: "x".repeat(301) }],
    };
    expect(errorOf(roundTrip(d))).toMatch(/dirección/);
    const ok = {
      ...d,
      places: [{ id: "p1", name: "Facu", aliases: [], address: "x".repeat(300) }],
    };
    expect(errorOf(roundTrip(ok))).toBe("");
  });
});

describe("«Guardar parcial» dos veces en el mismo instante", () => {
  it("anota un solo avance", () => {
    const d = seedHistory({ ...demoData(LATER), preferences: { holidaysOff: false } }, LATER);
    const b = pendingConfirmations(d, LATER).at(0);
    if (!b) throw new Error("falta un bloque");
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={LATER}>
        <ToastProvider>
          <Probe />
          <BlockSheet
            item={{ kind: "block", id: b.id, start: b.start, end: b.end, block: b }}
            onClose={() => {}}
          />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Parcial" }));
    const save = screen.getByRole("button", { name: "Guardar parcial" });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    expect(seen.store?.data.checkIns.filter((c) => c.blockId === b.id)).toHaveLength(1);
  });
});

describe("Ajustes: borradores uniformes", () => {
  const open = () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Rutinas/ }));
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Nadar" } });
  };

  it("Escape desde «Crear rutina nueva» pregunta; «Seguir editando» no pierde nada", () => {
    open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    const ask = screen.getByRole("alertdialog", { name: "¿Descartar los cambios?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Seguir editando" }));
    expect((screen.getByPlaceholderText("Gimnasio") as HTMLInputElement).value).toBe("Nadar");
  });

  it("«‹ Ajustes» pregunta y «Descartar» deja la lista de Ajustes sin el borrador", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Volver a Ajustes" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Rutinas/ }));
    expect(screen.queryByPlaceholderText("Gimnasio")).toBeNull();
  });

  it("sin nada escrito, Escape vuelve a la lista sin preguntar", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Rutinas/ }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBeTruthy();
  });
});

describe("Datos raros", () => {
  const at = (date: string) => zonedInstant(TIMEZONE, date, 10 * 60);
  const semester = (now: number) =>
    render(
      <StoreProvider initial={emptyData} persist={false} fixedNow={now}>
        <ToastProvider>
          <Semester />
          <Probe />
        </ToastProvider>
      </StoreProvider>,
    );

  it("un cuatrimestre de un día no se guarda", () => {
    semester(at("2026-08-01"));
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "2026-08-01" } });
    expect(screen.getByText(/dura más de un día/)).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar fechas"));
    expect(seen.store?.data.preferences?.semester).toBeUndefined();
  });

  it("un cuatrimestre que ya terminó no se guarda", () => {
    semester(at("2026-11-30"));
    fireEvent.change(screen.getByLabelText("Empieza"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "2026-07-01" } });
    expect(screen.getByText(/ya terminó/)).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar fechas"));
    expect(seen.store?.data.preferences?.semester).toBeUndefined();
  });

  it("la semana no se navega más allá de 2031 (el año máximo de las fechas)", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Week day="2031-12-22" onSettings={() => {}} />
        </ToastProvider>
      </StoreProvider>,
    );
    const next = screen.getByLabelText("Semana siguiente");
    for (let i = 0; i < 4; i++) fireEvent.click(next);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    // Otra vez no cambia nada: la semana queda donde está.
    const title = screen.getByRole("heading", { level: 1 }).textContent;
    fireEvent.click(next);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
  });

  it("la semana no se navega antes de 2000", () => {
    const now = zonedInstant(TIMEZONE, "2000-01-05", 10 * 60);
    render(<App fixedNow={now} initial={demoData} />);
    const prev = screen.getByLabelText("Semana anterior");
    for (let i = 0; i < 3; i++) fireEvent.click(prev);
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(/1999/)).toBeNull();
  });

  it("los nombres pierden los caracteres que cambian el sentido de la escritura", () => {
    expect(stripBidi("a‮bc⁦d⁩")).toBe("abcd");
    const d = demoData(NOW);
    const act0 = d.activities[0];
    if (!act0) throw new Error("falta materia");
    let out = reducer(d, {
      type: "saveActivity",
      activity: { ...act0, name: "Fís‮ica" },
      now: NOW,
    });
    expect(out.activities.find((a) => a.id === act0.id)?.name).toBe("Física");
    out = reducer(out, {
      type: "savePlace",
      place: { id: "p", name: "Ca‮sa", aliases: ["x⁧y"], address: "Calle‮ 1" },
      now: NOW,
    });
    const place = out.places?.find((p) => p.id === "p");
    expect([place?.name, place?.aliases, place?.address]).toEqual(["Casa", ["xy"], "Calle 1"]);
  });
});
