import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "./components/BlockSheet.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { pendingConfirmations, progress } from "./planning.js";
import { StoreProvider, seedHistory, useStore } from "./store.js";

const LATER = zonedInstant(TIMEZONE, "2026-11-04", 17 * 60 + 50);

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};
function need<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("16th round: correcting keeps the parts the record declares", () => {
  it("Hecho (p1) → Corregir → Parcial without touching the parts: p1 stays done", async () => {
    const d0 = seedHistory({ ...demoData(LATER), preferences: { holidaysOff: false } }, LATER);
    const b = need(pendingConfirmations(d0, LATER).at(0));
    const d: AppData = {
      ...d0,
      tasks: d0.tasks.map((t) =>
        t.id === b.taskId
          ? {
              ...t,
              units: [
                { id: "u1", title: "Tema uno", estimateMinutes: 60 },
                { id: "u2", title: "Tema dos", estimateMinutes: 60 },
              ],
            }
          : t,
      ),
    };
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={LATER}>
        <ToastProvider>
          <Probe />
          <BlockSheet
            item={{ kind: "block", id: b.id, start: b.start, end: b.end, block: b }}
            onClose={vi.fn()}
          />
        </ToastProvider>
      </StoreProvider>,
    );
    const store = () => need(seen.store);
    const units = () => store().data.tasks.find((t) => t.id === b.taskId)?.units ?? [];
    fireEvent.click(screen.getByLabelText(/Tema uno/));
    press("✓ Hecho");
    expect(units().find((u) => u.id === "u1")?.doneAt).toBeDefined();
    const left = progress(store().data, LATER).find(
      (p) => p.task.id === b.taskId,
    )?.remainingMinutes;
    press("Corregir");
    // Offered although done, and ticked from the start.
    expect(screen.getByRole("checkbox", { name: /Tema uno/ })).toHaveProperty("checked", true);
    press("◐ Parcial");
    press("Guardar parcial");
    expect(units().find((u) => u.id === "u1")?.doneAt).toBeDefined();
    const after = progress(store().data, LATER).find(
      (p) => p.task.id === b.taskId,
    )?.remainingMinutes;
    expect(after).toBe(left);
  });
});
