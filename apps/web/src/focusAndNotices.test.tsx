import { existsSync, readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { RuleSettings, WeekSettings } from "./components/Preferences.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppTask } from "./model.js";
import { StoreProvider, seedHistory } from "./store.js";
import { tapDone } from "./testDone.js";

const MON = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);
const seeded = (now: number) =>
  seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now);
const deliverable = () => demoData(MON).tasks.find((t) => t.kind === "deliverable") as AppTask;

afterEach(() => {
  cleanup();
  clearDrafts();
});

describe("a refused save moves focus to the first invalid field", () => {
  it("«Guardar avance» with minutes that are not valid", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <TaskDetail task={deliverable()} onEdit={() => {}} onClose={() => {}} />
      </StoreProvider>,
    );
    for (const bad of ["-500", "1e3"]) {
      const field = screen.getByPlaceholderText("40");
      fireEvent.change(field, { target: { value: bad } });
      (document.activeElement as HTMLElement | null)?.blur();
      fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
      expect(document.activeElement).toBe(field);
      expect(field.getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("«Guardar» of a silo with negative hours", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <TaskEditor task={{ ...deliverable(), units: [] }} onClose={() => {}} />
      </StoreProvider>,
    );
    const hours = screen.getByLabelText("Horas estimadas");
    fireEvent.change(hours, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(document.activeElement).toBe(hours);
  });

  it("«Guardar reglas» and «Mi semana»", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <RuleSettings />
        <WeekSettings />
      </StoreProvider>,
    );
    const margin = screen.getByLabelText("Margen antes de cada evento (min)");
    fireEvent.change(margin, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect(document.activeElement).toBe(margin);
    const morning = screen.getByLabelText("Arreglarse, traslado (min)");
    fireEvent.change(morning, { target: { value: "-20" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(document.activeElement).toBe(morning);
  });
});

describe("notices and sheets", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
  });

  it("a notice from before is closed when Ajustes opens", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    tapDone(screen.getAllByLabelText(/^Hecho:/)[0] as HTMLElement);
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Semana/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  it("a notice made with Ajustes open stays, with its «Deshacer»", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    fireEvent.click(screen.getByText("Materias", { selector: ".settings-label" }));
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    expect(screen.queryByText("Física I")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(screen.getByText("Física I")).toBeTruthy();
  });
});

describe("Bandeja cards", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
  });

  it("names the partial button apart from the exam's name", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    expect(screen.getAllByLabelText(/^Hice una parte:/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/^Parcial u otro resultado/)).toBeNull();
  });

  it("the card title has a 44 px hit area", () => {
    const file = ["apps/web/src/styles.css", "src/styles.css"].find((f) => existsSync(f)) as string;
    const css = readFileSync(file, "utf8");
    const rule = css
      .split("}")
      .find((b) => b.split("{")[0]?.includes(".card > button.title::after"));
    expect(rule).toMatch(/height:\s*max\(100%,\s*44px\)/);
  });
});
