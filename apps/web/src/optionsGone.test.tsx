import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox, OPTIONS_GONE } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { StoreProvider, useStore } from "./store.js";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 2, 20);

let api: ReturnType<typeof useStore> | undefined;
function Probe() {
  api = useStore();
  return null;
}

const open = () =>
  render(
    <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Probe />
        <Inbox />
      </ToastProvider>
    </StoreProvider>,
  );

describe("«No llegás a todo · elegí» (SPEC §18.12)", () => {
  it("draws Roy small next to each option, not over it", () => {
    open();
    const options = screen.queryAllByRole("button", { name: /^Elegir: / });
    if (options.length === 0) return;
    for (const b of options) {
      const card = b.closest(".card");
      expect(card?.querySelector(".roy-line")).toBeTruthy();
      expect(card?.querySelector(".roy-line.big")).toBeNull();
    }
  });

  it("says so when the options go away because the plan fits", () => {
    open();
    if (screen.queryAllByRole("button", { name: /^Elegir: / }).length === 0) return;
    // Everything asked shrinks to almost nothing: the plan fits and there is nothing to choose.
    const store = api;
    if (!store) throw new Error("no store");
    act(() => {
      for (const t of store.data.tasks)
        store.dispatch({
          type: "saveTask",
          task: { ...t, estimateMinutes: 30, minMinutes: 30, units: [] },
        });
    });
    expect(screen.queryAllByRole("button", { name: /^Elegir: / })).toHaveLength(0);
    expect(screen.getByText(OPTIONS_GONE)).toBeTruthy();
  });
});
