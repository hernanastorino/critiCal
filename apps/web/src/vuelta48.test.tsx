import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuleSettings } from "./components/Preferences.js";
import { RepartirTask } from "./components/Repartir.js";
import { ActivitySettings } from "./components/Subjects.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { localParts, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider, useStore } from "./store.js";
import { hoursProblem, parseUnit } from "./taskForm.js";

const MON = zonedInstant(TIMEZONE, "2026-11-02", 6 * 60);
const REAL = zonedInstant(TIMEZONE, localParts(TIMEZONE, Date.now()).date, 8 * 60);
const NOWS = [
  ["fecha fija", MON],
  ["fecha real", REAL],
] as const;
const HINT = "Poné horas de 0 a 168 (3, 3,5, 3h15 o 3:15).";

beforeEach(() => {
  localStorage.clear();
  clearDrafts();
});
afterEach(() => {
  cleanup();
  clearDrafts();
  vi.restoreAllMocks();
});

describe.each(NOWS)("48.ª vuelta (%s)", (_name, now) => {
  it("1 y 2. Estudio semanal abre el teclado de texto y dice lo mismo que todos", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={now}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Física I/ }));
    const weekly = screen.getByLabelText("Estudio semanal (h), además de las evaluaciones");
    expect(weekly.getAttribute("inputmode")).toBe("text");
    fireEvent.change(weekly, { target: { value: "999" } });
    expect(document.body.textContent).toContain(HINT);
    expect(document.body.textContent).not.toContain("solo cifras");
    fireEvent.change(weekly, { target: { value: "3h15" } });
    expect(weekly.getAttribute("aria-invalid")).toBeNull();
  });

  it("1 y 2. Reglas: «Avisar…» en texto, los enteros en numérico", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={now}>
        <ToastProvider>
          <RuleSettings />
        </ToastProvider>
      </StoreProvider>,
    );
    const warn = screen.getByLabelText("Avisar cuando el margen baja de (h)");
    expect(warn.getAttribute("inputmode")).toBe("text");
    expect(screen.getByLabelText("Máximo de materias por día").getAttribute("inputmode")).toBe(
      "numeric",
    );
    expect(
      screen.getByLabelText("Margen antes de cada evento (min)").getAttribute("inputmode"),
    ).toBe("numeric");
    fireEvent.change(warn, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect(screen.getByRole("alert").textContent).toBe(HINT);
  });
});

describe("2. un solo texto para las horas", () => {
  it("el mensaje de las entregas es el mismo", () => {
    expect(hoursProblem("abc")).toBe("Poné horas de 0 a 1000 (3, 3,5, 3h15 o 3:15).");
    expect(hoursProblem("abc", true)).toBe("Poné horas de más de 0 a 1000 (3, 3,5, 3h15 o 3:15).");
  });
});

const TASK: AppTask = {
  id: "rep-1",
  activityId: "",
  title: "Parcial Análisis",
  kind: "deliverable",
  deadline: MON + 10 * 86_400_000,
  estimateMinutes: 600,
  minMinutes: 300,
  priority: 2,
  status: "active",
  units: [
    { id: "d", title: "Derivadas", estimateMinutes: 75 },
    { id: "i", title: "Integrales", estimateMinutes: 525 },
  ],
};

function Inner() {
  const { data } = useStore();
  const task = data.tasks.find((t) => t.id === TASK.id);
  return task ? <RepartirTask task={task} onClose={vi.fn()} /> : null;
}

function openPicker() {
  const initial = (n: number): AppData => {
    const d = demoData(n);
    const activityId = d.activities.find((a) => a.kind !== "rutina")?.id ?? "";
    return { ...d, tasks: [...d.tasks, { ...TASK, activityId }] };
  };
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={MON}>
        <Inner />
      </StoreProvider>
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Escribir las horas de Total" }));
}

const chipOn = () =>
  screen
    .getAllByRole("radio")
    .filter((r) => r.getAttribute("aria-checked") === "true")
    .map((r) => r.textContent);

const saveDisabled = () => {
  const b = screen.getByRole("button", { name: "Guardar horas" });
  return b instanceof HTMLButtonElement && b.disabled;
};

const totalText = () =>
  screen.getByRole("button", { name: "Escribir las horas de Total" }).textContent;

describe("3. «Repartir tiempo»: el campo de horas lee como todos", () => {
  it.each([
    ["3h15", "15"],
    ["3:15", "15"],
    ["３：１５", "15"],
    ["3,5", "30"],
    ["3h50", "45"],
    ["3h53", "00"],
    ["3h", "00"],
  ])("«%s» toma horas y minutos y marca la ficha %s", (text, chip) => {
    openPicker();
    const field = screen.getByLabelText("Horas");
    expect(field.getAttribute("inputmode")).toBe("text");
    fireEvent.change(field, { target: { value: text } });
    expect(screen.queryByText("Poné horas y minutos válidos")).toBeNull();
    expect(chipOn()).toEqual([chip]);
    expect(saveDisabled()).toBe(false);
  });

  it("guardar «3h15» deja el Total en 3h15", () => {
    openPicker();
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "3h15" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(totalText()).toBe("3h15");
  });

  it("una cifra suelta sigue sumando la ficha elegida", () => {
    openPicker();
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("radio", { name: "30" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(totalText()).toBe("3h30");
  });

  it("lo que no son horas sigue avisando", () => {
    openPicker();
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "3h75" } });
    expect(screen.getByText("Poné horas y minutos válidos")).toBeTruthy();
    expect(saveDisabled()).toBe(true);
  });
});

describe("4. paréntesis con cifras que no son minutos avisan", () => {
  it.each(["P (1e2)", "P (1e-2)", "P (.5)", "P (1e2h)", "P (1e2 min)"])("«%s» avisa", (text) => {
    const r = parseUnit(text);
    expect(r !== null && "error" in r).toBe(true);
  });

  it.each([
    ["P (opcional)", "P (opcional)"],
    ["P (abc)", "P (abc)"],
    ["Solo texto", "Solo texto"],
  ])("«%s» es un nombre de 60 min", (text, title) => {
    expect(parseUnit(text)).toEqual({ title, minutes: 60 });
  });

  it("los minutos que se entienden siguen valiendo", () => {
    expect(parseUnit("P (90)")).toEqual({ title: "P", minutes: 90 });
    expect(parseUnit("P (1h30)")).toEqual({ title: "P", minutes: 90 });
  });
});
