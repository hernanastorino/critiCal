import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { RepartirTask } from "./components/Repartir.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { endOfWeek } from "./planning.js";
import { applySheet, openSheet, slideTotal } from "./repartir.js";
import { StoreProvider, useStore } from "./store.js";
import { weekLeft } from "./week-review.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

const TASK: AppTask = {
  id: "rep-1",
  activityId: "",
  title: "Parcial Análisis",
  kind: "deliverable",
  deadline: NOW + 10 * 86_400_000,
  estimateMinutes: 600,
  minMinutes: 300,
  priority: 2,
  status: "active",
  units: [
    { id: "d", title: "Derivadas", estimateMinutes: 75 },
    { id: "i", title: "Integrales", estimateMinutes: 525 },
  ],
};

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

function start() {
  const initial = (now: number): AppData => {
    const d = demoData(now);
    const activityId = d.activities.find((a) => a.kind !== "rutina")?.id ?? "";
    return { ...d, tasks: [...d.tasks, { ...TASK, activityId }] };
  };
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        <Spy />
        <Inner onClose={onClose} />
      </StoreProvider>
    </ToastProvider>,
  );
  return onClose;
}

function Inner({ onClose }: { onClose: () => void }) {
  const { data } = useStore();
  const task = data.tasks.find((t) => t.id === TASK.id);
  return task ? <RepartirTask task={task} onClose={onClose} /> : null;
}

afterEach(cleanup);

const accept = () => screen.getByRole("button", { name: "Aceptar reparto" });
const slider = (name: string) => screen.getByRole("slider", { name });
const change = (name: string, value: number) =>
  fireEvent.change(slider(name), { target: { value: String(value) } });

describe("hoja «Repartir tiempo»", () => {
  it("abre con la suma cerrada: se puede aceptar y no hay «sin asignar» en rojo", () => {
    start();
    expect((accept() as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector(".rep-rest.red")).toBeNull();
  });

  it("mover el total deja «sin asignar» en rojo y apaga Aceptar; repartir el resto lo vuelve a abrir", () => {
    start();
    change("Total", 660);
    expect(document.querySelector(".rep-rest.red")?.textContent).toMatch(/1h/);
    expect((accept() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Repartir el resto" }));
    expect((accept() as HTMLButtonElement).disabled).toBe(false);
  });

  it("subir un tema más allá del total pone su hora en rojo", () => {
    start();
    change("Derivadas", 120);
    const time = screen.getByRole("button", { name: "Escribir las horas de Derivadas" });
    expect(time.className).toContain("red");
    expect((accept() as HTMLButtonElement).disabled).toBe(true);
  });

  it("«Por peso» está apagado sin pesos", () => {
    start();
    expect((screen.getByRole("button", { name: "Por peso" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("VoiceOver: cada tema dice su hora y su mínimo", () => {
    start();
    expect(slider("Derivadas").getAttribute("aria-valuetext")).toMatch(
      /^Derivadas, 1 hora 15, mínimo \d+ minutos$/,
    );
    expect(slider("Mínimo").getAttribute("aria-valuetext")).toBe("5 horas");
    // Las flechas mueven el mínimo de a 15 minutos.
    fireEvent.keyDown(slider("Mínimo"), { key: "ArrowLeft" });
    expect(slider("Mínimo").getAttribute("aria-valuetext")).toBe("4 horas 45");
  });

  it("la hora tocable abre el selector y el valor escrito pasa a ser el nuevo", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Escribir las horas de Total" }));
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("radio", { name: "30" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(slider("Total").getAttribute("aria-valuetext")).toMatch(/^Total, 12 horas 30/);
  });

  it("Aceptar guarda y deja una sola entrada en el ↶; deshacer deja todo idéntico", () => {
    const onClose = start();
    const before = JSON.stringify(latest?.tasks);
    const entries = latest?.planHistory?.length ?? 0;
    change("Total", 630);
    change("Derivadas", 105);
    expect((accept() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(accept());
    const saved = latest?.tasks.find((t) => t.id === TASK.id);
    expect(saved?.estimateMinutes).toBe(630);
    expect(saved?.units[0]?.estimateMinutes).toBe(105);
    expect(latest?.planHistory?.length).toBe(entries + 1);
    expect(latest?.planHistory?.at(-1)?.label).toBe("repartir Parcial Análisis");
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(JSON.stringify(latest?.tasks)).toBe(before);
  });

  it("a 375 px no hay desborde horizontal: el total y los botones caben en la hoja", () => {
    start();
    const sheet = document.querySelector(".sheet.repartir");
    expect(sheet).not.toBeNull();
    // jsdom no hace layout: se comprueba que nada fija un ancho mayor que la hoja.
    for (const el of sheet?.querySelectorAll<HTMLElement>("[style]") ?? []) {
      expect(el.style.width).not.toMatch(/^\d{4,}px$/);
    }
    expect(document.querySelector(".rep-top")).not.toBeNull();
    expect(document.querySelector(".rep-list")).not.toBeNull();
  });
});

describe("opciones de la Bandeja aceptadas por la hoja", () => {
  const tight = (now: number): AppData => {
    const d = demoData(now);
    return {
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === "parcial-calc" ? { ...t, minMinutes: 3000, estimateMinutes: 3000, units: [] } : t,
      ),
    };
  };
  const T = Date.UTC(2026, 10, 2, 20);

  it("siguen siendo una «Decisión que tomaste»: no se ofrece de nuevo y ↶ la devuelve", () => {
    localStorage.setItem("critical.mode", "demo");
    render(<App fixedNow={T} initial={tight} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    const names = () =>
      screen
        .queryAllByRole("button", { name: /^Elegir:/ })
        .map((b) => b.getAttribute("aria-label"));
    const first = names().find((n) => /Bajar el mínimo/.test(n ?? ""));
    expect(first).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: first as string }));
    expect(screen.getByRole("dialog", { name: "Repartir tiempo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar reparto" }));
    expect(screen.getByText("Decisiones que tomaste")).toBeTruthy();
    expect(names()).not.toContain(first);
    fireEvent.click(screen.getByRole("button", { name: /^Deshacer: Bajar el mínimo/ }));
    expect(names()).toContain(first);
  });
});

describe("tareas sin temas", () => {
  it("se ofrece «+ Tema» y con el primero empieza el reparto", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Quitar Derivadas" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar Integrales" }));
    expect(document.querySelector(".rep-rest")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Tema" }));
    expect(document.querySelector(".rep-rest.red")).not.toBeNull();
    expect((accept() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("42.ª vuelta: nombres, mínimo y límites", () => {
  const addTema = () => fireEvent.click(screen.getByRole("button", { name: "+ Tema" }));
  const nameOf = (n: number) => screen.getByRole("textbox", { name: `Nombre del tema ${n}` });
  const disabled = (name: string) =>
    screen.getByRole("button", { name }) instanceof HTMLButtonElement &&
    (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

  it("un tema nuevo sin nombre, con solo espacios, repetido o larguísimo no se acepta y lo dice en el campo", () => {
    start();
    addTema();
    addTema();
    // Dos temas nuevos nunca nacen con el mismo nombre.
    expect((nameOf(3) as HTMLInputElement).value).not.toBe((nameOf(4) as HTMLInputElement).value);
    fireEvent.click(screen.getByRole("button", { name: "Repartir el resto" }));
    expect(disabled("Aceptar reparto")).toBe(false);
    fireEvent.change(nameOf(3), { target: { value: "" } });
    expect(disabled("Aceptar reparto")).toBe(true);
    expect(nameOf(3).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Poné un nombre para el tema")).toBeTruthy();
    fireEvent.change(nameOf(3), { target: { value: "   " } });
    expect(disabled("Aceptar reparto")).toBe(true);
    // Sin importar mayúsculas ni tildes, ni contra los temas que ya estaban.
    fireEvent.change(nameOf(3), { target: { value: "DERIVADAS" } });
    expect(screen.getByText("Ya hay un tema con ese nombre")).toBeTruthy();
    expect(disabled("Aceptar reparto")).toBe(true);
    fireEvent.change(nameOf(3), { target: { value: "Límites" } });
    fireEvent.change(nameOf(4), { target: { value: "limites" } });
    expect(screen.getAllByText("Ya hay un tema con ese nombre").length).toBe(2);
    fireEvent.change(nameOf(4), { target: { value: "x".repeat(81) } });
    expect(screen.getByText("Como máximo 80 caracteres")).toBeTruthy();
    expect(disabled("Aceptar reparto")).toBe(true);
    fireEvent.change(nameOf(4), { target: { value: "Series" } });
    expect(disabled("Aceptar reparto")).toBe(false);
  });

  it("un nombre vacío se lee igual: «Quitar Tema 3» y «Escribir las horas de Tema 3»", () => {
    start();
    addTema();
    fireEvent.change(nameOf(3), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Quitar Tema 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escribir las horas de Tema 3" })).toBeTruthy();
  });

  it("el mínimo elegido vuelve al subir el Total otra vez", () => {
    start();
    change("Total", 0);
    expect(slider("Mínimo").getAttribute("aria-valuetext")).toBe("0 minutos");
    change("Total", 600);
    expect(slider("Mínimo").getAttribute("aria-valuetext")).toBe("5 horas");
    // Moverlo a mano sí cambia lo elegido.
    fireEvent.keyDown(slider("Mínimo"), { key: "ArrowLeft" });
    change("Total", 0);
    change("Total", 600);
    expect(slider("Mínimo").getAttribute("aria-valuetext")).toBe("4 horas 45");
  });

  it("el selector con texto, negativo, coma o vacío dice por qué no guarda", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "Escribir las horas de Total" }));
    for (const v of ["abc", "-2", "1,5", ""]) {
      fireEvent.change(screen.getByLabelText("Horas"), { target: { value: v } });
      expect(screen.getByText("Poné horas y minutos válidos")).toBeTruthy();
      expect(disabled("Guardar horas")).toBe(true);
    }
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "3" } });
    expect(screen.queryByText("Poné horas y minutos válidos")).toBeNull();
  });

  it("hay tope de 30 temas y «+ Tema» se apaga al llegar", () => {
    start();
    for (let i = 0; i < 28; i++) addTema();
    expect(document.querySelectorAll(".rep-list > .rep-row").length).toBe(30);
    expect(disabled("+ Tema")).toBe(true);
  });
});

describe("mínimo de la hoja (puro)", () => {
  it("el mínimo efectivo es min(elegido, Total) y solo se guarda bajado si se acepta así", () => {
    const sheet = openSheet(TASK);
    const down = slideTotal(sheet, 0);
    expect(down.min).toBe(0);
    expect(slideTotal(down, 600).min).toBe(300);
    expect(applySheet(TASK, slideTotal(sheet, 240)).minMinutes).toBe(240);
  });
});

describe("silo de estudio semanal", () => {
  const STUDY = "estudio-rep";
  const study = (now: number): AppData => {
    const d = demoData(now);
    const activityId = d.activities.find((a) => a.kind !== "rutina")?.id ?? "";
    const task: AppTask = {
      id: STUDY,
      activityId,
      title: "Estudio Rep",
      study: true,
      kind: "habit",
      estimateMinutes: 0,
      minMinutes: 240,
      sessionsPerWeek: 4,
      sessionMinutes: 60,
      priority: 2,
      status: "active",
      units: [],
    };
    return { ...d, tasks: [...d.tasks, task] };
  };

  it("el Total pasa de 4h a 5h30: el silo dice falta / asignado, el plan lo reserva y ↶ deja todo igual", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={study} persist={false} fixedNow={NOW}>
          <Spy />
          <Study />
        </StoreProvider>
      </ToastProvider>,
    );
    const before = JSON.stringify([latest?.tasks, latest?.plan]);
    expect(slider("Total").getAttribute("aria-valuetext")).toMatch(/^Total, 4 horas/);
    expect(document.querySelector(".rep-list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Escribir las horas de Total" }));
    fireEvent.change(screen.getByLabelText("Horas"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("radio", { name: "30" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    fireEvent.click(accept());
    const saved = latest?.tasks.find((t) => t.id === STUDY);
    expect(saved?.estimateMinutes).toBe(330);
    expect(saved?.sessionsPerWeek).toBe(6);
    const row = latest && weekLeft(latest, NOW).find((r) => r.taskId === STUDY);
    expect(row?.assigned).toBe(330);
    const planned = (latest?.plan ?? [])
      .filter((b) => b.taskId === STUDY && b.start >= endOfWeek(TIMEZONE, NOW))
      .reduce((n, b) => n + (b.end - b.start) / 60_000, 0);
    expect(planned).toBe(330);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(JSON.stringify([latest?.tasks, latest?.plan])).toBe(before);
  });
});

function Study() {
  const { data } = useStore();
  const task = data.tasks.find((t) => t.id === "estudio-rep");
  return task ? <RepartirTask task={task} onClose={() => undefined} /> : null;
}
