import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "./components/BlockSheet.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY, pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, AppTask } from "./model.js";
import { spotKey } from "./places.js";
import { type Action, loadDemo, reducer, StoreProvider, useStore } from "./store.js";
import { syllabusTasks } from "./syllabus.js";

// 41.ª vuelta: un toque de confirmación = una entrada del ↶ (SPEC §14), rótulos nuevos y
// abrir un evento con traslado no deja entrada. Se prueba con fecha fija y con la real.
const FIXED = zonedInstant(TIMEZONE, "2026-11-22", 10 * 60);
const REAL = Date.now();
const NOWS = [
  ["fecha fija", FIXED],
  ["fecha real", REAL],
] as const;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
});
afterEach(cleanup);

const must = <T,>(v: T | undefined): T => {
  if (v === undefined) throw new Error("missing");
  return v;
};
let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const stack = (d: AppData) => d.planHistory ?? [];
const undo = (d: AppData, now: number) => reducer(d, { type: "undoPlan", now });
const shown = (d: AppData, k: string) => {
  const v = Reflect.get(d, k);
  if (!Array.isArray(v)) return JSON.stringify(v);
  return v.length === 0 ? undefined : JSON.stringify(v.map((e) => JSON.stringify(e)).sort());
};
/** The parts of the data that differ (the history itself aside; the plan is derived). */
const differing = (a: AppData, b: AppData) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) =>
      !["planHistory", "mealRuns", "mealsFrozenThrough"].includes(k) && shown(a, k) !== shown(b, k),
  );
const withEvent = (now: number, title: string, location?: string): [AppData, AppEvent] => {
  const base = emptyData();
  const event: AppEvent = {
    id: "ev-1",
    title,
    start: now + 26 * 3_600_000,
    end: now + 27 * 3_600_000,
    busy: true,
    source: "google",
    ...(location && { location }),
  };
  const home = { id: "casa", name: "Casa", aliases: [], isHome: true, lat: -34.9, lon: -56.19 };
  return [{ ...base, events: [event], places: [home] }, event];
};

describe.each(NOWS)("un toque, una entrada (%s)", (_name, NOW) => {
  it("Bandeja: dirección nueva con minutos y «guardar como lugar» deja 1 entrada", () => {
    const [d, event] = withEvent(NOW, "Reunión", "Av. Italia 1234");
    const text = must(event.location);
    const typed = reducer(d, { type: "spots", results: [{ text, minutes: null }], now: NOW });
    const start = typed.spots?.length ? typed : d;
    const after = reducer(start, {
      type: "batch",
      label: "guardar Oficina",
      actions: [
        { type: "spotMinutes", text, minutes: 22 },
        { type: "saveSpot", key: spotKey(text), name: "Oficina" },
      ],
      now: NOW,
    });
    expect(after.places?.some((p) => p.name === "Oficina")).toBe(true);
    expect(stack(after)).toHaveLength(stack(start).length + 1);
    expect(must(stack(after).at(-1)).label).toBe("guardar Oficina");
    const back = undo(after, NOW);
    expect(stack(back)).toHaveLength(stack(start).length);
    expect(differing(back, start)).toEqual([]);
  });

  it("Importar programa: la materia y sus evaluaciones dejan 1 entrada", () => {
    const start = reducer(emptyData(), { type: "refresh", now: NOW });
    let n = 0;
    const { activity, isNew, tasks } = syllabusTasks({
      subject: "Química",
      activities: start.activities,
      assessments: [
        { title: "Parcial 1", kind: "parcial", date: "2026-12-10", units: [], minutes: 300 },
        { title: "Parcial 2", kind: "parcial", date: "2026-12-17", units: [], minutes: 240 },
        { title: "Entrega", kind: "entrega", date: "2026-12-20", units: [], minutes: 120 },
      ],
      timeZone: TIMEZONE,
      newId: () => `id-${++n}`,
      color: "#888888",
    });
    expect(isNew && tasks.length).toBe(3);
    const after = reducer(start, {
      type: "batch",
      label: "importar Química",
      actions: tasks.map((task: AppTask, i) => ({
        type: "saveTask",
        task,
        activity: i === 0 ? activity : undefined,
      })),
      now: NOW,
    });
    expect(after.tasks).toHaveLength(start.tasks.length + 3);
    expect(stack(after)).toHaveLength(stack(start).length + 1);
    expect(must(stack(after).at(-1)).label).toBe("importar Química");
    const back = undo(after, NOW);
    expect(stack(back)).toHaveLength(stack(start).length);
    expect(differing(back, start)).toEqual([]);
  });

  it("Me levanté: 1 entrada, con su hora", () => {
    const d = reducer(pruebasData(NOW), { type: "refresh", now: NOW });
    const date = new Date(NOW).toISOString().slice(0, 10);
    const after = reducer(d, {
      type: "override",
      override: { date, wake: 7 * 60 },
      label: "Me levanté a las 07:00",
      now: NOW,
    });
    expect(stack(after)).toHaveLength(stack(d).length + 1);
    expect(must(stack(after).at(-1)).label).toBe("Me levanté a las 07:00");
    expect(differing(undo(after, NOW), d)).toEqual([]);
  });
});

describe.each(NOWS)("rótulos nuevos (%s)", (_name, NOW) => {
  const start = () => reducer(pruebasData(NOW), { type: "refresh", now: NOW });
  const labelOf = (action: Action, d: AppData = start()) =>
    reducer(d, action).planHistory?.at(-1)?.label;

  it("ajustar el día pasa a «cambiar el plan de hoy»", () => {
    const date = new Date(NOW).toISOString().slice(0, 10);
    expect(labelOf({ type: "override", override: { date, bed: 23 * 60 }, now: NOW })).toBe(
      "cambiar el plan de hoy",
    );
  });

  it("una rutina nueva se llama «crear»", () => {
    const action: Action = {
      type: "saveRoutine",
      name: "Leer",
      sessionsPerWeek: 2,
      sessionMinutes: 60,
      now: NOW,
    };
    expect(labelOf(action)).toBe("crear Leer");
  });

  it("editar una tarea sigue siendo «guardar»", () => {
    const d = start();
    const task = must(d.tasks.at(0));
    expect(
      labelOf({ type: "saveTask", task: { ...task, title: "Otro nombre" }, now: NOW }, d),
    ).toBe("guardar Otro nombre");
  });

  it("clasificar: título del calendario y materia", () => {
    const d = start();
    expect(labelOf({ type: "classTitle", title: "Charla", as: "event", now: NOW }, d)).toBe(
      "clasificar Charla",
    );
    const fis = must(d.activities.find((a) => a.academic));
    expect(labelOf({ type: "sortActivity", activityId: fis.id, as: "rutina", now: NOW }, d)).toBe(
      `clasificar ${fis.name.slice(0, 24)}`,
    );
  });

  it("«Usar minutos» de la Bandeja nombra los minutos y el evento", () => {
    const [d, event] = withEvent(NOW, "Reunión", "Av. Italia 1234");
    const text = must(event.location);
    const after = reducer(d, {
      type: "spotMinutes",
      text,
      minutes: 15,
      label: "usar 15 min para Reunión",
      now: NOW,
    });
    expect(stack(after)).toHaveLength(1);
    expect(must(stack(after).at(-1)).label).toBe("usar 15 min para Reunión");
    expect(differing(undo(after, NOW), d)).toEqual([]);
  });
});

describe("la Bandeja deja una sola entrada con su rótulo", () => {
  const NOW = FIXED;
  const [base, event] = withEvent(NOW, "Reunión", "Av. Italia 1234");
  const text = must(event.location);
  const open = () =>
    render(
      <ToastProvider>
        <StoreProvider
          initial={() => ({ ...base, spots: [{ key: spotKey(text), text, failed: true }] })}
          persist={false}
          fixedNow={NOW}
        >
          <Spy />
          <Inbox />
        </StoreProvider>
      </ToastProvider>,
    );
  const typeMinutes = () => {
    fireEvent.change(screen.getByLabelText("O minutos desde casa para Reunión"), {
      target: { value: "20" },
    });
  };

  it("«Usar» sin guardar lugar: «usar 20 min para Reunión»", () => {
    open();
    typeMinutes();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    });
    expect(stack(must(latest)).map((v) => v.label)).toEqual(["usar 20 min para Reunión"]);
  });

  it("«Usar» con «Guardar como lugar»: una entrada «guardar Oficina»", async () => {
    open();
    typeMinutes();
    fireEvent.click(screen.getByRole("checkbox", { name: "Guardar como lugar" }));
    fireEvent.change(screen.getByLabelText("Nombre del lugar"), { target: { value: "Oficina" } });
    await act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    });
    expect(must(latest).places?.some((p) => p.name === "Oficina")).toBe(true);
    expect(stack(must(latest)).map((v) => v.label)).toEqual(["guardar Oficina"]);
  });
});

describe("abrir un evento con traslado no deja entrada en el ↶", () => {
  const NOW = zonedInstant(TIMEZONE, "2026-11-23", 8 * 60);
  /** The demo plus the events of the Demo de pruebas (Taller, Clase, Cumple de Sofi). */
  const everything = (): AppData => {
    const demo = loadDemo(NOW);
    const extra = pruebasData(NOW).events.filter((e) => !demo.events.some((x) => x.id === e.id));
    return { ...demo, events: [...demo.events, ...extra] };
  };
  const events = () =>
    ["Taller en el Cerro", "Clase en la Facultad", "Cumple de Sofi"].map((title) =>
      must(everything().events.find((e) => e.title === title && e.start > NOW)),
    );
  const open = (event: AppEvent) =>
    render(
      <ToastProvider>
        <StoreProvider initial={everything} persist={false} fixedNow={NOW}>
          <Spy />
          <BlockSheet
            item={{ kind: "event", id: event.id, start: event.start, end: event.end, event }}
            onClose={vi.fn()}
          />
        </StoreProvider>
      </ToastProvider>,
    );

  it.each([0, 1, 2])("el evento %i", { timeout: 30_000 }, async (i) => {
    const event = must(events().at(i));
    const view = open(event);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(stack(must(latest))).toHaveLength(0);
    view.unmount();
  });

  it("abrir los tres seguidos deja la pila vacía", { timeout: 30_000 }, async () => {
    for (const event of events()) {
      const view = open(event);
      await act(() => new Promise((r) => setTimeout(r, 50)));
      view.unmount();
    }
    expect(stack(must(latest))).toHaveLength(0);
  });

  it.each(NOWS)("el cálculo de ómnibus no es una acción (%s)", (_n, NOW2) => {
    const [d, event] = withEvent(NOW2, "Clase");
    const after = reducer(d, {
      type: "tripMinutes",
      eventId: event.id,
      minutes: 35,
      start: event.start,
      now: NOW2,
    });
    expect(after.tripMinutes?.[event.id]?.minutes).toBe(35);
    expect(stack(after)).toHaveLength(0);
    // Repetirlo, igual: nada cambia y nada queda.
    const again = reducer(after, {
      type: "tripMinutes",
      eventId: event.id,
      minutes: 35,
      start: event.start,
      now: NOW2,
    });
    expect(stack(again)).toHaveLength(0);
  });

  it("elegir cómo llegar sí deja una entrada, y repetir lo mismo no deja otra", () => {
    const [d, event] = withEvent(FIXED, "Clase");
    const once = reducer(d, { type: "tripMode", eventId: event.id, mode: "bus", now: FIXED });
    expect(stack(once)).toHaveLength(1);
    const twice = reducer(once, { type: "tripMode", eventId: event.id, mode: "bus", now: FIXED });
    expect(stack(twice)).toHaveLength(1);
  });
});
