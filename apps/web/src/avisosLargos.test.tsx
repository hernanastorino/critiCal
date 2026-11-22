import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clipName } from "./format.js";
import { reducer, StoreProvider } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("avisos con un nombre largo", () => {
  it("clipName corta con «…» y deja en paz lo corto", () => {
    expect(clipName("Gym")).toBe("Gym");
    expect(clipName("  Gym  ")).toBe("Gym");
    const cut = clipName("A".repeat(500));
    expect(cut).toBe(`${"A".repeat(40)}…`);
  });

  it("«recuperada» no pone el nombre entero de un silo larguísimo", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const gym = d.tasks.find((t) => t.title === "Gym");
    if (!gym) throw new Error("no Gym in the demo");
    const long = `Gym ${"larguísimo ".repeat(40)}`.trim();
    const archived = reducer(d, {
      type: "saveTask",
      task: { ...gym, title: long, status: "dropped" },
      now: NOW,
    });
    render(
      <ToastProvider>
        <StoreProvider initial={() => archived} fixedNow={NOW}>
          <Silos />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Ver archivadas/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Recuperar/ }));
    const text = screen.getByText(/recuperada$/).textContent ?? "";
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(80);
  });
});
