import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { Silos } from "./components/Silos.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { routineWeekText } from "./friendly.js";
import type { AppData } from "./model.js";
import { refreshPlan, routineShortfalls } from "./planning.js";
import { proposalText } from "./repartir.js";
import { loadDemo, StoreProvider } from "./store.js";
import { parseUnit, partsTotalProblem } from "./taskForm.js";

// 46.ª vuelta (Demo de pruebas y demo normal): formulario de entregas, avisos de rutinas y
// propuesta de las opciones. Cada prueba con fecha fija y con la fecha real.
const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const MOMENTS = [
  ["fecha fija", "2026-11-23", 10 * 60],
  ["fecha real", real, 10 * 60],
] as const;
const KINDS = ["pruebas", "demo"] as const;
const PART = "Nueva parte: nombre y minutos entre paréntesis";

function setKind(kind: (typeof KINDS)[number]) {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  else localStorage.removeItem(DEMO_KIND_KEY);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
  localStorage.removeItem(DEMO_KIND_KEY);
});

const set = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const input = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const addPart = (text: string) => {
  set(PART, text);
  fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
};

function newEditor(now: number) {
  render(
    <ToastProvider>
      <StoreProvider initial={() => loadDemo(now)} persist={false} fixedNow={now}>
        <TaskEditor onClose={vi.fn()} />
      </StoreProvider>
    </ToastProvider>,
  );
  const select = screen.getByLabelText<HTMLSelectElement>("Materia o actividad");
  const value = [...select.options].find((o) => o.value && o.value !== "new")?.value;
  fireEvent.change(select, { target: { value } });
  set("Nombre", "Entrega");
}

describe.each(KINDS)("formulario de una entrega nueva: demo %s", { timeout: 30_000 }, (kind) => {
  describe.each(MOMENTS)("%s", (_n, date, minute) => {
    const now = zonedInstant(TIMEZONE, date, minute);

    it("1. una sola parte corta baja el mínimo sugerido al total y se guarda", () => {
      setKind(kind);
      newEditor(now);
      addPart("Uno (60)");
      expect(input("Horas estimadas").value).toBe("1h");
      expect(input("Mínimo (horas)").value).toBe("1");
      expect(screen.queryByText(/El mínimo no puede ser mayor/)).toBeNull();
      const save = screen.getByRole("button", { name: "Guardar" });
      expect(save.getAttribute("aria-disabled")).toBeNull();
    });

    it("1. un mínimo tocado y mayor que el total sigue dando el error", () => {
      setKind(kind);
      newEditor(now);
      set("Mínimo (horas)", "3");
      addPart("Uno (60)");
      expect(input("Mínimo (horas)").value).toBe("3");
      expect(
        screen.getByText("El mínimo no puede ser mayor que las horas estimadas."),
      ).toBeTruthy();
    });

    it("2. partes que suman más de 1000 h: el error sale en las partes", () => {
      setKind(kind);
      newEditor(now);
      addPart("Uno (60000)");
      addPart("Dos (60000)");
      expect(screen.getByText("Las partes suman más de 1000 h.")).toBeTruthy();
      expect(screen.queryByText(/Poné horas de/)).toBeNull();
      expect(input("Horas estimadas").getAttribute("aria-invalid")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      expect(document.activeElement).toBe(screen.getByLabelText(PART));
    });

    it("5. con partes, «Horas estimadas» dice 3h15", () => {
      setKind(kind);
      newEditor(now);
      addPart("Uno (195)");
      expect(input("Horas estimadas").value).toBe("3h15");
    });

    it("7. al crear se elige el tipo; al editar no", () => {
      setKind(kind);
      const data = loadDemo(now);
      const { unmount } = render(
        <StoreProvider initial={() => data} persist={false} fixedNow={now}>
          <TaskEditor onClose={vi.fn()} />
        </StoreProvider>,
      );
      expect(screen.getByRole("button", { name: "Hábito semanal" })).toBeTruthy();
      unmount();
      const edited = data.tasks.filter((x) => x.status === "active").slice(0, 4);
      expect(edited.length).toBeGreaterThan(0);
      for (const t of edited) {
        render(
          <StoreProvider initial={() => data} persist={false} fixedNow={now}>
            <TaskEditor task={t} onClose={vi.fn()} />
          </StoreProvider>,
        );
        expect(screen.queryByRole("button", { name: "Hábito semanal" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Entrega / parcial" })).toBeNull();
        cleanup();
      }
    });
  });
});

describe("4. el tiempo de una parte entre paréntesis", () => {
  it.each([
    ["Práctico (2h)", 120],
    ["Práctico (1h30)", 90],
    ["Práctico (90 min)", 90],
    ["Práctico (90)", 90],
    ["Práctico 5 (60)", 60],
    ["Práctico (1h 30 min)", 90],
  ])("«%s» son %i min", (text, minutes) => {
    expect(parseUnit(text)).toEqual({ title: text.replace(/ \(.*\)$/, ""), minutes });
  });

  it("lo que no entiende lo avisa, y un paréntesis de nombre sigue siendo nombre", () => {
    for (const text of ["Práctico (0)", "Práctico (-30)", "Práctico (1,5)", "Práctico (2h90m5)"]) {
      expect(parseUnit(text)).toHaveProperty("error");
    }
    expect(parseUnit("Parte B (opcional)")).toEqual({ title: "Parte B (opcional)", minutes: 60 });
    expect(parseUnit("Práctico")).toEqual({ title: "Práctico", minutes: 60 });
  });

  it("partsTotalProblem: hasta 1000 h", () => {
    expect(partsTotalProblem(60_000)).toBeNull();
    expect(partsTotalProblem(60_001)).toBe("Las partes suman más de 1000 h.");
  });
});

describe.each(MOMENTS)(
  "8. silo de rutina que no entra: %s",
  { timeout: 30_000 },
  (_n, date, minute) => {
    const now = zonedInstant(TIMEZONE, date, minute);

    it.each(KINDS)("demo %s: el silo dice lo mismo que la tarjeta de la Bandeja", (kind) => {
      setKind(kind);
      const data: AppData = loadDemo(now);
      const plan = refreshPlan(data, now);
      const short = routineShortfalls(data, now, data.plan, plan.input);
      render(
        <ToastProvider>
          <StoreProvider initial={() => data} persist={false} fixedNow={now}>
            <Silos />
          </StoreProvider>
        </ToastProvider>,
      );
      const card = screen.getByText("Esta semana: falta / asignado").closest<HTMLElement>(".card");
      if (!card) throw new Error("sin tarjeta de la semana");
      const texts = within(card).queryAllByText(/^Esta semana entra/);
      expect(texts.map((t) => t.textContent)).toEqual(short.map((r) => routineWeekText(r)));
    });

    it("la Demo de pruebas del lunes tiene al Gym sin entrar entero", () => {
      if (date !== "2026-11-23") return;
      setKind("pruebas");
      const data = loadDemo(now);
      const short = routineShortfalls(data, now, data.plan, refreshPlan(data, now).input);
      expect(short.length).toBeGreaterThan(0);
    });
  },
);

describe("9. «Bajar el mínimo» dice qué propone", () => {
  const tight = (now: number): AppData => {
    const d = demoData(now);
    return {
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === "parcial-calc" ? { ...t, minMinutes: 3000, estimateMinutes: 3000, units: [] } : t,
      ),
    };
  };

  it("la hoja abre con «Propuesta: mínimo …»", () => {
    localStorage.setItem("critical.mode", "demo");
    render(<App fixedNow={Date.UTC(2026, 10, 2, 20)} initial={tight} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    const first = screen
      .queryAllByRole("button", { name: /^Elegir:/ })
      .map((b) => b.getAttribute("aria-label") ?? "")
      .find((n) => n.includes("Bajar el mínimo"));
    expect(first).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: first ?? "" }));
    const dialog = screen.getByRole("dialog", { name: "Repartir tiempo" });
    expect(within(dialog).getByText(/^Propuesta: mínimo .*\. Revisá y aceptá\.$/)).toBeTruthy();
  });

  it("proposalText dice lo que cambia, y nada si no cambia nada", () => {
    const task = {
      id: "t",
      activityId: "a",
      title: "T",
      kind: "deliverable" as const,
      estimateMinutes: 600,
      minMinutes: 600,
      priority: 2,
      status: "active" as const,
      units: [],
    };
    expect(proposalText(task, { estimateMinutes: 600, minMinutes: 390, units: [] })).toBe(
      "Propuesta: mínimo 6h30. Revisá y aceptá.",
    );
    expect(proposalText(task, { estimateMinutes: 390, minMinutes: 390, units: [] })).toBe(
      "Propuesta: total 6h30, mínimo 6h30. Revisá y aceptá.",
    );
    expect(proposalText(task, { estimateMinutes: 600, minMinutes: 600, units: [] })).toBeNull();
  });
});
