import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";
import { dropTarget, nearestFree } from "./drag.js";
import { localParts, zonedInstant } from "./engine.js";
import { time, weekdayShort } from "./format.js";
import type { AppData } from "./model.js";
import { isPinned, pinClashes, pinShortfall, refreshPlan } from "./planning.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

/**
 * Pointer position, with the mocked 50px-wide, 1000px-tall day columns, that drops a
 * block grabbed 10px below its top so it starts at `start`.
 */
function spot(d: AppData, start: number) {
  const tz = d.settings.timezone;
  const { date } = localParts(tz, start);
  const startMin = Math.min(...d.settings.week.map((w) => w.wake));
  const endMin = Math.max(...d.settings.week.map((w) => (w.bed <= w.wake ? w.bed + 1440 : w.bed)));
  const minute = (start - zonedInstant(tz, date, 0)) / 60_000;
  return {
    x: (Number(date.slice(8)) - 2) * 50 + 25,
    y: ((minute - startMin) / (endMin - startMin)) * 1000 + 10,
  };
}

/**
 * Demo data where the parcial needs exactly what the plan can give it, so any block
 * pinned over one of its sessions puts its minimum out of reach.
 */
function tight(now: number): AppData {
  const squeeze = (min: number) => {
    const d = demoData(now);
    return {
      ...d,
      // No breaks: the squeeze is about the parcial's hours, not about rest.
      activities: d.activities.map((a) => ({ ...a, breakMinutes: 0 })),
      tasks: d.tasks.map((t) =>
        t.id === "parcial-calc" ? { ...t, minMinutes: min, estimateMinutes: min, units: [] } : t,
      ),
    };
  };
  const most = refreshPlan(squeeze(10_000), now).result.status.find(
    (s) => s.taskId === "parcial-calc",
  );
  return squeeze(most?.scheduledMinutes ?? 0);
}

describe("dropTarget", () => {
  const cols = [
    { date: "2026-11-02", left: 0, right: 50, top: 0, bottom: 1000 },
    { date: "2026-11-03", left: 50, right: 100, top: 0, bottom: 1000 },
  ];
  it("snaps to the column and slot under the pointer", () => {
    expect(dropTarget(cols, 60, 500, 480, 1440, 60)).toEqual({ date: "2026-11-03", minute: 960 });
    expect(dropTarget(cols, 10, 0, 480, 1440, 60)).toEqual({ date: "2026-11-02", minute: 480 });
    // Never past the end of the day; nearest column when outside.
    expect(dropTarget(cols, 500, 2000, 480, 1440, 90)).toEqual({
      date: "2026-11-03",
      minute: 1350,
    });
    expect(dropTarget([], 0, 0, 480, 1440, 60)).toBeNull();
    // Off-grid wake/bed (07:15–23:45) still lands on 30-minute marks.
    expect(dropTarget(cols, 10, 1000, 435, 1425, 60)).toEqual({ date: "2026-11-02", minute: 1350 });
    expect(dropTarget(cols, 10, 0, 435, 1425, 60)).toEqual({ date: "2026-11-02", minute: 450 });
  });
});

describe("nearestFree", () => {
  const busy = [{ start: 720, end: 840 }];
  it("keeps a free slot and shifts off busy ones to the closest gap", () => {
    expect(nearestFree(600, 60, busy, 30, 480, 1440)).toBe(600);
    // 12:30 overlaps the 12–14 class: after it (14:00) is 90 min away, before (11:00) too; later wins.
    expect(nearestFree(750, 60, busy, 30, 480, 1440)).toBe(840);
    expect(nearestFree(690, 60, busy, 30, 480, 1440)).toBe(660);
    expect(nearestFree(500, 60, [{ start: 0, end: 1440 }], 30, 480, 1440)).toBeNull();
    // A drop far above the next free slot of today lands on that slot.
    expect(nearestFree(480, 60, [], 30, 1050, 1440)).toBe(1050);
  });
});

describe("pins", () => {
  const start = (): AppData => reducer(demoData(NOW), { type: "refresh", now: NOW });

  it("pins a moved block, plans around it and can let it go", () => {
    const d = start();
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const target = block.start + 24 * 3_600_000;
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: target, now: NOW });
    const pin = pinned.pins?.[0];
    expect(pin && isPinned(pin)).toBe(true);
    expect((pin?.end ?? 0) - (pin?.start ?? 0)).toBe(block.end - block.start);
    expect(pinned.plan.some((b) => b.id === pin?.id && b.start === target)).toBe(true);
    // Other blocks never overlap the pin.
    for (const b of pinned.plan.filter((x) => x.id !== pin?.id)) {
      expect(b.end <= target || b.start >= (pin?.end ?? 0)).toBe(true);
    }
    // Replanning keeps it.
    expect(refreshPlan(pinned, NOW + 60_000).plan.some((b) => b.id === pin?.id)).toBe(true);
    const freed = reducer(pinned, { type: "unpin", blockId: pin?.id as string, now: NOW });
    expect(freed.pins).toEqual([]);
    expect(reducer(d, { type: "pin", blockId: "nope", start: target, now: NOW })).toBe(d);
  });

  it("ignores drops on slots that already passed", () => {
    const d = start();
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    expect(reducer(d, { type: "pin", blockId: block.id, start: NOW - 3_600_000, now: NOW })).toBe(
      d,
    );
  });

  it("keeps a single copy of later pins when today's plan clashes", () => {
    const morning = Date.UTC(2026, 10, 2, 11); // 08:00 in Montevideo
    const d = reducer(demoData(morning), { type: "refresh", now: morning });
    const midnight = morning + 16 * 3_600_000;
    const today = d.plan.find((b) => b.start > morning && b.end <= midnight);
    const later = d.plan.find((b) => b.start >= midnight) as AppData["plan"][number];
    expect(today).toBeTruthy();
    const pinned = reducer(d, { type: "pin", blockId: later.id, start: later.start, now: morning });
    const clash: AppData["events"][number] = {
      id: "clash",
      title: "Reunión",
      start: today?.start ?? 0,
      end: today?.end ?? 0,
      busy: true,
      source: "demo",
    };
    const { plan, proposal } = refreshPlan(
      { ...pinned, events: [...pinned.events, clash] },
      morning,
    );
    expect(proposal).toBeTruthy();
    const ids = plan.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops onto another pin exactly and gives that one back to the plan", () => {
    const d = start();
    const [a, b] = d.plan.filter(
      (x) => x.start > NOW && x.taskId === d.plan.find((y) => y.start > NOW)?.taskId,
    );
    expect(a && b).toBeTruthy();
    const target = (b?.start ?? 0) + 24 * 3_600_000;
    const once = reducer(d, { type: "pin", blockId: a?.id as string, start: target, now: NOW });
    // Same task, same slot: the new pin takes the place, the old one is planned again.
    const twice = reducer(once, { type: "pin", blockId: b?.id as string, start: target, now: NOW });
    expect(twice.pins?.map((p) => p.start)).toEqual([target]);
    expect(twice.plan.filter((x) => x.start < target + 1 && x.end > target)).toHaveLength(1);
    // Half an hour later still overlaps: the earlier pin goes back to the plan too.
    const c = d.plan.find((x) => x.start > NOW && x.taskId !== a?.taskId);
    const shifted = reducer(once, {
      type: "pin",
      blockId: c?.id as string,
      start: target + 30 * 60_000,
      now: NOW,
    });
    expect(shifted.pins?.map((p) => p.start)).toEqual([target + 30 * 60_000]);
    for (const x of shifted.plan.filter((y) => y.id !== shifted.pins?.[0]?.id && y.end > NOW)) {
      expect(x.end <= target + 30 * 60_000 || x.start >= (shifted.pins?.[0]?.end ?? 0)).toBe(true);
    }
  });

  it("keeps a pin already under way when another lands on it", () => {
    const d = start();
    const [a, b] = d.plan.filter((x) => x.start > NOW);
    const pinned = reducer(d, {
      type: "pin",
      blockId: a?.id as string,
      start: a?.start as number,
      now: NOW,
    });
    const running = (a?.start as number) + 60_000;
    const over = reducer(
      { ...pinned, plan: pinned.plan },
      {
        type: "pin",
        blockId: b?.id as string,
        start: (a?.start as number) + 30 * 60_000,
        now: running,
      },
    );
    // Both stay: the running one is frozen, the new one lands where it was dropped.
    expect(over.pins?.map((p) => p.start).sort()).toEqual(
      [a?.start as number, (a?.start as number) + 30 * 60_000].sort(),
    );
  });

  it("reports pins that a new event overlaps and keeps them", () => {
    const d = start();
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    const event = {
      id: "x",
      title: "Dentista",
      start: block.start,
      end: block.end,
      busy: true,
      source: "demo" as const,
    };
    const later = reducer(
      { ...pinned, events: [...pinned.events, event] },
      { type: "refresh", now: NOW },
    );
    expect(pinClashes(later, NOW).map((c) => c.event.title)).toEqual(["Dentista"]);
    expect(later.pins).toHaveLength(1);
  });

  it("tells which minimums the pins put out of reach", () => {
    const d = reducer(tight(NOW), { type: "refresh", now: NOW });
    expect(pinShortfall(d, NOW).short).toEqual([]);
    const session = d.plan.find((b) => b.taskId === "parcial-calc" && b.start > NOW);
    const other = d.plan.find((b) => b.taskId !== "parcial-calc" && b.start > NOW);
    const pinned = reducer(d, {
      type: "pin",
      blockId: other?.id as string,
      start: session?.start as number,
      now: NOW,
    });
    const { pins, short } = pinShortfall(pinned, NOW);
    expect(pins).toHaveLength(1);
    expect(short).toEqual([{ taskId: "parcial-calc", minutes: expect.any(Number) }]);
    // Pins that already started are history, not a choice to revisit.
    expect(pinShortfall(pinned, pins[0]?.start as number).pins).toEqual([]);
  });

  it("turns past pins into history", () => {
    const d = start();
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    const later = reducer(pinned, { type: "refresh", now: block.end + 1 });
    expect(later.pins).toEqual([]);
    expect(later.plan.some((b) => isPinned(b))).toBe(true);
  });
});

describe("edit mode", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const date = this.dataset?.date;
      if (date) {
        const i = Number(date.slice(8)) - 2;
        return {
          left: i * 50,
          right: i * 50 + 50,
          top: 0,
          bottom: 1000,
          width: 50,
          height: 1000,
          x: 0,
          y: 0,
          toJSON() {},
        } as DOMRect;
      }
      return {
        left: 0,
        right: 30,
        top: 100,
        bottom: 160,
        width: 30,
        height: 60,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRect;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("drags a block to another day and pins it", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    const toggle = screen.getByLabelText("Modo edición");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const capture = vi.fn();
    HTMLElement.prototype.setPointerCapture = capture;
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    // A cancelled gesture (system swipe, context menu) leaves nothing behind.
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 9 });
    fireEvent.pointerMove(pill, { clientX: 60, clientY: 300, pointerId: 9 });
    expect(document.querySelector(".pill.dragging")).toBeTruthy();
    fireEvent.pointerCancel(pill, { pointerId: 9 });
    expect(document.querySelector(".pill.dragging")).toBeNull();
    expect(capture).toHaveBeenCalledWith(9);

    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 160, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(pill, { clientX: 160, clientY: 400, pointerId: 1 });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins).toHaveLength(1);
    expect(document.querySelector(".pill.pinned")).toBeTruthy();

    // A tap (no movement) in edit mode opens the bubble instead.
    const again = document.querySelector(".pill.planned.movable") as HTMLElement;
    fireEvent.pointerDown(again, { clientX: 10, clientY: 110, pointerId: 2 });
    fireEvent.pointerUp(again, { clientX: 11, clientY: 111, pointerId: 2 });
    expect(document.querySelector(".bubble")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);

    // Pointer clicks stay with the drag handlers; keyboard activation opens the bubble.
    fireEvent.click(again, { detail: 1 });
    expect(document.querySelector(".bubble")).toBeNull();
    fireEvent.click(again, { detail: 0 });
    expect(document.querySelector(".bubble")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);

    fireEvent.click(screen.getByText("Listo"));
    expect(document.querySelector(".week.editing")).toBeNull();
  });

  it("moves a block with the arrow keys and keeps focus on it", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    pill.focus();
    fireEvent.keyDown(pill, { key: "ArrowDown" });
    const moved = document.querySelector(".pill.pinned") as HTMLElement;
    expect(moved).toBeTruthy();
    expect(document.activeElement).toBe(moved);
    fireEvent.keyDown(moved, { key: "ArrowRight" });
    fireEvent.keyDown(moved, { key: "a" });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins).toHaveLength(1);
  });

  it("shows clashing pins in the inbox and lets them go", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    const event = {
      id: "x",
      title: "Dentista",
      start: block.start,
      end: block.end,
      busy: true,
      source: "demo" as const,
    };
    render(
      <App fixedNow={NOW} initial={() => ({ ...pinned, events: [...pinned.events, event] })} />,
    );
    fireEvent.click(screen.getByText("Bandeja"));
    expect(screen.getByText(/Choca con Dentista/)).toBeTruthy();
    fireEvent.click(screen.getByText("Soltar (que el plan decida)"));
    expect(screen.queryByText(/Choca con Dentista/)).toBeNull();
  });

  it("marks the landing start and end on the hour axis only while dragging", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const week = demoData(NOW).settings.week;
    const startMin = Math.min(...week.map((d) => d.wake));
    const endMin = Math.max(...week.map((d) => (d.bed <= d.wake ? d.bed + 1440 : d.bed)));
    const hot = () => [...document.querySelectorAll(".hours .hot")].map((e) => e.textContent);
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    // Grab 10px below the pill's top; aim its top at 12:00 exactly.
    const y = ((720 - startMin) / (endMin - startMin)) * 1000 + 10;
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 3 });
    expect(hot()).toEqual([]);
    fireEvent.pointerMove(pill, { clientX: 160, clientY: y, pointerId: 3 });
    const marks = hot();
    // 12 already sits on the axis, so that label turns red instead of a new one.
    expect(marks).toHaveLength(2);
    expect(marks).toContain("12");
    expect(document.querySelectorAll(".hours span").length).toBe(
      [9, 12, 15, 18, 21].filter((h) => h * 60 > startMin && h * 60 < endMin).length + 1,
    );
    // Off the hour it writes the minutes.
    fireEvent.pointerMove(pill, {
      clientX: 160,
      clientY: y + (30 / (endMin - startMin)) * 1000,
      pointerId: 3,
    });
    // Start and end, the end derived from the dragged block's own length.
    const shown = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const label = pill.getAttribute("aria-label") ?? "";
    const dragged = shown.plan.find((b) =>
      label.startsWith(
        `${shown.tasks.find((t) => t.id === b.taskId)?.title}, ${weekdayShort(shown.settings.timezone, b.start)} ${time(shown.settings.timezone, b.start)}`,
      ),
    ) as AppData["plan"][number];
    const end = 750 + (dragged.end - dragged.start) / 60_000;
    const endLabel =
      end % 60 === 0
        ? `${end / 60}`
        : `${Math.floor(end / 60)}:${String(end % 60).padStart(2, "0")}`;
    expect(hot().sort()).toEqual(["12:30", endLabel].sort());
    // The block snaps into its landing slot, with guides and a loupe.
    expect(document.querySelector('[data-date="2026-11-05"] .pill.ghost')).toBeTruthy();
    expect(document.querySelectorAll(".guides .guide")).toHaveLength(2);
    expect(document.querySelector(".loupe")?.textContent).toMatch(/jue 5 · 12:30–/);
    fireEvent.pointerUp(pill, { clientX: 160, clientY: y, pointerId: 3 });
    expect(hot()).toEqual([]);
    expect(document.querySelector(".pill.ghost, .guides, .loupe")).toBeNull();
  });

  it("drops next to a fixed event instead of on top of it", () => {
    const tz = demoData(NOW).settings.timezone;
    const clash = {
      id: "class",
      title: "Clase",
      start: zonedInstant(tz, "2026-11-05", 720),
      end: zonedInstant(tz, "2026-11-05", 840),
      busy: true,
      source: "demo" as const,
    };
    render(
      <App
        fixedNow={NOW}
        initial={(n) => ({ ...demoData(n), events: [...demoData(n).events, clash] })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const week = demoData(NOW).settings.week;
    const startMin = Math.min(...week.map((d) => d.wake));
    const endMin = Math.max(...week.map((d) => (d.bed <= d.wake ? d.bed + 1440 : d.bed)));
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    const y = ((750 - startMin) / (endMin - startMin)) * 1000 + 10;
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 4 });
    fireEvent.pointerMove(pill, { clientX: 160, clientY: y, pointerId: 4 });
    fireEvent.pointerUp(pill, { clientX: 160, clientY: y, pointerId: 4 });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    const pin = saved.pins?.[0];
    expect(pin).toBeTruthy();
    expect((pin?.end ?? 0) <= clash.start || (pin?.start ?? 0) >= clash.end).toBe(true);
  });

  it("drops exactly on a flexible event and offers to move the event", () => {
    const tz = demoData(NOW).settings.timezone;
    const gym = {
      id: "gym",
      title: "Gym #flex",
      start: zonedInstant(tz, "2026-11-05", 720),
      end: zonedInstant(tz, "2026-11-05", 840),
      busy: true,
      source: "demo" as const,
    };
    const initial = (n: number) => ({ ...demoData(n), events: [...demoData(n).events, gym] });
    render(<App fixedNow={NOW} initial={initial} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    const at = zonedInstant(tz, "2026-11-05", 750);
    const { x, y } = spot(initial(NOW), at);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 4 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 4 });
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 4 });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins?.[0]?.start).toBe(at);
    expect(
      screen.getByText(/Quedó sobre Gym #flex: en la Bandeja te propongo moverlo/),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Bandeja"));
    expect(screen.getByText(/Está sobre Gym #flex, que se puede mover/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mover Gym #flex" }));
    const moved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    const move = moved.movedEvents?.[0];
    expect(move?.eventId).toBe("gym");
    // Off the pin, which stays where it was dropped.
    expect((move?.end ?? 0) <= at || (move?.start ?? 0) >= (moved.pins?.[0]?.end ?? 0)).toBe(true);
    expect(moved.pins?.[0]?.start).toBe(at);
    expect(screen.queryByText(/Está sobre Gym/)).toBeNull();
    expect(screen.getByText("Para mover en tu calendario")).toBeTruthy();
  });

  it("drops exactly on another pin, gives it back to the plan and undoes both", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const tz = d.settings.timezone;
    const [a, b] = d.plan.filter((x) => x.start > NOW && x.taskId !== d.plan[0]?.taskId);
    const at = zonedInstant(tz, "2026-11-05", 750);
    const first = reducer(d, { type: "pin", blockId: a?.id as string, start: at, now: NOW });
    render(<App fixedNow={NOW} initial={() => first} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const title = d.tasks.find((t) => t.id === b?.taskId)?.title;
    const pill = screen.getByLabelText((_c, el) =>
      (el?.getAttribute("aria-label") ?? "").startsWith(
        `${title}, ${weekdayShort(tz, b?.start as number)} ${time(tz, b?.start as number)}`,
      ),
    );
    const { x, y } = spot(d, at);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 7 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 7 });
    // The pin under it is shown as about to move.
    expect(screen.getByLabelText(/, fijado/).classList.contains("displaced")).toBe(true);
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 7 });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins?.map((p) => [p.taskId, p.start])).toEqual([[b?.taskId, at]]);
    expect(screen.getByText(/volvió al plan/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    const undone = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(undone.pins?.map((p) => [p.taskId, p.start])).toEqual([[a?.taskId, at]]);
  });

  it("drops the undo of a freed pin once the plan changes again", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const tz = d.settings.timezone;
    const [a, b] = d.plan.filter((x) => x.start > NOW && x.taskId !== d.plan[0]?.taskId);
    const at = zonedInstant(tz, "2026-11-05", 750);
    const first = reducer(d, { type: "pin", blockId: a?.id as string, start: at, now: NOW });
    render(<App fixedNow={NOW} initial={() => first} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const title = d.tasks.find((t) => t.id === b?.taskId)?.title;
    const pill = screen.getByLabelText((_c, el) =>
      (el?.getAttribute("aria-label") ?? "").startsWith(
        `${title}, ${weekdayShort(tz, b?.start as number)} ${time(tz, b?.start as number)}`,
      ),
    );
    const { x, y } = spot(d, at);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 7 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 7 });
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 7 });
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeTruthy();
    // A replan after it: its undo would take back the replan, not the drop.
    fireEvent.click(screen.getByLabelText("Reacomodar semana"));
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  it("does not promise to move a flexible event already under way", () => {
    const tz = demoData(NOW).settings.timezone;
    const at = zonedInstant(tz, "2026-11-05", 750);
    const gym = {
      id: "gym",
      title: "Gym #flex",
      start: NOW - 3_600_000,
      end: at + 3 * 3_600_000,
      busy: true,
      source: "demo" as const,
    };
    const initial = (n: number) => ({ ...demoData(n), events: [...demoData(n).events, gym] });
    render(<App fixedNow={NOW} initial={initial} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    const { x, y } = spot(initial(NOW), at);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 4 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 4 });
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 4 });
    expect(screen.getByText(/Quedó sobre Gym #flex: revisá el choque en la Bandeja/)).toBeTruthy();
    fireEvent.click(screen.getByText("Bandeja"));
    expect(screen.getByText(/Choca con Gym #flex/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mover Gym #flex" })).toBeNull();
  });

  it("does not promise to move a flexible event with nowhere to go", () => {
    const tz = demoData(NOW).settings.timezone;
    const at = zonedInstant(tz, "2026-11-07", 750);
    // Longer than any waking day: there is no spot for it.
    const trip = {
      id: "trip",
      title: "Paseo #flex",
      start: zonedInstant(tz, "2026-11-07", 360),
      end: zonedInstant(tz, "2026-11-07", 360) + 20 * 3_600_000,
      busy: true,
      source: "demo" as const,
    };
    const initial = (n: number) => ({ ...demoData(n), events: [...demoData(n).events, trip] });
    render(<App fixedNow={NOW} initial={initial} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const pill = document.querySelector(".pill.planned.movable") as HTMLElement;
    const { x, y } = spot(initial(NOW), at);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 4 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 4 });
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 4 });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins?.[0]?.start).toBe(at);
    expect(
      screen.getByText(/Quedó sobre Paseo #flex: revisá el choque en la Bandeja/),
    ).toBeTruthy();
    // Its undo goes too once the plan changes again.
    fireEvent.click(screen.getByLabelText("Reacomodar semana"));
    expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  });

  it("drops over the plan's blocks, warns when a minimum breaks and undoes it", () => {
    const d = reducer(tight(NOW), { type: "refresh", now: NOW });
    const tz = d.settings.timezone;
    const session = d.plan.find((b) => b.taskId === "parcial-calc" && b.start > NOW);
    const other = d.plan.find(
      (b) => b.taskId !== "parcial-calc" && b.start > NOW,
    ) as AppData["plan"][number];
    render(<App fixedNow={NOW} initial={tight} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const title = d.tasks.find((t) => t.id === other.taskId)?.title;
    const pill = screen.getByLabelText((_c, el) =>
      (el?.getAttribute("aria-label") ?? "").startsWith(
        `${title}, ${weekdayShort(tz, other.start)} ${time(tz, other.start)}`,
      ),
    );
    const { x, y } = spot(d, session?.start as number);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 3 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 3 });
    // The parcial's session under the landing spot is shown as about to move.
    expect(document.querySelector(".pill.displaced")).toBeTruthy();
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 3 });
    expect(document.querySelector(".pill.displaced")).toBeNull();
    const pinned = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(pinned.pins?.[0]?.start).toBe(session?.start);
    expect(screen.getByText(/Con esto no llegás: faltan .* de Parcial Cálculo II/)).toBeTruthy();
    // The inbox has it too, with the pin to let go.
    expect(screen.getByText("Bandeja").parentElement?.querySelector(".badge")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    const undone = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(undone.pins).toEqual([]);
    expect(screen.queryByText(/Con esto no llegás/)).toBeNull();
  });

  it("puts a moved pin back where it was on undo", () => {
    const d = reducer(tight(NOW), { type: "refresh", now: NOW });
    const session = d.plan.find((b) => b.taskId === "parcial-calc" && b.start > NOW);
    const other = d.plan.find(
      (b) => b.taskId !== "parcial-calc" && b.start > NOW,
    ) as AppData["plan"][number];
    // Already pinned where the plan had it; moving it onto the parcial breaks the minimum.
    const first = reducer(d, { type: "pin", blockId: other.id, start: other.start, now: NOW });
    const pin = first.pins?.[0] as AppData["plan"][number];
    expect(pinShortfall(first, NOW).short).toEqual([]);
    render(<App fixedNow={NOW} initial={() => first} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const { x, y } = spot(d, session?.start as number);
    const pill = screen.getByLabelText(/, fijado/);
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 8 });
    fireEvent.pointerMove(pill, { clientX: x, clientY: y, pointerId: 8 });
    fireEvent.pointerUp(pill, { clientX: x, clientY: y, pointerId: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins?.map((p) => p.start)).toEqual([pin.start]);
  });

  it("lists pins that break a minimum in the inbox and lets them go", () => {
    const d = reducer(tight(NOW), { type: "refresh", now: NOW });
    const session = d.plan.find((b) => b.taskId === "parcial-calc" && b.start > NOW);
    const other = d.plan.find((b) => b.taskId !== "parcial-calc" && b.start > NOW);
    const pinned = reducer(d, {
      type: "pin",
      blockId: other?.id as string,
      start: session?.start as number,
      now: NOW,
    });
    render(<App fixedNow={NOW} initial={() => pinned} />);
    fireEvent.click(screen.getByText("Bandeja"));
    expect(screen.getByText("Lo que fijaste no te deja llegar")).toBeTruthy();
    expect(screen.getByText(/faltan .* de Parcial Cálculo II/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Soltar" }));
    expect(screen.queryByText("Lo que fijaste no te deja llegar")).toBeNull();
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins).toEqual([]);
  });

  it("pins a block where the plan put it, from its bubble", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    // The last one is surely ahead, not running.
    const pill = [...document.querySelectorAll<HTMLElement>(".pill.planned:not(.past)")].at(
      -1,
    ) as HTMLElement;
    fireEvent.click(pill, { clientX: 10, clientY: 10 });
    expect(screen.getByText("Lo puso el plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fijar acá" }));
    expect(document.querySelector(".bubble")).toBeNull();
    expect(screen.getByLabelText(/, fijado/)).toBeTruthy();
    expect(screen.getByText(/Fijado acá/)).toBeTruthy();
  });

  describe("long-press outside edit mode", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());
    const future = () =>
      [...document.querySelectorAll<HTMLElement>(".pill.planned:not(.past)")].at(-1) as HTMLElement;

    it("starts a drag after holding and pins where it is dropped", () => {
      render(<App fixedNow={NOW} initial={demoData} />);
      const pill = future();
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 5 });
      fireEvent.pointerMove(pill, { clientX: 12, clientY: 112, pointerId: 5 });
      expect(document.querySelector(".pill.dragging")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(document.querySelector(".pill.dragging")).toBeTruthy();
      fireEvent.pointerMove(pill, { clientX: 160, clientY: 600, pointerId: 5 });
      fireEvent.pointerUp(pill, { clientX: 160, clientY: 600, pointerId: 5 });
      fireEvent.click(pill, { detail: 1 });
      expect(document.querySelector(".bubble")).toBeNull();
      const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
      expect(saved.pins).toHaveLength(1);
      // Another block still opens right away.
      const other = document.querySelector<HTMLElement>(
        ".pill.planned:not(.pinned)",
      ) as HTMLElement;
      fireEvent.click(other, { detail: 1 });
      expect(document.querySelector(".bubble")).toBeTruthy();
    });

    it("ignores the click that ends a drag even when it arrives late", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      render(<App fixedNow={NOW} initial={demoData} />);
      const pill = future();
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 8 });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      fireEvent.pointerMove(pill, { clientX: 160, clientY: 600, pointerId: 8 });
      fireEvent.pointerUp(pill, { clientX: 160, clientY: 600, pointerId: 8 });
      // A slow phone still replanning: the click comes two seconds later.
      vi.setSystemTime(Date.now() + 2000);
      fireEvent.click(pill, { detail: 1 });
      expect(document.querySelector(".bubble")).toBeNull();
      // The next tap on it opens as usual.
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 9 });
      fireEvent.pointerUp(pill, { clientX: 10, clientY: 110, pointerId: 9 });
      fireEvent.click(pill, { detail: 1 });
      expect(document.querySelector(".bubble")).toBeTruthy();
    });

    it("keeps short taps as taps and early movement as a scroll", () => {
      render(<App fixedNow={NOW} initial={demoData} />);
      const pill = future();
      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 6 });
      fireEvent.pointerUp(pill, { clientX: 10, clientY: 110, pointerId: 6 });
      fireEvent.click(pill, { detail: 1 });
      expect(document.querySelector(".bubble")).toBeTruthy();
      fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);

      fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 7 });
      fireEvent.pointerMove(pill, { clientX: 10, clientY: 140, pointerId: 7 });
      act(() => {
        vi.advanceTimersByTime(450);
      });
      expect(document.querySelector(".pill.dragging")).toBeNull();
      fireEvent.pointerCancel(pill, { pointerId: 7 });
    });
  });

  it("lets a pinned block go from its sheet", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    render(<App fixedNow={NOW} initial={() => pinned} />);
    const pill = screen.getByLabelText(/, fijado/);
    fireEvent.click(pill, { clientX: 10, clientY: 10 });
    expect(screen.getByText(/Fijado por vos/)).toBeTruthy();
    fireEvent.click(document.querySelector(".bubble") as HTMLElement);
    fireEvent.click(screen.getByText(/Soltar/));
    expect(screen.queryByLabelText(/, fijado/)).toBeNull();
  });

  it("lets a pinned block go straight from its bubble", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    render(<App fixedNow={NOW} initial={() => pinned} />);
    fireEvent.click(screen.getByLabelText(/, fijado/), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Soltar" }));
    expect(screen.queryByLabelText(/, fijado/)).toBeNull();
    expect(document.querySelector(".bubble")).toBeNull();
    expect(screen.getByText(/Soltado/)).toBeTruthy();
  });
});

describe("plan history", () => {
  it("keeps the undo slot, says what was undone and keeps the keyboard nearby", async () => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
    render(<App fixedNow={NOW} initial={demoData} />);
    const slot = () =>
      document.querySelector(".header .icon-btn.placeholder, .header [aria-label^='Deshacer']");
    expect(slot()?.className).toContain("placeholder");
    fireEvent.click(screen.getByLabelText("Reacomodar semana"));
    const undo = await screen.findByLabelText("Deshacer: reacomodar la semana");
    undo.focus();
    fireEvent.click(undo);
    expect(await screen.findByText("Deshecho: reacomodar la semana")).toBeTruthy();
    expect(slot()?.className).toContain("placeholder");
    await act(() => new Promise((r) => requestAnimationFrame(r)));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reacomodar semana");
    cleanup();
  });

  it("undoes the last reorganization, up to twenty", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, {
      type: "pin",
      blockId: block.id,
      start: block.start + 86_400_000,
      now: NOW,
    });
    expect(pinned.planHistory?.at(-1)?.label).toBe("mover o fijar un bloque");
    const back = reducer(pinned, { type: "undoPlan", now: NOW });
    expect(back.pins).toEqual(d.pins ?? []);
    expect(back.planHistory).toEqual([]);
    let many = d;
    for (let i = 0; i < 25; i++) many = reducer(many, { type: "replanWeek", now: NOW });
    expect(many.planHistory).toHaveLength(20);
  });
});
