import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { MINUTE } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const withParts = (estimateMinutes: number): { data: AppData; task: AppTask } => {
  const d = demoData(NOW);
  const subject = d.activities.find((a) => a.academic) as AppData["activities"][0];
  const task: AppTask = {
    id: "lab",
    activityId: subject.id,
    title: "Informe Lab Física",
    kind: "deliverable",
    deadline: NOW + 5 * 1440 * MINUTE,
    estimateMinutes,
    minMinutes: 0,
    priority: 2,
    status: "active",
    units: [
      { id: "a", title: "Parte A", estimateMinutes: 300 },
      { id: "b", title: "Parte B", estimateMinutes: 300 },
    ],
  };
  return { data: { ...d, tasks: [task] }, task };
};

describe("«Guardar avance» de una entrega con partes", () => {
  it("avisa lo que se guardó", () => {
    const { data, task } = withParts(600);
    render(
      <ToastProvider>
        <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
          <TaskDetail task={task} onEdit={() => {}} onClose={() => {}} />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.queryByText(/se mide por las partes/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("40"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    expect(screen.getByText("Avance guardado: 1h en Informe Lab Física")).toBeTruthy();
  });
});

describe("Silo con partes que no suman la estimación", () => {
  it("el total de arriba no contradice lo que falta abajo", () => {
    // 13 h estimated, parts add up to 10 h, nothing done: «faltan» is 10 h (rule of #130).
    const { data } = withParts(780);
    render(
      <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
        <Silos />
      </StoreProvider>,
    );
    const silo = document.querySelector("[data-task='lab']") as HTMLElement;
    expect(silo.getAttribute("aria-label")).toContain("faltan 10h");
    expect(silo.querySelector(".total")?.textContent).toBe("10h");
    expect(silo.querySelector(".left")?.textContent).toBe("10h");
  });
});
