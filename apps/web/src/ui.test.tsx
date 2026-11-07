import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { loadDemo, resetDemo, seedHistory } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);
// 2026-11-02 is a holiday (Difuntos); the demo here is an ordinary Monday.
const seeded = (now: number) =>
  seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const renderApp = () => render(<App fixedNow={NOW} initial={seeded} />);

describe("app", () => {
  it("starts on the login screen and enters the demo", () => {
    localStorage.clear();
    render(<App fixedNow={NOW} initial={seeded} />);
    fireEvent.click(screen.getByText("Probar con datos de ejemplo"));
    expect(screen.getByTestId("week")).toBeTruthy();
    expect(localStorage.getItem("critical.mode")).toBe("demo");
  });

  it("shows the week, a bubble and the critical path", () => {
    renderApp();
    const week = screen.getByTestId("week");
    expect(week.querySelectorAll(".pill.planned").length).toBeGreaterThan(5);
    expect(week.querySelectorAll(".pill.fixed").length).toBeGreaterThan(5);
    expect(week.querySelector(".now-line")).toBeTruthy();

    const toggle = screen.getByRole("button", { name: /Camino crítico/ });
    fireEvent.click(toggle);
    expect(week.className).toContain("critical-mode");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(week.querySelectorAll('.pill.planned[data-level="critical"]').length).toBeGreaterThan(0);
    fireEvent.click(toggle);

    // The last one is surely ahead, not running.
    const pill = [...week.querySelectorAll<HTMLElement>(".pill.planned:not(.past)")].at(
      -1,
    ) as HTMLElement;
    fireEvent.click(pill, { clientX: 100, clientY: 600 });
    const bubble = document.querySelector(".bubble") as HTMLElement;
    expect(within(bubble).getByText(/Faltan/)).toBeTruthy();
    fireEvent.click(bubble);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Bloque planificado/)).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);

    const event = week.querySelector(".pill.fixed") as HTMLElement;
    fireEvent.click(event, { clientX: 10, clientY: 10 });
    fireEvent.click(document.querySelector(".bubble") as HTMLElement);
    expect(screen.getByText(/Evento fijo/)).toBeTruthy();
  });

  it("navigates weeks", () => {
    renderApp();
    const title = () => screen.getByRole("heading", { level: 1 });
    expect(title().textContent).toBe("2 – 8 nov");
    expect(title().className).toContain("current");
    fireEvent.click(screen.getByLabelText("Semana siguiente"));
    expect(title().textContent).toBe("9 – 15 nov");
    expect(title().className).not.toContain("current");
    fireEvent.click(screen.getByLabelText("Semana anterior"));
    expect(title().className).toContain("current");
  });

  it("names another year's week and goes back to this one from the title", () => {
    renderApp();
    const title = () => screen.getByRole("heading", { level: 1 });
    for (let i = 0; i < 52; i++) fireEvent.click(screen.getByLabelText("Semana anterior"));
    expect(title().textContent).toBe("3 – 9 nov2025");
    expect(screen.getByLabelText("3 – 9 nov 2025. Volver a esta semana")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Volver a esta semana"));
    expect(title().textContent).toBe("2 – 8 nov");
  });

  it("confirms past blocks from the inbox", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    const done = screen.getAllByLabelText(/^Hecho:/);
    expect(done).toHaveLength(2);
    fireEvent.click(done[0] as HTMLElement);
    fireEvent.click(screen.getByLabelText(/^No hecho:/));
    // Nothing left to confirm (the demo may still have decisions to take).
    expect(screen.queryAllByLabelText(/^(No )?[Hh]echo:/)).toEqual([]);
  });

  it("records a partial check-in with units", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    fireEvent.click(screen.getAllByText("◐")[0] as HTMLElement);
    fireEvent.click(screen.getByLabelText(/Práctico 4/));
    fireEvent.click(screen.getByText("◐ Parcial"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "70" } });
    fireEvent.click(screen.getByText("Guardar parcial"));
    expect(screen.getAllByLabelText(/^Hecho:/)).toHaveLength(1);
  });

  it("shows silos and adds a deliverable and a habit", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    expect(screen.getByLabelText(/Parcial Cálculo II: faltan/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Nueva actividad"));
    fireEvent.change(screen.getByPlaceholderText("Parcial Física I"), {
      target: { value: "Parcial Química" },
    });
    fireEvent.change(screen.getByDisplayValue("Cálculo II"), { target: { value: "new" } });
    fireEvent.change(screen.getByPlaceholderText("Física I"), { target: { value: "Química" } });
    fireEvent.change(screen.getByPlaceholderText("Práctico 5 (60)"), {
      target: { value: "Repartido 1 (90)" },
    });
    fireEvent.click(screen.getByText("Agregar"));
    expect(screen.getByText("Repartido 1")).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByLabelText(/Parcial Química: faltan/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Nueva actividad"));
    fireEvent.click(screen.getByText("Hábito semanal"));
    fireEvent.change(screen.getByPlaceholderText("Parcial Física I"), {
      target: { value: "Correr" },
    });
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByLabelText(/Correr: faltan/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Correr: faltan/));
    fireEvent.click(screen.getByText("Editar"));
    fireEvent.click(screen.getByText("Archivar"));
    expect(screen.queryByLabelText(/Correr: faltan/)).toBeNull();
  });

  it("hides silos due before this week behind «Ver anteriores»", () => {
    const withPast = (now: number) => {
      const data = seeded(now);
      const first = data.tasks.find((t) => t.kind === "deliverable") as (typeof data.tasks)[0];
      const old = (id: string, title: string, date: string) => ({
        ...first,
        id,
        title,
        deadline: zonedInstant(TIMEZONE, date, 12 * 60),
      });
      return {
        ...data,
        tasks: [
          ...data.tasks,
          old("abr", "Parcial de abril", "2026-04-15"),
          old("old-tp", "TP viejo", "2026-10-20"),
          old("dic", "Final de diciembre", "2025-12-10"),
        ],
      };
    };
    render(<App fixedNow={NOW} initial={withPast} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    expect(screen.queryByLabelText(/TP viejo: faltan/)).toBeNull();
    // Habits say «esta semana», never «entrega».
    expect(screen.getByLabelText(/^Gym: faltan .*, esta semana$/)).toBeTruthy();
    fireEvent.click(screen.getByText("Ver anteriores (3)"));
    // Newest first, and another year's date says which.
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual([
      "2.º cuatrimestre 2026",
      "1.er cuatrimestre 2026",
      "2.º cuatrimestre 2025",
    ]);
    expect(screen.getByLabelText(/Final de diciembre: .*mié 10\/12\/2025 12:00$/)).toBeTruthy();
    const group = screen.getByRole("region", { name: "2.º cuatrimestre 2026" });
    expect(within(group).getByLabelText(/TP viejo: faltan/)).toBeTruthy();
    expect(
      within(group).getByLabelText(/TP viejo: faltan .*, venció el mar 20\/10 12:00$/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Ocultar anteriores"));
    expect(screen.queryByLabelText(/TP viejo: faltan/)).toBeNull();
    // The detail of an old one says it is overdue, with its year.
    fireEvent.click(screen.getByText("Ver anteriores (3)"));
    fireEvent.click(screen.getByLabelText(/Final de diciembre: faltan/));
    expect(screen.getByText(/Venció mié 10\/12\/2025 12:00/)).toBeTruthy();
  });

  it("warns in the editor when a late start leaves the minimum out, and saves the rule", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByLabelText(/Parcial Cálculo II: faltan/));
    fireEvent.click(screen.getByText("Editar"));
    fireEvent.change(screen.getByLabelText("Puedo empezar"), { target: { value: "before" } });
    fireEvent.change(screen.getByLabelText("Cuántos días antes de la entrega"), {
      target: { value: "0" },
    });
    expect(screen.getByText(/no llegás al mínimo: faltarían/)).toBeTruthy();
    fireEvent.click(screen.getByText("Guardar"));
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");
    const task = saved.tasks.find((t: { title: string }) => t.title === "Parcial Cálculo II");
    expect(task.startAfter).toEqual({ daysBefore: 0 });
  });

  it("does not save a start that is not valid yet, or one after the deadline", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByLabelText(/Parcial Cálculo II: faltan/));
    fireEvent.click(screen.getByText("Editar"));
    fireEvent.change(screen.getByLabelText("Puedo empezar"), { target: { value: "before" } });
    const days = screen.getByLabelText("Cuántos días antes de la entrega");
    for (const bad of ["-1", "2.5", "abc", "99999", ""]) {
      fireEvent.change(days, { target: { value: bad } });
      expect(screen.getByRole("alert").textContent).toMatch(/número entero de días/);
      expect((screen.getByText("Guardar") as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(screen.getByLabelText("Puedo empezar"), { target: { value: "date" } });
    fireEvent.change(screen.getByLabelText("Desde el día"), { target: { value: "2027-01-01" } });
    expect(screen.getByText(/Tiene que ser antes de la entrega/)).toBeTruthy();
    expect((screen.getByText("Guardar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-plans the day from settings and can reset or leave the demo", () => {
    renderApp();
    fireEvent.click(screen.getByLabelText("Ajustes"));
    const [wake] = screen.getAllByDisplayValue(/:/) as HTMLInputElement[];
    fireEvent.change(wake as HTMLInputElement, { target: { value: "10:00" } });
    fireEvent.click(screen.getByText("Reacomodar hoy"));
    expect(JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}").overrides).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Ajustes"));
    act(() => fireEvent.click(screen.getByText("Reiniciar demo")));
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByText("Salir"));
    expect(screen.getByText("Probar con datos de ejemplo")).toBeTruthy();
  });

  it("offers choices when the minimums do not fit, and applies one", () => {
    const tight = (now: number) => {
      const d = demoData(now);
      return {
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === "parcial-calc"
            ? { ...t, minMinutes: 1500, estimateMinutes: 1500, units: [] }
            : t,
        ),
      };
    };
    render(<App fixedNow={NOW} initial={tight} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    expect(screen.getByText("No llegás a todo · elegí")).toBeTruthy();
    const choices = screen.getAllByText("Elegir");
    fireEvent.click(choices[choices.length - 1] as HTMLElement);
    const suggestion = screen.queryByText("Hacelo por hoy");
    if (suggestion) fireEvent.click(suggestion);
    expect(screen.getByRole("heading", { name: "Bandeja" })).toBeTruthy();
  });

  it("asks before moving today's blocks when a new event clashes", () => {
    const first = seeded(NOW);
    const clash = first.plan.find((b) => b.start > NOW) as (typeof first.plan)[number];
    const withEvent = {
      ...first,
      events: [
        ...first.events,
        {
          id: "new",
          title: "Dentista",
          start: clash.start,
          end: clash.end,
          busy: true,
          source: "demo" as const,
        },
      ],
    };
    render(<App fixedNow={NOW} initial={() => withEvent} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    expect(screen.getByText(/Un evento nuevo pisa/)).toBeTruthy();
    fireEvent.click(screen.getByText("Reacomodar"));
    expect(screen.queryByText(/Un evento nuevo pisa/)).toBeNull();
  });

  it("loads and resets persisted demo data", () => {
    localStorage.setItem("critical.demo.v2", JSON.stringify({ ...demoData(NOW), tasks: [] }));
    expect(loadDemo(NOW).tasks).toEqual([]);
    resetDemo();
    expect(loadDemo(NOW).tasks.length).toBeGreaterThan(0);
    localStorage.setItem("critical.demo.v2", "{bad json");
    expect(loadDemo(NOW).tasks.length).toBeGreaterThan(0);
  });
});
