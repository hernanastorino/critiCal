import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider, useStore } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo
const start = (): AppData => reducer(demoData(NOW), { type: "refresh", now: NOW });

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};
const store = () => {
  if (!seen.store) throw new Error("missing");
  return seen.store;
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("18th round: the notice's «Deshacer» keeps what was done while it was visible", () => {
  it("«Eliminar todo», a new silo is made, «Deshacer»: the silo is back and the new one stays", () => {
    render(
      <StoreProvider initial={start} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Probe />
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText(/^Gym/));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gym" })).getByText("Eliminar…"));
    fireEvent.click(screen.getByText("Eliminar todo"));
    expect(store().data.tasks.some((t) => t.title === "Gym")).toBe(false);
    const other = store().data.tasks.at(0);
    if (!other) throw new Error("no task");
    act(() => {
      store().dispatch({
        type: "saveTask",
        task: { ...other, id: "made-since", title: "Hecha después" },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    const titles = store().data.tasks.map((t) => t.title);
    expect(titles).toContain("Gym");
    expect(titles).toContain("Hecha después");
  });
});
