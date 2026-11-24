import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Places } from "./components/Places.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import type { AppData } from "./model.js";
import { isPinned } from "./planning.js";
import { reducer, StoreProvider } from "./store.js";

const demoPlan = () => reducer(demoData(NOW), { type: "refresh", now: NOW }).plan;

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("vuelta 22: doble toque en «Guardar»", () => {
  it("Silos → Nueva: dos toques seguidos crean una sola actividad", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad" }));
    const sheet = screen.getByRole("dialog", { name: "Nueva actividad" });
    fireEvent.change(within(sheet).getByLabelText("Nombre"), { target: { value: "Doble toque" } });
    fireEvent.change(within(sheet).getByLabelText("Fecha límite"), {
      target: { value: "2026-11-20T10:00" },
    });
    const save = within(sheet).getByRole("button", { name: "Guardar" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(screen.getAllByText("Doble toque")).toHaveLength(1);
  });
});

describe("vuelta 22: Deshacer después de «Fijar acá»", () => {
  it("en la Semana: Deshacer el fijado no deja «soltar un bloque» ni un segundo Deshacer", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    const before = JSON.parse(JSON.stringify(demoPlan()));
    const pill = [...document.querySelectorAll<HTMLElement>(".pill.planned:not(.past)")].at(
      -1,
    ) as HTMLElement;
    fireEvent.click(pill, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Fijar acá" }));
    expect(screen.getByRole("button", { name: "Deshacer: mover o fijar un bloque" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    // Nothing left to undo: no «soltar un bloque» on top.
    expect(screen.queryByRole("button", { name: /Deshacer: / })).toBeNull();
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins ?? []).toEqual([]);
    expect(saved.planHistory ?? []).toHaveLength(0);
    expect(saved.plan).toEqual(before);
  });

  it("deshacer un fijado vuelve exactamente al plan previo, sin dejar otra versión", () => {
    const d0 = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d0.plan.find((b) => b.start > NOW + 3_600_000 && !isPinned(b));
    if (!block) throw new Error("sin bloque");
    const pinned = reducer(d0, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    expect(pinned.planHistory?.at(-1)?.label).toBe("mover o fijar un bloque");
    const undone = reducer(pinned, { type: "undoPlan", now: NOW });
    expect(undone.plan).toEqual(d0.plan);
    expect(undone.pins ?? []).toEqual(d0.pins ?? []);
    expect(undone.planHistory ?? []).toHaveLength(0);
  });
});

describe("vuelta 22: Lugares en ómnibus sin dirección", () => {
  const casa = { id: "casa", name: "Casa", aliases: [], isHome: true, address: "Rivera 1234" };
  const trabajo = { id: "trab", name: "Trabajo", aliases: [], travelMode: "bus" as const };
  const withPlaces = (): AppData => ({ ...demoData(NOW), places: [casa, trabajo] });

  it("avisa bajo el campo que no se puede calcular el viaje, y se va con la dirección", () => {
    render(
      <StoreProvider initial={withPlaces} persist={false} fixedNow={NOW}>
        <Places />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar Trabajo" }));
    expect(screen.getByText(/Sin dirección no se puede calcular el viaje en ómnibus/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Dirección/), { target: { value: "18 de Julio 1" } });
    expect(screen.queryByText(/Sin dirección no se puede calcular/)).toBeNull();
    // En auto no hace falta avisar.
    fireEvent.change(screen.getByLabelText(/Dirección/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(screen.queryByText(/Sin dirección no se puede calcular/)).toBeNull();
  });

  it("la lista dice cuál es la casa y el modo de cada lugar", () => {
    render(
      <StoreProvider initial={withPlaces} persist={false} fixedNow={NOW}>
        <Places />
      </StoreProvider>,
    );
    const rows = [...document.querySelectorAll(".place-row")].map((r) => r.textContent ?? "");
    expect(rows.find((r) => r.includes("Casa"))).toMatch(/Casa · +Auto/);
    expect(rows.find((r) => r.includes("Trabajo"))).toMatch(/Trabajo · +Ómnibus.*Sin dirección/);
  });
});

describe("vuelta 22: Bajas baratas", () => {
  it("las hojas cerradas de Ajustes siguen montadas pero ocultas e inertes", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    const pages = [...document.querySelectorAll<HTMLElement>(".settings-page")];
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.hidden).toBe(true);
      expect(p.hasAttribute("inert")).toBe(true);
    }
  });

  it("una entrega archivada dice cuándo era", () => {
    const d0 = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const t = d0.tasks.find((x) => x.kind === "deliverable" && x.deadline !== undefined);
    if (!t) throw new Error("sin entrega");
    const d = reducer(d0, { type: "saveTask", task: { ...t, status: "dropped" }, now: NOW });
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver archivadas/ }));
    expect(screen.getByLabelText("Archivadas").textContent).toMatch(/(Entrega|Venció el) /);
  });
});

describe("vuelta 22: el mismo «Agregar» dos veces seguidas", () => {
  it("la misma materia o rutina nueva no se agrega dos veces", () => {
    const d0 = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const act = (id: string) => ({
      id,
      name: "Física",
      color: "#123456",
      academic: true,
      kind: "materia" as const,
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    });
    const once = reducer(d0, { type: "saveActivity", activity: act("a1"), now: NOW });
    const twice = reducer(once, { type: "saveActivity", activity: act("a2"), now: NOW });
    expect(twice.activities.filter((a) => a.name === "Física")).toHaveLength(1);
    const r = {
      type: "saveRoutine" as const,
      name: "Correr",
      sessionsPerWeek: 3,
      sessionMinutes: 30,
    };
    const r2 = reducer(reducer(twice, { ...r, now: NOW }), { ...r, now: NOW });
    expect(r2.activities.filter((a) => a.name === "Correr")).toHaveLength(1);
    expect(r2.tasks.filter((t) => t.title === "Correr")).toHaveLength(1);
  });

  it("Silos → Nueva: dos toques dentro del mismo turno crean una sola actividad", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad" }));
    const sheet = screen.getByRole("dialog", { name: "Nueva actividad" });
    fireEvent.change(within(sheet).getByLabelText("Nombre"), { target: { value: "Tanda" } });
    fireEvent.change(within(sheet).getByLabelText("Fecha límite"), {
      target: { value: "2026-11-20T10:00" },
    });
    const save = within(sheet).getByRole("button", { name: "Guardar" });
    act(() => {
      save.click();
      save.click();
    });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.tasks.filter((t) => t.title === "Tanda")).toHaveLength(1);
  });
});

describe("filas de Lugares", () => {
  it("la línea de dirección es solo la dirección: sin alias, sin «Tu casa»", () => {
    const data = {
      ...demoData(NOW),
      places: [
        {
          id: "f",
          name: "Casa Fran",
          aliases: ["juntada patas?", "piscinada"],
          address: "Bulevar  Artigas 1500, Montevideo",
        },
        { id: "h", name: "Casa", aliases: [], isHome: true, travelMode: "bus" as const },
      ],
    };
    render(
      <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
        <Places />
      </StoreProvider>,
    );
    const rows = [...document.querySelectorAll(".place-row")];
    expect(rows.at(0)?.querySelector(".place-line")?.textContent).toMatch(/^Casa Fran · +Auto$/);
    expect(rows.at(0)?.querySelector(".place-addr")?.textContent).toBe(
      "Bulevar Artigas 1500, Montevideo",
    );
    expect(rows.at(0)?.textContent).not.toMatch(/piscinada|juntada/);
    expect(rows.at(1)?.querySelector(".place-line")?.textContent).toMatch(/Casa · .*Ómnibus/);
    expect(rows.at(1)?.querySelector(".place-addr")?.textContent).toBe("Sin dirección");
    expect(document.body.textContent).not.toMatch(/Tu casa/);
  });
});
