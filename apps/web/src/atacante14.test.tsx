import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { BlockSheet } from "./components/BlockSheet.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import { time, weekdayShort } from "./format.js";
import type { AppData } from "./model.js";
import { doneMinutes, pendingConfirmations } from "./planning.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";

// Wednesday 2026-11-04, 17:50: history behind, and the last blocks not answered yet.
const LATER = zonedInstant(TIMEZONE, "2026-11-04", 17 * 60 + 50);
// Monday 8:00, an ordinary week.
const MON = zonedInstant(TIMEZONE, "2026-11-02", 8 * 60);
const base = (): AppData =>
  seedHistory({ ...demoData(LATER), preferences: { holidaysOff: false } }, LATER);

let store: ReturnType<typeof useStore> | undefined;
const Probe = () => {
  store = useStore();
  return null;
};
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  store = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function sheetOf(d: AppData, blockId: string) {
  const b = d.plan.find((x) => x.id === blockId);
  if (!b) throw new Error("no block");
  render(
    <StoreProvider initial={() => d} persist={false} fixedNow={LATER}>
      <ToastProvider>
        <Probe />
        <BlockSheet
          item={{ kind: "block", id: b.id, start: b.start, end: b.end, block: b }}
          onClose={() => {}}
        />
      </ToastProvider>
    </StoreProvider>,
  );
  return b;
}
const done = (taskId: string) => doneMinutes((store as ReturnType<typeof useStore>).data, taskId);
const logOf = (blockId: string) => store?.data.checkIns.filter((c) => c.blockId === blockId) ?? [];

describe("14th round: answering a block from its sheet", () => {
  const pendingBlock = () => {
    const d = base();
    const b = pendingConfirmations(d, LATER)[0];
    if (!b) throw new Error("the seeded history leaves blocks to answer");
    return { d, b };
  };

  it("«✓ Hecho» says so and «Deshacer» takes it back", () => {
    const { d, b } = pendingBlock();
    sheetOf(d, b.id);
    fireEvent.click(screen.getByRole("button", { name: "✓ Hecho" }));
    expect(screen.getByText("Anotado como hecho.")).toBeTruthy();
    expect(logOf(b.id)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(logOf(b.id)).toHaveLength(0);
  });

  it("«✗ No» and «Guardar parcial» also say so and undo", () => {
    const { d, b } = pendingBlock();
    sheetOf(d, b.id);
    fireEvent.click(screen.getByRole("button", { name: "✗ No" }));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(logOf(b.id)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "◐ Parcial" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar parcial" }));
    expect(screen.getByText("Anotado como parcial.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(logOf(b.id)).toHaveLength(0);
  });

  it("a block already registered can be corrected, adding a new check-in", () => {
    const { d, b } = pendingBlock();
    sheetOf(d, b.id);
    const before = done(b.taskId);
    fireEvent.click(screen.getByRole("button", { name: "✓ Hecho" }));
    const afterDone = done(b.taskId);
    expect(afterDone).toBeGreaterThan(before);
    expect(screen.getByText(/Ya registrado/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Corregir" }));
    fireEvent.click(screen.getByRole("button", { name: "✗ No" }));
    // Nothing is erased: the log has both, and the latest one is what counts.
    expect(logOf(b.id).map((c) => c.status)).toEqual(["done", "missed"]);
    expect(done(b.taskId)).toBe(before);
    expect(screen.getByText(/no lo hice/)).toBeTruthy();
    // «Deshacer» of the correction brings the first answer back.
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(logOf(b.id)).toHaveLength(1);
    expect(done(b.taskId)).toBe(afterDone);
    expect(screen.getByText(/hecho ✓/)).toBeTruthy();
  });

  it("the bubble stops asking «Marcar cómo te fue» once the block is registered", () => {
    const d = base();
    const answered = d.checkIns[0];
    const open = pendingConfirmations(d, LATER).at(-1);
    if (!answered || !open) throw new Error("seed");
    render(<App fixedNow={LATER} initial={() => d} />);
    const pillOf = (blockId: string) => {
      const b = d.plan.find((x) => x.id === blockId);
      const title = d.tasks.find((t) => t.id === b?.taskId)?.title;
      const label = `${title}, ${weekdayShort(TIMEZONE, b?.start as number)} ${time(TIMEZONE, b?.start as number)}`;
      return [...document.querySelectorAll<HTMLElement>(".pill.planned")].find((p) =>
        (p.getAttribute("aria-label") ?? "").startsWith(label),
      ) as HTMLElement;
    };
    fireEvent.click(pillOf(open.id));
    expect(screen.getByText("Marcar cómo te fue ›")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);
    fireEvent.click(pillOf(answered.blockId));
    expect(screen.queryByText("Marcar cómo te fue ›")).toBeNull();
    expect(screen.getByText("Ver detalle ›")).toBeTruthy();
  });

  it("«Hice una parte» in the Bandeja says so, and «Deshacer» brings the card back", async () => {
    const d = base();
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={LATER}>
        <ToastProvider>
          <Probe />
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const first = screen.getAllByRole("button", { name: /^Hice una parte:/ })[0] as HTMLElement;
    const label = first.getAttribute("aria-label");
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "◐ Parcial" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar parcial" }));
    expect(screen.getByText("Anotado como parcial.")).toBeTruthy();
    const undo = screen.getByRole("button", { name: "Deshacer" });
    undo.focus();
    fireEvent.click(undo);
    await settle();
    expect(screen.getAllByRole("button", { name: /^Hice una parte:/ })[0]).toBeTruthy();
    expect(screen.getAllByLabelText(label as string)).toHaveLength(1);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("14th round: dragging says the real reason", () => {
  const pins = () => (JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData).pins;

  it("after the deadline, not «no hay un hueco libre»", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const date = this.dataset?.date;
      const i = date ? Number(date.slice(8)) - 2 : 0;
      return date
        ? ({
            left: i * 50,
            right: i * 50 + 50,
            top: 0,
            bottom: 1000,
            width: 50,
            height: 1000,
          } as DOMRect)
        : ({ left: 0, right: 30, top: 100, bottom: 160, width: 30, height: 60 } as DOMRect);
    });
    const fresh = reducer(demoData(MON), { type: "refresh", now: MON });
    const block = fresh.plan
      .filter((b) => b.start > MON && fresh.activities.find((a) => a.id === b.activityId)?.academic)
      .sort((a, b) => a.start - b.start)[0] as AppData["plan"][number];
    const d: AppData = {
      ...fresh,
      tasks: fresh.tasks.map((t) =>
        t.id === block.taskId ? { ...t, deadline: block.end + 15 * MINUTE } : t,
      ),
    };
    render(<App fixedNow={MON} initial={() => d} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const title = d.tasks.find((t) => t.id === block.taskId)?.title;
    const label = `${title}, ${weekdayShort(TIMEZONE, block.start)} ${time(TIMEZONE, block.start)}`;
    const pill = [...document.querySelectorAll<HTMLElement>(".pill.planned.movable")].find((p) =>
      (p.getAttribute("aria-label") ?? "").startsWith(label),
    ) as HTMLElement;
    // Thursday's column (x 150–200): long after the deadline.
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 170, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(pill, { clientX: 170, clientY: 500, pointerId: 1 });
    expect(pins() ?? []).toHaveLength(0);
    expect(screen.getAllByText("Después de la entrega no").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No hay un hueco libre/)).toBeNull();
  });
});

describe("14th round: skip link and landmark", () => {
  it("«Saltar a las pestañas» comes first, hidden until focused, and goes to the tabs", () => {
    render(<App fixedNow={MON} initial={demoData} />);
    const link = screen.getByRole("link", { name: "Saltar a las pestañas" });
    // First thing in the page for the keyboard.
    expect(document.body.querySelector("a, button, input, select, textarea")).toBe(link);
    expect(link.className).toContain("skip-link");
    fireEvent.click(link);
    expect(document.activeElement?.closest("nav.tabs")).toBeTruthy();
  });

  it("the screens live in a <main>, and the tab bar stays outside it", () => {
    render(<App fixedNow={MON} initial={demoData} />);
    const main = document.querySelector("main");
    expect(main).toBeTruthy();
    expect(main?.querySelector(".week-wrap")).toBeTruthy();
    expect(main?.querySelector("nav.tabs")).toBeNull();
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });
});

describe("14th round: «Reacomodar semana» with nothing to change", () => {
  it("does not add an empty version to the undo history", () => {
    const fresh = reducer(demoData(MON), { type: "refresh", now: MON });
    const once = reducer(fresh, { type: "replanWeek", now: MON });
    const twice = reducer(once, { type: "replanWeek", now: MON });
    expect(twice.planHistory ?? []).toHaveLength(0);
  });

  it("says «Ya estaba acomodada» and the focus comes back to the button", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App fixedNow={MON} initial={demoData} />);
    const replan = screen.getByLabelText("Reacomodar semana");
    replan.focus();
    fireEvent.click(replan);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getAllByText("Ya estaba acomodada").length).toBeGreaterThan(0);
    expect(replan.className).not.toContain("done");
    expect(document.activeElement).toBe(replan);
    expect(screen.queryByRole("button", { name: /^Deshacer: reacomodar/ })).toBeNull();
  });
});

describe("14th round: «Deshacer» of «Hoy no almuerzo»", () => {
  it("puts the focus on the meal that came back", async () => {
    render(<App fixedNow={MON} initial={(now) => ({ ...demoData(now), events: [] })} />);
    const lunch = () =>
      [...document.querySelectorAll<HTMLElement>(".pill.meal")].find((p) =>
        /^Almuerzo, lun 13:00/.test(p.getAttribute("aria-label") ?? ""),
      ) as HTMLElement;
    fireEvent.click(lunch());
    fireEvent.click(screen.getByText("Hoy no almuerzo"));
    const undo = screen.getByRole("button", { name: "Deshacer" });
    undo.focus();
    fireEvent.click(undo);
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(lunch());
  });
});
