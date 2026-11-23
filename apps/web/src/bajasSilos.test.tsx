import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { TIMEZONE } from "./demo.js";
import { demoSinRutina as demoData } from "./demoSinRutina.js";
import { zonedInstant } from "./engine.js";
import { decisions, refreshPlan } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

function Probe() {
  const { data } = useStore();
  return (
    <output data-testid="status">{data.tasks.map((t) => `${t.title}:${t.status}`).join()}</output>
  );
}

describe("silos: lo archivado se ve y se recupera", () => {
  it("«Archivar» deja las archivadas a la vista, con «Recuperar»", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const gym = d.tasks.find((t) => t.title === "Gym");
    if (!gym) throw new Error("no Gym in the demo");
    const archived = reducer(d, {
      type: "saveTask",
      task: { ...gym, status: "dropped" },
      now: NOW,
    });
    render(
      <ToastProvider>
        <StoreProvider initial={() => archived} fixedNow={NOW}>
          <Silos />
          <Probe />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.queryByLabelText("Archivadas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver archivadas (1)" }));
    const list = screen.getByLabelText("Archivadas");
    expect(list.textContent).toContain("Gym");
    fireEvent.click(screen.getByRole("button", { name: "Recuperar Gym" }));
    expect(screen.getByTestId("status").textContent).toContain("Gym:active");
    expect(screen.queryByRole("button", { name: /archivadas/ })).toBeNull();
  });
});

describe("marcar un bloque como «Hecho»", () => {
  it("no hace aparecer «No llegás a todo» donde el plan alcanzaba", () => {
    const morning = zonedInstant(TIMEZONE, "2026-11-03", 8 * 60);
    const now = zonedInstant(TIMEZONE, "2026-11-03", 15 * 60);
    const d = reducer(reducer(demoData(morning), { type: "refresh", now: morning }), {
      type: "refresh",
      now,
    });
    const options = (x: typeof d) => {
      const r = refreshPlan(x, now);
      return decisions(r.input, r.result, { data: x, now }).options.length;
    };
    expect(options(d)).toBe(0);
    const past = d.plan.filter((b) => b.end <= now);
    expect(past.length).toBeGreaterThan(0);
    for (const b of past) {
      const minutes = Math.round((b.end - b.start) / 60_000);
      const done = reducer(d, {
        type: "checkIn",
        checkIn: {
          blockId: b.id,
          taskId: b.taskId,
          status: "done",
          minutesDone: minutes,
          unitIds: [],
        },
        now,
      });
      expect(options(done)).toBe(0);
    }
  });
});

describe("la hoja de un silo", () => {
  const open = (name: RegExp) => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => demoData(NOW)} fixedNow={NOW}>
          <Silos />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name }));
  };

  it("la de un hábito no pide «Temas en total»", () => {
    open(/^Gym:/);
    expect(screen.queryByLabelText("Temas en total")).toBeNull();
  });

  it("explica por qué 240 min de bloque descuentan menos de estudio", () => {
    open(/^Parcial Cálculo II:/);
    expect(document.body.textContent).toMatch(
      /descansos: 4h de bloque descuentan ~3h20 de estudio/,
    );
  });
});
