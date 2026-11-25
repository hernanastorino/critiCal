import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { Inbox } from "./components/Inbox.js";
import { useModal } from "./components/modal.js";
import { Places } from "./components/Places.js";
import { ActivitySettings } from "./components/Preferences.js";
import { bounds, fit, ROY, type RoyAnim, uniformBox } from "./components/Roy.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, emptyData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, AppliedDecision, Place } from "./model.js";
import { clearLocal } from "./offline.js";
import { missingPairs, tripPairs } from "./places.js";
import { applyOption, DECISIONS_SHOWN_MS, endOfWeek, routinesBack } from "./planning.js";
import { reducer, removedWith, StoreProvider, useStore } from "./store.js";
import { session, stubApi } from "./testing.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tz = "America/Montevideo";
// A Wednesday.
const NOW = zonedInstant(tz, "2026-11-04", 8 * 60);
const DAY = 86_400_000;
const casa: Place = { id: "casa", name: "Casa", aliases: [], isHome: true, lat: -34.8, lon: -56.2 };
const facu: Place = { id: "facu", name: "Facultad", aliases: ["FING"], address: "Herrera 565" };
const gym: Place = { id: "gym", name: "Gym", aliases: [], address: "Rivera 1" };
const nowhere: Place = { id: "abuela", name: "Abuela", aliases: [] };

const event = (id: string, title: string, hour: number, location?: string): AppEvent => ({
  id,
  title,
  start: zonedInstant(tz, "2026-11-04", hour * 60),
  end: zonedInstant(tz, "2026-11-04", hour * 60 + 60),
  busy: true,
  location,
  source: "google",
});

const data = (extra: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  places: [casa, facu, gym, nowhere],
  ...extra,
});

function PlaceNames() {
  const { data: d } = useStore();
  return <output data-testid="names">{d.places?.map((p) => p.name).join(",")}</output>;
}

function ActivityNames() {
  const { data: d } = useStore();
  return <output data-testid="names">{d.activities.map((a) => a.name).join(",")}</output>;
}

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return (
    <div ref={ref} className="sheet" role="dialog" aria-label="Hoja">
      <h2>Hoja</h2>
      <button type="button">Algo</button>
    </div>
  );
}

describe("driving times on demand", () => {
  it("names only the trips the plan makes: home and back, and place to place when close", () => {
    const d = data({
      events: [
        event("a", "Clase", 10, "FING"),
        // An hour after the class ends: straight from the faculty.
        event("b", "Gym", 12),
        // Hours later: from home again.
        event("c", "Cena en lo de la abuela", 20),
        // All day, free or past: no trip.
        { ...event("d", "Feria", 9, "FING"), allDay: true },
        { ...event("e", "Gym", 14), busy: false },
        { ...event("f", "Gym", 5) },
      ],
    });
    expect(tripPairs(d, NOW)).toEqual([
      { from: "casa", to: "facu" },
      { from: "facu", to: "casa" },
      { from: "casa", to: "gym" },
      { from: "gym", to: "casa" },
      { from: "facu", to: "gym" },
      { from: "casa", to: "abuela" },
      { from: "abuela", to: "casa" },
    ]);
    // Never every combination: gym → facu, abuela → gym… are nobody's trip.
    expect(tripPairs(d, NOW)).toHaveLength(7);
    // Without a home there are no trips.
    expect(tripPairs({ ...d, places: [facu, gym] }, NOW)).toEqual([]);
  });

  it("asks only for trips without a time whose places can be found", () => {
    const d = data({
      events: [event("a", "Clase", 10, "FING"), event("c", "Cena en lo de la abuela", 20)],
      travelTimes: [{ from: "casa", to: "facu", minutes: 20, manual: true }],
      // «No hace falta traslado» for the dinner.
      noTravel: [],
    });
    // The grandmother's has no address: nothing to look up. Home → faculty is known.
    expect(missingPairs(d, NOW)).toEqual([{ from: "facu", to: "casa" }]);
    expect(missingPairs({ ...d, noTravel: ["fing"] }, NOW)).toEqual([]);
  });

  it("lists only the trips in use in Lugares, folded, with a way to type another", () => {
    render(
      <StoreProvider
        initial={() =>
          data({
            events: [event("a", "Clase", 10, "FING")],
            travelTimes: [{ from: "casa", to: "facu", minutes: 25, manual: false }],
            spots: [{ key: "anglo", text: "Instituto Anglo", minutes: 12 }],
          })
        }
        persist={false}
        fixedNow={NOW}
      >
        <ToastProvider>
          <Places />
        </ToastProvider>
      </StoreProvider>,
    );
    const folds = [...document.querySelectorAll("details")];
    expect(folds).toHaveLength(2);
    // Closed until asked for.
    expect(folds.every((f) => !f.open)).toBe(true);
    expect(folds[0]?.querySelector("summary")?.textContent).toContain("Direcciones de eventos");
    expect(folds[1]?.querySelector("summary")?.textContent).toBe("Minutos en auto 2");
    expect(screen.getByLabelText("Minutos de Casa a Facultad")).toBeTruthy();
    expect(screen.getByLabelText("Minutos de Facultad a Casa")).toBeTruthy();
    expect(screen.queryByLabelText("Minutos de Casa a Gym")).toBeNull();
    expect(screen.queryByLabelText("Minutos de Gym a Abuela")).toBeNull();
    // «Hasta» never offers the place chosen in «Desde».
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "gym" } });
    const to = screen.getByLabelText("Hasta") as HTMLSelectElement;
    expect([...to.options].map((o) => o.value)).toEqual(["", "casa", "facu", "abuela"]);
  });

  it("opens the form of a place where the place is, and deletes from there", () => {
    render(
      <StoreProvider initial={() => data()} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Places />
          <PlaceNames />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText("Editar Facultad"));
    const rows = [...document.querySelectorAll(".place-row, .card:not(.prefs)")];
    // Casa, the form (in the faculty's spot), Gym, Abuela.
    expect(rows.map((r) => r.className)).toEqual([
      "check place-row",
      "card",
      "check place-row",
      "check place-row",
    ]);
    fireEvent.click(screen.getByText("Borrar lugar"));
    expect(screen.getByTestId("names").textContent).toBe("Casa,Gym,Abuela");
    // Deleted at once, with a way back.
    fireEvent.click(screen.getByText("Deshacer"));
    expect(screen.getByTestId("names").textContent).toBe("Casa,Facultad,Gym,Abuela");
  });
});

describe("driving times in the background", () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearLocal();
  });

  it("asks the server for the missing trips once, and for nothing else", async () => {
    const soon = Date.now() + 2 * 3_600_000;
    const rows: Record<string, unknown[]> = {
      places: [
        { id: "casa", name: "Casa", aliases: [], is_home: true, lat: -34.8, lon: -56.2 },
        { id: "facu", name: "Facultad", aliases: [], lat: -34.9, lon: -56.1 },
        { id: "gym", name: "Gym", aliases: [], lat: -34.7, lon: -56.0 },
      ],
      calendar_events: [
        {
          source: "icloud",
          external_id: "e1",
          title: "Clase",
          start_at: new Date(soon).toISOString(),
          end_at: new Date(soon + 3_600_000).toISOString(),
          location: "Facultad",
          busy: true,
          all_day: false,
        },
      ],
    };
    const from = (table: string) => {
      const ok = Promise.resolve({ data: rows[table] ?? [], error: null });
      return {
        select: () =>
          Object.assign(ok, {
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            order() {
              return this;
            },
          }),
        upsert: () => Promise.resolve({ error: null }),
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({ in: () => Promise.resolve({ error: null }) }),
      };
    };
    const asked: unknown[] = [];
    stubApi(async (name, { body }) => {
      if (name === "travel") {
        asked.push(body.pairs);
        return { data: { ok: true, pairs: 0 }, error: null };
      }
      return { data: { connected: true }, error: null };
    });
    render(
      <Connected client={{ from, auth: session } as never} session={{} as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    await waitFor(() =>
      expect(asked).toEqual([
        [
          { from: "casa", to: "facu" },
          { from: "facu", to: "casa" },
        ],
      ]),
    );
    // No answer for them: not asked again on the next render.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(asked).toHaveLength(1);
  });
});

describe("a routine decided on is out for that week only", () => {
  const start = () => demoData(NOW);
  const gymTask = (d: AppData) => d.tasks.find((t) => t.id === "gym");
  const drop = (d: AppData) =>
    applyOption(
      d,
      { tasks: [{ id: "gym", remainingMinutes: 270, minRemainingMinutes: 180 }] } as never,
      {
        id: "drop:gym",
        kind: "drop",
        taskId: "gym",
        label: "No hacer Gym",
        input: { tasks: [] },
      } as never,
      NOW,
    );

  it("skips the routine until the week ends instead of dropping it for good", () => {
    const next = drop(start());
    expect(gymTask(next)?.status).toBe("active");
    expect(gymTask(next)?.skipUntil).toBe(endOfWeek(tz, NOW));
    // A deliverable is still dropped.
    const other = applyOption(
      start(),
      { tasks: [{ id: "tp-prog", remainingMinutes: 60, minRemainingMinutes: 60 }] } as never,
      {
        id: "drop:tp",
        kind: "drop",
        taskId: "tp-prog",
        label: "No hacer",
        input: { tasks: [] },
      } as never,
      NOW,
    );
    expect(other.tasks.find((t) => t.id === "tp-prog")?.status).toBe("dropped");
  });

  const decided = (at: number): AppData => {
    const d = start();
    const before = d.tasks.filter((t) => t.id === "gym");
    const record: AppliedDecision = {
      id: `drop:gym@${at}`,
      label: "No hacer Gym",
      at,
      before,
      dropped: ["gym"],
      after: { gym: "dropped" },
    };
    return {
      ...d,
      tasks: d.tasks.map((t) => (t.id === "gym" ? { ...t, status: "dropped" as const } : t)),
      applied: [record],
    };
  };

  it("brings back a routine an earlier decision had dropped for good", () => {
    // Decided this week: off until the week ends.
    const thisWeek = routinesBack(decided(NOW - 3_600_000), NOW);
    expect(gymTask(thisWeek)?.status).toBe("active");
    expect(gymTask(thisWeek)?.skipUntil).toBe(endOfWeek(tz, NOW));
    expect(thisWeek.applied?.[0]).toMatchObject({
      after: { gym: "active" },
      skipUntil: { gym: endOfWeek(tz, NOW) },
    });
    expect(thisWeek.applied?.[0]?.dropped).toBeUndefined();
    // Decided an earlier week: it is simply back on the plan.
    const lastWeek = routinesBack(decided(NOW - 8 * DAY), NOW);
    expect(gymTask(lastWeek)?.status).toBe("active");
    expect(gymTask(lastWeek)?.skipUntil).toBeUndefined();
    // Any change runs it, and nothing changes when there is nothing to bring back.
    const viaReducer = reducer(decided(NOW - 8 * DAY), {
      type: "travelTime",
      from: "a",
      to: "b",
      minutes: 1,
      now: NOW,
    });
    expect(gymTask(viaReducer)?.status).toBe("active");
    const clean = start();
    expect(routinesBack(clean, NOW)).toBe(clean);
    // One the user ended themself stays ended.
    const ended = decided(NOW - 8 * DAY);
    const kept = routinesBack(
      { ...ended, tasks: ended.tasks.map((t) => (t.id === "gym" ? { ...t, endedAt: NOW } : t)) },
      NOW,
    );
    expect(gymTask(kept)?.status).toBe("dropped");
  });

  it("undoing the decision this week puts the routine back at once", () => {
    const skipped = routinesBack(decided(NOW - 3_600_000), NOW);
    const id = skipped.applied?.[0]?.id as string;
    const undone = reducer(skipped, { type: "undoDecision", id, now: NOW });
    expect(gymTask(undone)?.skipUntil).toBeUndefined();
    expect(undone.applied).toEqual([]);
  });

  it("archives decisions after a week and routine ones when their week ends", () => {
    const show = (d: AppData, now: number) => {
      cleanup();
      render(
        <StoreProvider initial={() => d} persist={false} fixedNow={now}>
          <ToastProvider>
            <Inbox />
          </ToastProvider>
        </StoreProvider>,
      );
      return screen.queryByText("Decisiones que tomaste");
    };
    const free = (at: number): AppData => ({
      ...start(),
      applied: [{ id: `free@${at}`, label: "Usar tiempo libre", at, before: [] }],
    });
    expect(show(free(NOW - DAY), NOW)).toBeTruthy();
    expect(show(free(NOW - DECISIONS_SHOWN_MS - 1), NOW)).toBeNull();
    // A routine's: listed while its week lasts, gone when it ends.
    const routine = routinesBack(decided(NOW - 3_600_000), NOW);
    expect(show(routine, NOW)).toBeTruthy();
    expect(show(routine, endOfWeek(tz, NOW) + 1)).toBeNull();
  });
});

describe("deleting a materia", () => {
  it("takes its silos, check-ins and blocks with it, and undo brings them back", () => {
    const d = {
      ...demoData(NOW),
      checkIns: [
        {
          id: "c1",
          blockId: "b1",
          taskId: "parcial-calc",
          status: "done",
          minutesDone: 30,
          unitIds: [],
          createdAt: NOW,
        },
      ],
    } satisfies AppData;
    const activityId = d.tasks.find((t) => t.id === "parcial-calc")?.activityId as string;
    const removed = removedWith(d, activityId);
    expect(removed?.tasks.map((t) => t.id)).toContain("parcial-calc");
    const gone = reducer(d, { type: "deleteActivity", activityId, now: NOW });
    expect(gone.activities.some((a) => a.id === activityId)).toBe(false);
    expect(gone.tasks.some((t) => t.activityId === activityId)).toBe(false);
    expect(gone.checkIns).toEqual([]);
    expect(gone.plan.some((b) => b.activityId === activityId)).toBe(false);
    // Unknown: nothing happens.
    expect(reducer(gone, { type: "deleteActivity", activityId, now: NOW })).toBe(gone);
    expect(removedWith(gone, activityId)).toBeUndefined();
    const back = reducer(gone, {
      type: "restoreActivity",
      removed: removed as NonNullable<typeof removed>,
      now: NOW,
    });
    expect(back.activities.some((a) => a.id === activityId)).toBe(true);
    expect(back.tasks.filter((t) => t.activityId === activityId).map((t) => t.id)).toEqual(
      removed?.tasks.map((t) => t.id),
    );
    expect(back.checkIns).toHaveLength(1);
    // Twice is once.
    expect(
      reducer(back, {
        type: "restoreActivity",
        removed: removed as NonNullable<typeof removed>,
        now: NOW,
      }),
    ).toBe(back);
  });

  it("has a button in Materias, with Deshacer", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <ActivitySettings />
          <ActivityNames />
        </ToastProvider>
      </StoreProvider>,
    );
    const all = screen.getByTestId("names").textContent as string;
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    expect(screen.getByTestId("names").textContent).not.toContain("Física I");
    expect(screen.getByText(/Física I eliminada/)).toBeTruthy();
    fireEvent.click(screen.getByText("Deshacer"));
    // Back where it was in the list.
    expect(screen.getByTestId("names").textContent).toBe(all);
  });

  it("several deleted in a row come back with one Deshacer, and none left says so", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <ActivitySettings />
          <ActivityNames />
        </ToastProvider>
      </StoreProvider>,
    );
    const all = screen.getByTestId("names").textContent as string;
    for (const name of all.split(",")) {
      // The first row left is always this one.
      fireEvent.click(document.querySelector(".activity-head") as HTMLElement);
      fireEvent.click(screen.getByText(`Eliminar ${name}`));
    }
    expect(screen.getByTestId("names").textContent).toBe("");
    expect(screen.getByText(/No tenés materias ni rutinas/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${all.split(",").length} eliminadas:`))).toBeTruthy();
    fireEvent.click(screen.getByText("Deshacer"));
    expect(screen.getByTestId("names").textContent).toBe(all);
  });

  it("a notice goes away when tapped, in case it sits over a button", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    fireEvent.click(screen.getByText(/Física I eliminada/));
    expect(screen.queryByText(/Física I eliminada/)).toBeNull();
  });
});

describe("Roy fills his box", () => {
  it("scales each shape to its own proportions, not the tall ladder's", () => {
    const bridge = [ROY.puente.still, ...(ROY.puente.seq ?? []).map((s) => s[0])];
    const b = bounds(bridge);
    expect(b.w).toBeGreaterThan(b.h);
    const wide = fit(bridge, 84, 112);
    // As wide as allowed, and several times what a 420 px ladder's scale gave (0.095).
    expect(wide.width).toBe(112);
    expect(wide.scale).toBeGreaterThan(0.3);
    expect(wide.height).toBeLessThanOrEqual(84);
    const ladder = fit([ROY.cascada.still], 168, 240);
    expect(ladder.height).toBe(168);
    expect(ladder.width).toBeLessThan(ladder.height / 4);
  });
});

describe("the grabber of a sheet", () => {
  const drag = (el: Element, from: number, to: number, target: Element = el) => {
    fireEvent.pointerDown(target, { clientY: from, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: to, pointerId: 1 });
  };

  it("closes the sheet when dragged down far enough, and springs back when not", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const sheet = screen.getByRole("dialog");
    drag(sheet, 10, 40);
    expect(sheet.style.transform).toBe("translateY(30px)");
    expect(sheet.classList.contains("pulling")).toBe(true);
    // A touch that started on the grabber does not scroll the page.
    const touch = new Event("touchmove", { cancelable: true });
    sheet.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(true);
    fireEvent.pointerUp(sheet, { clientY: 40, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
    expect(sheet.classList.contains("settling")).toBe(true);
    // Upwards it does not move.
    drag(sheet, 10, 0);
    expect(sheet.style.transform).toBe("translateY(0px)");
    fireEvent.pointerUp(sheet, { clientY: 0, pointerId: 1 });
    drag(sheet, 10, 120);
    fireEvent.pointerUp(sheet, { clientY: 120, pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("only from the grabber: not from the content, nor lower down", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    const sheet = screen.getByRole("dialog");
    drag(sheet, 10, 200, screen.getByText("Algo"));
    fireEvent.pointerUp(sheet, { clientY: 200, pointerId: 1 });
    drag(sheet, 300, 500);
    fireEvent.pointerUp(sheet, { clientY: 500, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
    // Without a drag going on, a touch scrolls as usual.
    const touch = new Event("touchmove", { cancelable: true });
    sheet.dispatchEvent(touch);
    expect(touch.defaultPrevented).toBe(false);
  });
});

describe("Roy has one size in the «Elegí» cards", () => {
  it("draws every shape at the same scale, in a slot of the same size", () => {
    const box = uniformBox(56, 112);
    for (const anim of Object.keys(ROY) as RoyAnim[]) {
      const poses = [ROY[anim].still, ...(ROY[anim].seq ?? []).map((s) => s[0])];
      const own = fit(poses, 56, 112, box.scale);
      expect(own.scale).toBe(box.scale);
      expect(own.width).toBeLessThanOrEqual(box.width);
      expect(own.height).toBeLessThanOrEqual(box.height);
    }
  });
});
