import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { BlockSheet } from "./components/BlockSheet.js";
import { Routines, WeekSettings } from "./components/Preferences.js";
import { ActivitySettings } from "./components/Subjects.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { localParts, zonedInstant } from "./engine.js";
import { BACKUP_EVENTS_MAX, BACKUP_TASKS_MAX } from "./limits.js";
import type { AppData, AppEvent } from "./model.js";
import { placeClashes, travelIntervals } from "./planning.js";
import { reducer, StoreProvider } from "./store.js";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
const MON = zonedInstant(TIMEZONE, "2026-11-02", 6 * 60);
const REAL = zonedInstant(TIMEZONE, localParts(TIMEZONE, Date.now()).date, 8 * 60);
const NOWS = [
  ["fecha fija", MON],
  ["fecha real", REAL],
] as const;

beforeEach(() => {
  localStorage.clear();
  clearDrafts();
});
afterEach(() => {
  cleanup();
  clearDrafts();
  vi.restoreAllMocks();
});

describe("1. Estudio semanal inválido", () => {
  it.each(["abc", "-3", "1e2", "999999"])("«%s» muestra el mensaje y el campo lo nombra", (v) => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Física I/ }));
    const field = screen.getByLabelText("Estudio semanal (h), además de las evaluaciones");
    fireEvent.change(field, { target: { value: v } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const ids = (field.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = ids.map((id) => document.getElementById(id)?.textContent ?? "");
    expect(texts.some((t) => /Poné horas de 0 a 168/.test(t))).toBe(true);
    expect(document.body.textContent).toMatch(/Poné horas de 0 a 168/);
  });
});

describe("2. El respaldo limpia los textos como los formularios", () => {
  const dirty = "Par‮cial​ X";
  it.each(NOWS)("%s: títulos, nombres, temas, lugares, alias y direcciones", (_n, now) => {
    const d = demoData(now);
    const task = d.tasks.find((t) => t.kind === "deliverable");
    const event = d.events.at(0);
    const activity = d.activities.at(0);
    if (!task || !event || !activity) throw new Error("faltan datos");
    const dirtyData: AppData = {
      ...d,
      events: d.events.map((e) =>
        e.id === event.id ? { ...e, title: dirty, location: "Av.‮ 18" } : e,
      ),
      activities: d.activities.map((a) => (a.id === activity.id ? { ...a, name: dirty } : a)),
      tasks: d.tasks.map((t) =>
        t.id === task.id
          ? { ...t, title: dirty, units: [{ id: "u1", title: dirty, estimateMinutes: 30 }] }
          : t,
      ),
      places: [{ id: "p1", name: dirty, aliases: [dirty, "ok"], address: "Calle​ 1", isHome: true }],
    };
    const read = parseBackup(exportJson(dirtyData, now));
    if ("error" in read) throw new Error(read.error);
    const clean = "Par cial X";
    expect(read.data.events.find((e) => e.id === event.id)?.title).toBe(clean);
    expect(read.data.events.find((e) => e.id === event.id)?.location).toBe("Av. 18");
    expect(read.data.activities.find((a) => a.id === activity.id)?.name).toBe(clean);
    const t = read.data.tasks.find((x) => x.id === task.id);
    expect(t?.title).toBe(clean);
    expect(t?.units.at(0)?.title).toBe(clean);
    const p = read.data.places?.at(0);
    expect([p?.name, p?.aliases, p?.address]).toEqual([clean, [clean, "ok"], "Calle 1"]);
    expect(/[‮​]/.test(JSON.stringify(read.data))).toBe(false);
  });
});

describe("3. Un título larguísimo sin espacios en la hoja del evento", () => {
  it("el título corta con «…» (tres líneas) y no se sale de la hoja", () => {
    const d = demoData(MON);
    const e: AppEvent = {
      id: "largo",
      title: "x".repeat(5000),
      start: MON + 3_600_000,
      end: MON + 7_200_000,
      busy: true,
      source: "demo",
    };
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={MON}>
        <ToastProvider>
          <BlockSheet
            item={{ kind: "event", id: e.id, start: e.start, end: e.end, event: e }}
            onClose={vi.fn()}
          />
        </ToastProvider>
      </StoreProvider>,
    );
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.className).toBe("event-title");
    const rule = /\.event-title \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/overflow-wrap: anywhere/);
    expect(rule).toMatch(/-webkit-line-clamp: 3/);
    expect(rule).toMatch(/overflow: hidden/);
  });
});

describe("4. Tope al importar", () => {
  it.each(NOWS)("%s: demasiados eventos o tareas se rechazan con un mensaje", (_n, now) => {
    const d = demoData(now);
    const ev = (i: number): AppEvent => ({
      id: `e${i}`,
      title: "x",
      start: now,
      end: now + 60_000,
      busy: false,
      source: "demo",
    });
    const events = (n: number) => Array.from({ length: n }, (_, i) => ev(i));
    const a = parseBackup(exportJson({ ...d, events: events(BACKUP_EVENTS_MAX + 1) }, now));
    expect("error" in a && a.error).toMatch(/eventos: el máximo son 5000/);
    const task = d.tasks.at(0);
    if (!task) throw new Error("falta una tarea");
    const tasks = Array.from({ length: BACKUP_TASKS_MAX + 1 }, (_, i) => ({
      ...task,
      id: `t${i}`,
    }));
    const b = parseBackup(exportJson({ ...d, tasks }, now));
    expect("error" in b && b.error).toMatch(/tareas: el máximo son 2000/);
    const ok = parseBackup(exportJson({ ...d, events: events(BACKUP_EVENTS_MAX) }, now));
    expect("error" in ok).toBe(false);
  });
});

describe("5. Los tres botones de «Repartir tiempo» miden lo mismo", () => {
  it("en columnas iguales que pasan a más filas con letra grande, sin margen superior de más", () => {
    const rule = /\.rep-presets \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/display: grid/);
    expect(rule).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(6\.25em, 1fr\)\)/);
    expect(rule).toMatch(/align-items: stretch/);
    expect(/\.rep-presets \.btn \{([^}]*)\}/.exec(css)?.[1]).toMatch(/margin-top: 0/);
  });
});

describe("6. Un evento que pisa a varios en otros lugares los nombra a todos", () => {
  const base = (now: number): AppData => {
    const day = localParts(TIMEZONE, now).date;
    const mk = (id: string, title: string, from: number, to: number, location: string) => ({
      id,
      title,
      start: zonedInstant(TIMEZONE, day, from),
      end: zonedInstant(TIMEZONE, day, to),
      busy: true,
      source: "demo" as const,
      location,
    });
    return {
      ...demoData(now),
      events: [
        mk("b", "B", 20 * 60, 21 * 60 + 30, "Lugar B"),
        mk("a", "A", 20 * 60, 21 * 60, "Lugar A"),
        mk("c", "C", 20 * 60 + 30, 22 * 60, "Lugar C"),
        mk("d", "D", 20 * 60 + 15, 21 * 60 + 15, "Lugar D"),
      ],
    };
  };
  const sheet = (now: number, keep: string[]) => {
    const all = base(now);
    const d = { ...all, events: all.events.filter((e) => keep.includes(e.id)) };
    const event = d.events.find((e) => e.id === "b");
    if (!event) throw new Error("falta B");
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={now}>
        <ToastProvider>
          <BlockSheet
            item={{ kind: "event", id: event.id, start: event.start, end: event.end, event }}
            onClose={vi.fn()}
          />
        </ToastProvider>
      </StoreProvider>,
    );
    const said = screen.getByRole("note").textContent;
    cleanup();
    return said;
  };
  it.each(NOWS)("%s: uno, dos o más", (_n, now) => {
    const all = base(now);
    const b = all.events.find((e) => e.id === "b");
    if (!b) throw new Error("falta B");
    expect(placeClashes(all, b).map((e) => e.title)).toEqual(["A", "C", "D"]);
    expect(sheet(now, ["b", "a"])).toBe("Se superpone con «A», en otro lugar.");
    expect(sheet(now, ["b", "a", "c"])).toBe("Se superpone con «A» y «C», en otro lugar.");
    expect(sheet(now, ["b", "a", "c", "d"])).toBe("Se superpone con «A» y 2 más, en otro lugar.");
  });
});

describe("7. Con 0 min no hay traslado ni margen", () => {
  it.each(NOWS)("%s: una dirección con 0 min no reserva nada", (_n, now) => {
    const day = localParts(TIMEZONE, now).date;
    const text = "Rambla 123";
    const e: AppEvent = {
      id: "cero",
      title: "Reunión",
      start: zonedInstant(TIMEZONE, day, 21 * 60),
      end: zonedInstant(TIMEZONE, day, 22 * 60),
      busy: true,
      source: "demo",
      location: text,
    };
    const home = { id: "casa", name: "Casa", aliases: [], isHome: true, lat: -34.9, lon: -56.19 };
    const d: AppData = {
      ...demoData(now),
      events: [e],
      places: [home],
      spots: [{ key: "rambla 123", text, minutes: 10, manual: true }],
    };
    expect(travelIntervals(d).length).toBe(2);
    const zero = { ...d, spots: [{ key: "rambla 123", text, minutes: 0, manual: true }] };
    expect(travelIntervals(zero)).toEqual([]);
  });
});

describe("8. Mi semana: el último día elegido no se apaga y lo dice", () => {
  it("avisa en el control y el botón sigue nombrando el día", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <ToastProvider>
          <WeekSettings />
        </ToastProvider>
      </StoreProvider>,
    );
    for (const day of ["lunes", "martes", "miércoles", "jueves"]) {
      fireEvent.click(screen.getByRole("button", { name: day }));
    }
    const friday = screen.getByRole("button", { name: "viernes" });
    expect(screen.queryByText(/al menos un día/)).toBeNull();
    fireEvent.click(friday);
    expect(friday.getAttribute("aria-pressed")).toBe("true");
    const note = screen.getByText(/al menos un día/);
    expect(note.textContent).toMatch(/al menos un día/);
    expect(friday.getAttribute("aria-describedby")).toBe(note.id);
    expect(screen.getByRole("button", { name: /^Guardar para viernes/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sábado" }));
    expect(screen.queryByText(/al menos un día/)).toBeNull();
  });
});

describe("9. Bajas viejas", () => {
  const dejar = (day: string, start: number, now: number) =>
    ({
      type: "mealChoice",
      date: day,
      kind: "cena",
      start,
      asked: true,
      label: "dejar Cena ahí",
      now,
    }) as const;

  it.each(NOWS)(
    "%s: «Dejarla ahí» sin cambios no deja ↶, con cambios dice «dejar … ahí»",
    (_n, now) => {
      const d = demoData(now);
      const day = localParts(TIMEZONE, now).date;
      const stay = reducer(d, dejar(day, 21 * 60, now));
      const again = reducer(stay, dejar(day, 21 * 60, now));
      expect(again.planHistory?.length ?? 0).toBe(stay.planHistory?.length ?? 0);
      // Whatever it leaves is named after the answer, not «mover o sacar una comida».
      const labels = (again.planHistory ?? []).map((v) => v.label);
      expect(labels.every((l) => l === "dejar Cena ahí")).toBe(true);
      const plain = reducer(d, {
        type: "mealChoice",
        date: day,
        kind: "cena",
        start: 17 * 60,
        now,
      });
      expect((plain.planHistory ?? []).at(-1)?.label ?? "mover o sacar una comida").toBe(
        "mover o sacar una comida",
      );
    },
  );

  it("«Agregar rutina» se ve habilitado con datos válidos y apagado con el nombre en blanco", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <ToastProvider>
          <Routines />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    const add = screen.getByRole("button", { name: "Agregar rutina" });
    expect(add.className).not.toMatch(/primary/);
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: "   " } });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    expect(add.className).not.toMatch(/primary/);
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: "Yoga nueva" } });
    expect(add.getAttribute("aria-disabled")).toBeNull();
    expect(add.className).toMatch(/primary/);
  });
});
