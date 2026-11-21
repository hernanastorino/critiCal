import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "./components/BlockSheet.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { MINUTE, type PlanBlock } from "./engine.js";
import type { AppData } from "./model.js";
import { pinId } from "./planning.js";
import { reducer, StoreProvider } from "./store.js";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 2, 20);
const HOUR = 60 * MINUTE;

/** Three pinned blocks in a row, tomorrow: one of task A, then two of task B. */
function setup() {
  const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
  const a = d.tasks.find((t) => t.status === "active");
  const b = d.tasks.find((t) => t.status === "active" && t.id !== a?.id);
  if (!a || !b) throw new Error("two tasks needed");
  const at = NOW + 24 * HOUR;
  const block = (task: typeof a, start: number, hours: number): PlanBlock => ({
    id: pinId(task.id, start),
    taskId: task.id,
    activityId: task.activityId,
    start,
    end: start + hours * HOUR,
  });
  const first = block(a, at, 1);
  const run = [first, block(b, at + HOUR, 1.5), block(b, at + 2.5 * HOUR, 1)];
  const data: AppData = {
    ...d,
    pins: run,
    plan: [...run, ...d.plan.filter((x) => x.end <= at || x.start >= at + 3.5 * HOUR)],
  };
  return { data, run, first, a, b };
}

function open() {
  const { data, run, first, a, b } = setup();
  let saved: AppData | undefined;
  let closed = false;
  render(
    <StoreProvider
      initial={() => data}
      persist={false}
      fixedNow={NOW}
      onChange={(_, next) => {
        saved = next;
      }}
    >
      <BlockSheet
        item={{ kind: "block", id: "run", start: 0, end: 0, block: first, run }}
        onClose={() => {
          closed = true;
        }}
      />
    </StoreProvider>,
  );
  return { run, a, b, saved: () => saved, closed: () => closed };
}

describe("a run of pinned blocks in the sheet", () => {
  it("shows each task's details once and the next block of it only by its hours", () => {
    const { a, b } = open();
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getAllByRole("heading", { name: a.title })).toHaveLength(1);
    expect(within(sheet).getAllByRole("heading", { name: b.title })).toHaveLength(1);
    // The third block is B again: a large time range, named for VoiceOver with its task.
    const third = within(sheet).getByRole("region", { name: "Bloque 3" });
    const label = within(third).getByRole("heading").getAttribute("aria-label") ?? "";
    expect(label.startsWith(`${b.title}, `)).toBe(true);
    expect(label.slice(b.title.length + 2)).toMatch(/^\d\d:\d\d a \d\d:\d\d$/);
    expect(third.textContent).not.toMatch(/Faltan|Bloque planificado/);
  });

  it("offers «Soltar» per block, with no aside, and «Soltar todo»", () => {
    open();
    expect(screen.getAllByRole("button", { name: "Soltar" })).toHaveLength(3);
    expect(screen.queryByText(/que el plan decida/)).toBeNull();
    expect(screen.getByRole("button", { name: "Soltar todo" })).toBeTruthy();
  });

  it("«Soltar todo» frees every block of the run at once", () => {
    const { run, saved, closed } = open();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Soltar todo" }));
    });
    const ids = new Set(run.map((x) => x.id));
    expect(saved()?.pins?.some((p) => ids.has(p.id))).toBe(false);
    expect(saved()?.plan.some((p) => ids.has(p.id))).toBe(false);
    expect(closed()).toBe(true);
  });

  it("«Soltar» frees only its own block", () => {
    const { run, saved } = open();
    const second = screen.getByRole("region", { name: "Bloque 2" });
    act(() => {
      fireEvent.click(within(second).getByRole("button", { name: "Soltar" }));
    });
    expect(saved()?.pins?.map((p) => p.id)).toEqual([run[0]?.id, run[2]?.id]);
  });
});

describe("«Soltar todo» is one step back (21.ª vuelta)", () => {
  it("one «Deshacer» of the week brings every block of the run back, pinned", () => {
    const { data, run } = setup();
    const ids = run.map((b) => b.id);
    const freed = reducer(data, { type: "unpinAll", blockIds: ids, now: NOW });
    expect(freed.pins?.some((p) => ids.includes(p.id))).toBe(false);
    const back = reducer(freed, { type: "undoPlan", now: NOW });
    expect(back.pins?.map((p) => p.id).sort()).toEqual([...ids].sort());
  });

  it("says so with its own «Deshacer»", () => {
    const { data, run, first } = setup();
    render(
      <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <BlockSheet
            item={{ kind: "block", id: "run", start: 0, end: 0, block: first, run }}
            onClose={vi.fn()}
          />
        </ToastProvider>
      </StoreProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Soltar todo" }));
    });
    expect(screen.getByText("Soltaste 3 bloques · el plan los reacomodó")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeTruthy();
  });
});
