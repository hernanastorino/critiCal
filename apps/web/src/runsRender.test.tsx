import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

/** The demo's first future block, plus a twin that starts where it ends. */
function twins(now: number) {
  const d = reducer(demoData(now), { type: "refresh", now });
  const first = d.plan.filter((b) => b.start > now).sort((a, b) => a.start - b.start)[0];
  if (!first) throw new Error("no block ahead");
  const length = first.end - first.start;
  const twin = { ...first, id: "twin", start: first.end, end: first.end + length };
  const clear = d.plan.filter(
    (b) => b.id !== first.id && (b.end <= first.start || b.start >= twin.end),
  );
  return { ...d, plan: [first, twin, ...clear] };
}

describe("blocks that touch, as one pill", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
  });
  afterEach(cleanup);

  it("draws one pill and lists its blocks in the sheet", () => {
    const data = twins(NOW);
    render(<App fixedNow={NOW} initial={() => data} />);
    const pill = screen.getByLabelText(/2 bloques seguidos/);
    expect(document.querySelectorAll(".pill.planned.run")).toHaveLength(1);
    // Tapping it opens the bubble, then the sheet with each block.
    fireEvent.click(pill, { clientX: 10, clientY: 10 });
    expect(screen.getByText(/2 bloques seguidos/)).toBeTruthy();
    fireEvent.click(document.querySelector(".bubble") as HTMLElement);
    const sheet = screen.getByRole("dialog");
    expect(sheet.querySelectorAll("section")).toHaveLength(2);
  });

  it("shows each block apart while editing", () => {
    render(<App fixedNow={NOW} initial={() => twins(NOW)} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    expect(screen.queryByLabelText(/bloques seguidos/)).toBeNull();
    expect(document.querySelector(".pill.planned.run")).toBeNull();
  });
});
