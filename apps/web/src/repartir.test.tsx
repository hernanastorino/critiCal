import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { RepartirTask } from "./components/Repartir.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider, useStore } from "./store.js";

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
