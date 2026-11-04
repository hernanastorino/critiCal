import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { emptyData, TIMEZONE } from "./demo.js";
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

  it("asks in the inbox and keeps the answer", async () => {
    render(
      <StoreProvider initial={() => data([party])} persist={false} fixedNow={morning}>
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
  });
});
