import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { reducer, StoreProvider, seedHistory } from "./store.js";

// Monday 2026-11-02, 8:00.
const NOW = zonedInstant("America/Montevideo", "2026-11-02", 8 * 60);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

describe("focus never falls to the page", () => {
  it("after the last «Deshacer: mover o fijar un bloque»", async () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d.plan.find((b) => b.start > NOW);
    if (!block) throw new Error("the demo plans something ahead");
    const pinned = reducer(d, {
      type: "pin",
      blockId: block.id,
      start: block.start + 3_600_000,
      now: NOW,
    });
    render(<App fixedNow={NOW} initial={() => pinned} />);
    const undo = screen.getByRole("button", { name: /^Deshacer: mover o fijar un bloque/ });
    undo.focus();
    fireEvent.click(undo);
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("after «Guardar parcial» of a block in the Bandeja", async () => {
    // Monday 17:50: blocks of the day are over and not answered yet.
    const later = zonedInstant("America/Montevideo", "2026-11-02", 17 * 60 + 50);
    const d = seedHistory({ ...demoData(later), preferences: { holidaysOff: false } }, later);
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={later}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const parts = screen.getAllByRole("button", { name: /^Hice una parte:/ });
    const first = parts[0] as HTMLElement;
    first.focus();
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Parcial" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar parcial" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("after «Listo» of the edit mode", async () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Modo edición/ }));
    const done = screen.getByRole("button", { name: "Listo" });
    done.focus();
    fireEvent.click(done);
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/Modo edición/);
  });
});
