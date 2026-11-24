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
import { doneMinutes, pendingConfirmations, standingCheckIns } from "./planning.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";

// Wednesday 2026-11-04, 17:50: history behind, and the last blocks not answered yet.
const LATER = zonedInstant(TIMEZONE, "2026-11-04", 17 * 60 + 50);
// Monday 8:00, an ordinary week.
const MON = zonedInstant(TIMEZONE, "2026-11-02", 8 * 60);
const base = (): AppData =>
  seedHistory({ ...demoData(LATER), preferences: { holidaysOff: false } }, LATER);

/** What a test needs to be there: fails with a name instead of casting. */
function need<T>(x: T | null | undefined, what = "something"): T {
  if (x === null || x === undefined) throw new Error(`missing ${what}`);
  return x;
}

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};
const current = () => need(seen.store, "the store");
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  seen.store = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function sheetOf(d: AppData, blockId: string) {
  const b = need(
    d.plan.find((x) => x.id === blockId),
    "block",
  );
  render(
    <StoreProvider initial={() => d} persist={false} fixedNow={LATER}>
      <ToastProvider>
        <Probe />
        <BlockSheet
          item={{ kind: "block", id: b.id, start: b.start, end: b.end, block: b }}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </StoreProvider>,
  );
  return b;
}
const done = (taskId: string) => doneMinutes(current().data, taskId);
const logOf = (blockId: string) => current().data.checkIns.filter((c) => c.blockId === blockId);
const standsOf = (blockId: string) =>
  standingCheckIns(current().data).filter((c) => c.blockId === blockId);
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

/** The pill of a block of `d`, by the label the week gives it. */
const pillOf = (d: AppData, blockId: string) => {
  const b = need(d.plan.find((x) => x.id === blockId));
  const title = d.tasks.find((t) => t.id === b.taskId)?.title;
  const label = `${title}, ${weekdayShort(TIMEZONE, b.start)} ${time(TIMEZONE, b.start)}`;
  return need(
    screen
      .getAllByRole("button")
      .find((p) => (p.getAttribute("aria-label") ?? "").startsWith(label)),
    "pill",
  );
};

describe("14th round: answering a block from its sheet", () => {
  const pendingBlock = () => {
    const d = base();
    const b = need(pendingConfirmations(d, LATER).at(0), "a block to answer");
    return { d, b };
  };

  it("«Hecho» says so and «Deshacer» takes it back", () => {
    const { d, b } = pendingBlock();
    sheetOf(d, b.id);
    press("Hecho");
    expect(screen.getByText("Anotado como hecho.")).toBeTruthy();
    expect(standsOf(b.id)).toHaveLength(1);
    press("Deshacer");
    expect(standsOf(b.id)).toHaveLength(0);
  });

  it("«No» and «Guardar parcial» also say so and undo", () => {
    const { d, b } = pendingBlock();
    sheetOf(d, b.id);
    press("No");
    press("Deshacer");
    expect(standsOf(b.id)).toHaveLength(0);
    press("Parcial");
    press("Guardar parcial");
    expect(screen.getByText("Anotado como parcial.")).toBeTruthy();
    press("Deshacer");
    expect(standsOf(b.id)).toHaveLength(0);
  });

  it("a block already registered can be corrected, adding a new check-in", () => {
    const { d, b } = pendingBlock();
    sheetOf(d, b.id);
    const before = done(b.taskId);
    press("Hecho");
    const afterDone = done(b.taskId);
    expect(afterDone).toBeGreaterThan(before);
    expect(screen.getByText(/Ya registrado/)).toBeTruthy();
    press("Corregir");
    press("No");
    // Nothing is erased: the log has both, and the latest one is what counts.
    expect(logOf(b.id).map((c) => c.status)).toEqual(["done", "missed"]);
    expect(done(b.taskId)).toBe(before);
    expect(screen.getByText(/no lo hice/)).toBeTruthy();
    // «Deshacer» of the correction (the newest notice) brings the first answer back.
    fireEvent.click(need(screen.getAllByRole("button", { name: "Deshacer" }).at(-1), "Deshacer"));
    expect(standsOf(b.id)).toHaveLength(1);
    expect(done(b.taskId)).toBe(afterDone);
    expect(screen.getByText(/hecho ✓/)).toBeTruthy();
  });

  it("the bubble stops asking «Marcar cómo te fue» once the block is registered", () => {
    const d = base();
    const answered = need(d.checkIns.at(0), "a check-in");
    const open = need(pendingConfirmations(d, LATER).at(-1), "a block to answer");
    render(<App fixedNow={LATER} initial={() => d} />);
    fireEvent.click(pillOf(d, open.id));
    expect(screen.getByText("Marcar cómo te fue ›")).toBeTruthy();
    fireEvent.click(need(screen.getAllByLabelText("Cerrar").at(0)));
    fireEvent.click(pillOf(d, answered.blockId));
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
    const first = need(screen.getAllByRole("button", { name: /^Hice una parte:/ }).at(0));
    const label = need(first.getAttribute("aria-label"));
    fireEvent.click(first);
    press("Parcial");
    press("Guardar parcial");
    expect(screen.getByText("Anotado como parcial.")).toBeTruthy();
    const undo = screen.getByRole("button", { name: "Deshacer" });
    undo.focus();
    fireEvent.click(undo);
    await settle();
    expect(screen.getAllByLabelText(label)).toHaveLength(1);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("14th round: dragging says the real reason", () => {
  it("after the deadline, not «no hay un hueco libre»", () => {
    // Day columns 50 px wide and 1000 px tall from x = 0 (Monday the 2nd), as in edit.test.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const date = this.getAttribute("data-date");
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
    const block = need(
      fresh.plan
        .filter(
          (b) => b.start > MON && fresh.activities.find((a) => a.id === b.activityId)?.academic,
        )
        .sort((a, b) => a.start - b.start)
        .at(0),
      "an upcoming study block",
    );
    const d: AppData = {
      ...fresh,
      tasks: fresh.tasks.map((t) =>
        t.id === block.taskId ? { ...t, deadline: block.end + 15 * MINUTE } : t,
      ),
    };
    render(<App fixedNow={MON} initial={() => d} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const pill = pillOf(d, block.id);
    // Thursday's column (x 150–200): long after the deadline.
    fireEvent.pointerDown(pill, { clientX: 10, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 170, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(pill, { clientX: 170, clientY: 500, pointerId: 1 });
    const saved = JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;
    expect(saved.pins ?? []).toHaveLength(0);
    expect(screen.getAllByText(/^Después de la entrega de .+ no$/).length).toBeGreaterThan(0);
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

  it("the screens live in one main landmark, and the tab bar stays outside it", () => {
    render(<App fixedNow={MON} initial={demoData} />);
    const main = need(document.querySelector("main"), "main");
    expect(main.querySelector(".week-wrap")).toBeTruthy();
    expect(main.querySelector("nav.tabs")).toBeNull();
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

describe("14th round: undoing a replan before its tick", () => {
  it("does not take the focus back to the replan button", async () => {
    // Monday 17:00: here replanning does move something, so there is a version to undo.
    const evening = Date.UTC(2026, 10, 2, 20);
    render(<App fixedNow={evening} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Reacomodar semana"));
    const undo = await screen.findByLabelText("Deshacer: reacomodar la semana");
    undo.focus();
    fireEvent.click(undo);
    await act(() => new Promise((r) => setTimeout(r, 700)));
    expect(document.activeElement).not.toBe(screen.getByLabelText("Reacomodar semana"));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("14th round: «Deshacer» of «Hoy no almuerzo»", () => {
  it("puts the focus on the meal that came back", async () => {
    render(<App fixedNow={MON} initial={(now) => ({ ...demoData(now), events: [] })} />);
    const lunch = () => screen.getByRole("button", { name: /^Almuerzo, lun 13:00/ });
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
