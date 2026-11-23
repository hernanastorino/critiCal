import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { diffData } from "./data.js";
import { demoSinRutina as demoData } from "./demoSinRutina.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider, useStore } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo

/** The demo with a past, answered block of Gym and a pin ahead, so there is history to lose. */
const start = (): AppData => {
  const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
  const gym = need(d.tasks.find((t) => t.title === "Gym"));
  const future = d.plan.find((b) => b.taskId === gym.id && b.start > NOW);
  const past = {
    id: "past",
    taskId: gym.id,
    activityId: gym.activityId,
    start: NOW - 7_200_000,
    end: NOW - 3_600_000,
  };
  return {
    ...d,
    plan: [past, ...d.plan],
    pins: future ? [{ ...future, id: "pin1" }] : [],
    checkIns: [
      {
        id: "c",
        blockId: "past",
        taskId: gym.id,
        status: "done",
        minutesDone: 60,
        unitIds: [],
        createdAt: NOW - 3_000_000,
      },
    ],
  };
};

function need<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
}

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};
const data = () => need(seen.store).data;
const gymOf = (d: AppData) => d.tasks.find((t) => t.title === "Gym");

const open = () => {
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
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("17th round: deleting a routine from its sheet can be undone", () => {
  it("«Eliminar todo» says so with «Deshacer» and puts everything back exactly", async () => {
    open();
    const before = data();
    const id = gymOf(before)?.id ?? "";
    fireEvent.click(screen.getByText("Eliminar todo"));
    expect(gymOf(data())).toBeUndefined();
    expect(data().checkIns.some((c) => c.taskId === id)).toBe(false);
    expect(screen.getAllByText(/Gym eliminada/).length).toBeGreaterThan(0);
    // Focus goes somewhere useful, not to the page.
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H1"));
    const afterDelete = data();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    const back = data();
    expect(gymOf(back)).toEqual(gymOf(before));
    expect(back.checkIns.filter((c) => c.taskId === id)).toEqual(
      before.checkIns.filter((c) => c.taskId === id),
    );
    expect(back.plan.filter((b) => b.taskId === id)).toEqual(
      before.plan.filter((b) => b.taskId === id),
    );
    expect(back.pins).toEqual(before.pins);
    // With an account the delete may already be saved: the undo writes the task and its
    // record again once, and nothing twice.
    const w = diffData(afterDelete, back);
    expect(w.upserts.some((u) => u.table === "tasks" && u.rows.some((r) => r.id === id))).toBe(
      true,
    );
    const rows = w.inserts.filter((i) => i.table === "check_ins").flatMap((i) => i.rows);
    expect(rows.map((r) => r.id)).toEqual(["c"]);
    // The focus lands on the restored silo.
    await waitFor(() => expect(document.activeElement?.getAttribute("data-task")).toBe(id));
  });

  it("«Eliminar de hoy en adelante» can be undone too", () => {
    open();
    const before = data();
    fireEvent.click(screen.getByText("Eliminar de hoy en adelante"));
    expect(gymOf(data())?.status).toBe("dropped");
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(gymOf(data())).toEqual(gymOf(before));
    expect(data().pins).toEqual(before.pins);
    expect(data().plan.filter((b) => b.taskId === gymOf(before)?.id)).toEqual(
      before.plan.filter((b) => b.taskId === gymOf(before)?.id),
    );
  });
});
