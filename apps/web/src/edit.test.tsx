import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { demoData } from "./demo";
import { dropTarget } from "./drag";
import type { AppData } from "./model";
import { isPinned, pinClashes, refreshPlan } from "./planning";
import { reducer } from "./store";

const NOW = Date.UTC(2026, 10, 2, 20);

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

  it("refuses a second pin with the same id", () => {
    const d = start();
    const [a, b] = d.plan.filter(
      (x) => x.start > NOW && x.taskId === d.plan.find((y) => y.start > NOW)?.taskId,
    );
    expect(a && b).toBeTruthy();
    const target = (b?.start ?? 0) + 24 * 3_600_000;
    const once = reducer(d, { type: "pin", blockId: a?.id as string, start: target, now: NOW });
    expect(reducer(once, { type: "pin", blockId: b?.id as string, start: target, now: NOW })).toBe(
      once,
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
    const pill = document.querySelector(".pill.movable") as HTMLElement;
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
    const saved = JSON.parse(localStorage.getItem("critical.demo.v1") ?? "{}") as AppData;
    expect(saved.pins).toHaveLength(1);
    expect(document.querySelector(".pill.pinned")).toBeTruthy();

    // A tap (no movement) in edit mode opens the bubble instead.
    const again = document.querySelector(".pill.movable") as HTMLElement;
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
    const pill = document.querySelector(".pill.movable") as HTMLElement;
    pill.focus();
    fireEvent.keyDown(pill, { key: "ArrowDown" });
    const moved = document.querySelector(".pill.pinned") as HTMLElement;
    expect(moved).toBeTruthy();
    expect(document.activeElement).toBe(moved);
    fireEvent.keyDown(moved, { key: "ArrowRight" });
    fireEvent.keyDown(moved, { key: "a" });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v1") ?? "{}") as AppData;
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
    const pill = document.querySelector(".pill.movable") as HTMLElement;
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
    expect(hot()[0]).toBe("12:30");
    fireEvent.pointerUp(pill, { clientX: 160, clientY: y, pointerId: 3 });
    expect(hot()).toEqual([]);
  });

  it("lets a pinned block go from its sheet", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = d.plan.find((b) => b.start > NOW) as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    render(<App fixedNow={NOW} initial={() => pinned} />);
    const pill = screen.getByLabelText(/, fijado$/);
    fireEvent.click(pill, { clientX: 10, clientY: 10 });
    expect(screen.getByText(/Fijado por vos/)).toBeTruthy();
    fireEvent.click(document.querySelector(".bubble") as HTMLElement);
    fireEvent.click(screen.getByText(/Soltar/));
    expect(screen.queryByLabelText(/, fijado$/)).toBeNull();
  });
});
