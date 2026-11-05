import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { emptyData, TIMEZONE } from "./demo.js";
import type { PlanBlock } from "./engine.js";
import { zonedInstant } from "./engine.js";
import { lateNight, withLateNight } from "./lateNight.js";
import type { AppData, AppEvent } from "./model.js";
import { StoreProvider } from "./store.js";

afterEach(cleanup);

const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedInstant(TIMEZONE, day, (h as number) * 60 + (m as number));
};
const ev = (title: string, from: number, to: number): AppEvent => ({
  id: title,
  title,
  start: from,
  end: to,
  busy: true,
  source: "google",
});

/** Bed at 23:00 and up at 07:00 every day: eight hours of sleep. */
function data(events: AppEvent[], extra: Partial<AppData> = {}): AppData {
  const d = emptyData();
  return {
    ...d,
    settings: { ...d.settings, week: d.settings.week.map((w) => ({ ...w, wake: 420, bed: 1380 })) },
    events,
    ...extra,
  };
}

describe("late nights", () => {
  const morning = at("2026-11-04", "07:30");
  const party = ev("Cumple de Sofi", at("2026-11-03", "21:00"), at("2026-11-04", "01:30"));

  it("assume the usual sleep from when the event ended", () => {
    expect(lateNight(data([party]), morning)).toMatchObject({
      date: "2026-11-04",
      assumedWake: 9 * 60 + 30,
    });
    const [o] = withLateNight(data([party]), morning);
    expect(o).toEqual({ date: "2026-11-04", wake: 570 });
  });

  it("only after an event that went past bedtime, until answered", () => {
    expect(
      lateNight(data([ev("Cena", at("2026-11-03", "20:00"), at("2026-11-03", "22:30"))]), morning),
    ).toBeNull();
    // An early start is not a late night.
    expect(
      lateNight(data([ev("Vuelo", at("2026-11-04", "05:00"), at("2026-11-04", "06:00"))]), morning),
    ).toBeNull();
    const answered = data([party], { overrides: [{ date: "2026-11-04", wake: 500 }] });
    expect(lateNight(answered, morning)).toBeNull();
    expect(withLateNight(answered, morning)).toEqual(answered.overrides);
  });

  it("suggests the clock time across a daylight-saving change", () => {
    const ny = "America/New_York";
    const d = data([
      ev("Fiesta", zonedInstant(ny, "2027-03-13", 21 * 60), zonedInstant(ny, "2027-03-14", 90)),
    ]);
    const shifted = { ...d, settings: { ...d.settings, timezone: ny } };
    // Seven real hours of sleep (the clock jumped an hour) after 01:30: 09:30.
    expect(lateNight(shifted, zonedInstant(ny, "2027-03-14", 10 * 60))?.assumedWake).toBe(570);
  });

  it("skips free events and waits until the event is over", () => {
    expect(lateNight(data([{ ...party, busy: false }]), morning)).toBeNull();
    expect(lateNight(data([party]), at("2026-11-04", "00:15"))).toBeNull();
  });

  it("uses the evening's bedtime override and today's holiday routine", () => {
    // Bed moved to 02:00 last night: the party ended before it.
    const lateBed = data([party], { overrides: [{ date: "2026-11-03", bed: 120 }] });
    expect(lateNight(lateBed, morning)).toBeNull();
    // Today planned as a Sunday that starts at 10:00: the assumed wake is not earlier.
    const d = data([party], { overrides: [{ date: "2026-11-04", asWeekday: 0 }] });
    const sunday = {
      ...d,
      settings: {
        ...d.settings,
        week: d.settings.week.map((w, i) => (i === 0 ? { ...w, wake: 600 } : w)),
      },
    };
    expect(lateNight(sunday, morning)?.assumedWake).toBe(600 + 150);
  });

  it("frees today's blocks that now fall before the wake-up", async () => {
    const { refreshPlan } = await import("./planning.js");
    const d = data([party], {
      activities: [
        {
          id: "a",
          name: "Física",
          color: "#000",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      tasks: [
        {
          id: "t",
          activityId: "a",
          title: "Parcial",
          kind: "deliverable",
          deadline: at("2026-11-10", "09:00"),
          estimateMinutes: 120,
          minMinutes: 60,
          priority: 2,
          status: "active",
          units: [],
        },
      ],
      plan: [
        {
          id: "early",
          taskId: "t",
          activityId: "a",
          start: at("2026-11-04", "08:00"),
          end: at("2026-11-04", "09:00"),
        },
      ],
    });
    const r = refreshPlan(d, morning);
    expect(r.plan.some((b) => b.id === "early")).toBe(false);
    // With a morning routine, a block in it is freed too (planned work starts after).
    const slow = {
      ...d,
      settings: { ...d.settings, week: d.settings.week.map((w) => ({ ...w, morningMinutes: 30 })) },
      plan: [
        {
          ...(d.plan[0] as PlanBlock),
          id: "mid",
          start: at("2026-11-04", "09:30"),
          end: at("2026-11-04", "10:30"),
        },
      ],
    };
    expect(refreshPlan(slow, morning).plan.some((b) => b.id === "mid")).toBe(false);
    expect(r.plan.every((b) => b.start >= at("2026-11-04", "09:30"))).toBe(true);
  });

  it("asks in the inbox and keeps the answer", async () => {
    let saved: AppData | undefined;
    render(
      <StoreProvider
        initial={() => data([party])}
        persist={false}
        fixedNow={morning}
        onChange={(_, next) => {
          saved = next;
        }}
      >
        <Inbox />
      </StoreProvider>,
    );
    expect(screen.getByText("¿A qué hora te levantaste?")).toBeTruthy();
    const field = screen.getByLabelText("Me levanté a las") as HTMLInputElement;
    expect(field.value).toBe("09:30");
    fireEvent.change(field, { target: { value: "10:15" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    });
    expect(screen.queryByText("¿A qué hora te levantaste?")).toBeNull();
    // The answer typed is the one saved, not the assumed 09:30.
    expect(saved?.overrides.find((o) => o.date === "2026-11-04")?.wake).toBe(10 * 60 + 15);
  });
});
