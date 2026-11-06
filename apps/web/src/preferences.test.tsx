import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { importFromCalendars } from "./calendars.js";
import { demoData, emptyData } from "./demo.js";
import { nextColor, PALETTE, uniqueColors } from "./model.js";

const NOW = Date.UTC(2026, 10, 2, 20);
const stored = () => JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  render(<App fixedNow={NOW} initial={demoData} />);
  fireEvent.click(screen.getByLabelText("Ajustes"));
});
afterEach(cleanup);

describe("fixed settings", () => {
  it("edits the weekly routine for the chosen days", () => {
    fireEvent.click(screen.getByLabelText("Día S"));
    fireEvent.click(screen.getByLabelText("Día L"));
    fireEvent.change(screen.getByLabelText("Arreglarse, traslado (min)"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Desayuno"), { target: { value: "08:00" } });
    fireEvent.change(screen.getByLabelText("Almuerzo"), { target: { value: "12:30" } });
    fireEvent.change(screen.getByLabelText("Nada de estudio desde"), {
      target: { value: "19:00" },
    });
    expect(screen.getByText(/No se planifica nada antes de 08:15/)).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar para M M J V S"));
    const week = stored().settings.week;
    expect(week[1].morningMinutes).toBe(30);
    expect(week[2]).toMatchObject({ morningMinutes: 45, freeFrom: 1140 });
    expect(week[2].meals).toEqual([
      { kind: "desayuno", start: 480, end: 510 },
      { kind: "almuerzo", start: 750, end: 810 },
      { kind: "cena", start: 1260, end: 1290 },
    ]);
    expect(week[6].morningMinutes).toBe(45);
    expect(screen.getByText("Guardado ✓")).toBeTruthy();
  });

  it("clamps a negative morning and shows the saved value", () => {
    const field = screen.getByLabelText("Arreglarse, traslado (min)") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "-60" } });
    fireEvent.click(screen.getByText(/^Guardar para/));
    expect(stored().settings.week[1].morningMinutes).toBe(0);
    expect(field.value).toBe("0");
  });

  it("drops a meal whose duration is zero and keeps at least one day selected", () => {
    for (const d of ["L", "M", "J", "V"])
      fireEvent.click(screen.getAllByLabelText(`Día ${d}`)[0] as HTMLElement);
    fireEvent.click(screen.getAllByLabelText("Día M")[1] as HTMLElement);
    expect(screen.getAllByLabelText("Día M")[1]?.getAttribute("aria-pressed")).toBe("true");
    const [breakfastMin, , dinnerMin] = screen.getAllByLabelText("Dura (min)");
    fireEvent.change(dinnerMin as HTMLElement, { target: { value: "0" } });
    fireEvent.change(breakfastMin as HTMLElement, { target: { value: "0" } });
    fireEvent.click(screen.getByText(/^Guardar para/));
    expect(stored().settings.week[3].meals).toEqual([{ kind: "almuerzo", start: 780, end: 840 }]);
  });

  it("keeps a day with every meal turned off without meals", () => {
    for (const field of screen.getAllByLabelText("Dura (min)"))
      fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(screen.getByText(/^Guardar para/));
    expect(stored().settings.week[1].meals).toEqual([]);
    // Reopened, breakfast is still off rather than back on waking.
    cleanup();
    const saved = stored().settings;
    render(<App fixedNow={NOW} initial={(now) => ({ ...demoData(now), settings: saved })} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    const [breakfastMin] = screen.getAllByLabelText("Dura (min)") as HTMLInputElement[];
    expect(breakfastMin?.value).toBe("0");
    expect(screen.getByText(/sin comidas cargadas/)).toBeTruthy();
  });

  it("shows a breakfast on waking for routines saved before breakfast was a meal", () => {
    cleanup();
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
    const initial = (now: number) => {
      const data = demoData(now);
      const week = data.settings.week.map((d) => ({
        ...d,
        wake: 420,
        meals: [
          { start: 780, end: 840 },
          { start: 1260, end: 1290 },
        ],
      }));
      return { ...data, settings: { ...data.settings, week } };
    };
    render(<App fixedNow={NOW} initial={initial} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    expect((screen.getByLabelText("Desayuno") as HTMLInputElement).value).toBe("07:00");
    expect((screen.getByLabelText("Cena") as HTMLInputElement).value).toBe("21:00");
    const [breakfastMin] = screen.getAllByLabelText("Dura (min)") as HTMLInputElement[];
    expect(breakfastMin?.value).toBe("30");
  });

  it("saves planning rules", () => {
    fireEvent.change(screen.getByLabelText("Máximo de materias por día"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Margen antes de cada evento (min)"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("Avisar cuando el margen baja de (h)"), {
      target: { value: "2,5" },
    });
    fireEvent.click(screen.getByText("Guardar reglas"));
    expect(stored().settings).toMatchObject({
      maxActivitiesPerDay: 3,
      travelMarginMinutes: 15,
      warnSlackMinutes: 150,
    });
  });

  it("saves the default hours for detected events, capping the minimum", () => {
    fireEvent.change(screen.getByLabelText("Horas de Parcial / examen"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Mínimo de Parcial / examen"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getAllByText("Guardar").at(-1) as HTMLElement);
    expect(stored().preferences.importDefaults.parcial).toEqual({
      estimate: 480,
      min: 480,
      priority: 3,
    });
  });

  it("edits a subject's colour and rules", () => {
    fireEvent.click(screen.getByText("Cálculo II"));
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), {
      target: { value: "Cálculo 2" },
    });
    fireEvent.click(screen.getByLabelText(`Color ${PALETTE[7]}`));
    fireEvent.change(screen.getByLabelText("Sesión máxima (min)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Prefiero desde"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText(/Es estudio/));
    fireEvent.click(screen.getByText("Guardar Cálculo 2"));
    expect(stored().activities[0]).toMatchObject({
      name: "Cálculo 2",
      color: PALETTE[7],
      maxSessionMinutes: 90,
      academic: false,
    });
    expect(stored().activities[0].preferred).toBeUndefined();
  });

  it("does not offer another subject's colour", () => {
    fireEvent.click(screen.getByText("Cálculo II"));
    const used = screen.getAllByLabelText(/\(ya usado\)$/) as HTMLButtonElement[];
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((b) => b.disabled)).toBe(true);
  });

  it("keeps odd minute values exact across saves", () => {
    fireEvent.change(screen.getByLabelText("Avisar cuando el margen baja de (h)"), {
      target: { value: "1,75" },
    });
    fireEvent.click(screen.getByText("Guardar reglas"));
    expect(stored().settings.warnSlackMinutes).toBe(105);
    // Reopened, it reads 1.75 (not 1.8) and saves back unchanged.
    const saved = stored();
    cleanup();
    render(<App fixedNow={NOW} initial={() => saved} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    expect(
      (screen.getByLabelText("Avisar cuando el margen baja de (h)") as HTMLInputElement).value,
    ).toBe("1.75");
    fireEvent.click(screen.getByText("Guardar reglas"));
    expect(stored().settings.warnSlackMinutes).toBe(105);
  });
});

describe("colours and defaults", () => {
  it("gives each new subject an unused colour", () => {
    expect(nextColor([{ color: PALETTE[0] }, { color: PALETTE[1] }])).toBe(PALETTE[2]);
    expect(nextColor(PALETTE.map((color) => ({ color })))).toBe(PALETTE[0]);
  });

  it("separates subjects that share a colour", () => {
    const same = [
      { id: "a", color: PALETTE[0] },
      { id: "b", color: PALETTE[0] },
      { id: "c", color: PALETTE[1] },
    ];
    expect(uniqueColors(same).map((a) => a.color)).toEqual([PALETTE[0], PALETTE[2], PALETTE[1]]);
    const distinct = [{ color: PALETTE[0] }, { color: PALETTE[1] }];
    expect(uniqueColors(distinct)).toBe(distinct);
    const full = [...PALETTE, PALETTE[0]].map((color) => ({ color }));
    expect(uniqueColors(full)).toBe(full);
  });

  it("uses the saved default hours for imported events", () => {
    const d = {
      ...emptyData(),
      calendars: [
        { id: "google:p", source: "google" as const, externalId: "p", name: "Parciales" },
      ],
      events: [
        {
          id: "e",
          title: "Parcial Física",
          start: NOW + 86_400_000,
          end: NOW + 90_000_000,
          busy: true,
          source: "google" as const,
          calendarId: "google:p",
        },
      ],
      preferences: { importDefaults: { parcial: { estimate: 300, min: 120, priority: 3 } } },
    };
    expect(importFromCalendars(d, NOW, () => "x").tasks[0]).toMatchObject({
      estimateMinutes: 300,
      minMinutes: 120,
    });
  });
});
