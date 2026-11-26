import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { clearLocal, readLocal } from "./offline.js";
import { rowsClient } from "./testingRows.js";

const DAY = 86_400_000;

afterEach(cleanup);
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

/** An account with more than 1000 events, from a year ago to a few months ahead (one every 9 hours). */
function bigAccount() {
  const from = Date.now() - 400 * DAY;
  return Array.from({ length: 1300 }, (_, i) => {
    const start = from + i * 9 * 3_600_000;
    return {
      source: "google",
      external_id: `e${i}`,
      calendar_id: "c",
      title: `Evento ${i}`,
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 3_600_000).toISOString(),
      busy: true,
      all_day: false,
    };
  });
}

/** Holds back every request for a single week until `release` is called. */
function gatedWeeks() {
  let release: () => void = vi.fn();
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const weeks = new Set<string>();
  let open = false;
  return {
    gate: (r: { filters: Record<string, string> }) => {
      const [to, since] = [r.filters["lt:start_at"], r.filters["gt:end_at"]];
      if (!to || !since || Date.parse(to) - Date.parse(since) > 10 * DAY || open) return undefined;
      weeks.add(since);
      return held;
    },
    weeks,
    release: () => {
      open = true;
      release();
    },
  };
}

describe("a big account", () => {
  it("opens on the first weeks, loads the rest in the background without writing it back, and ends complete", async () => {
    const hold = gatedWeeks();
    const { client, requests, writes } = rowsClient(
      { calendar_events: bigAccount() },
      { gate: hold.gate },
    );
    render(
      <Connected client={client} session={{ user: { id: "u1" } } as never}>
        <Shell />
      </Connected>,
    );
    // The week is on screen while the rest of the history is still held back.
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText("Cargando el historial")).toBeTruthy());
    expect(hold.weeks.size).toBeGreaterThan(0);
    expect(hold.weeks.size).toBeLessThanOrEqual(2);
    // The device's copy waits for the whole history: a half copy is not worth keeping.
    expect((await readLocal("u1"))?.data.events ?? []).toEqual([]);

    hold.release();
    await waitFor(() => expect(screen.queryByLabelText("Cargando el historial")).toBeNull(), {
      timeout: 45_000,
    });

    // Every week was asked for once; none past the first page; nothing of it written back.
    const weekly = requests.filter(
      (r) =>
        r.table === "calendar_events" &&
        Date.parse(r.filters["lt:start_at"] ?? "") - Date.parse(r.filters["gt:end_at"] ?? "") <
          10 * DAY,
    );
    const asked = weekly.map((r) => r.filters["gt:end_at"]);
    expect(asked.length).toBeGreaterThan(40);
    expect(new Set(asked).size).toBe(asked.length);
    expect(
      writes.filter((w) => w.table === "calendar_events" || w.table === "plan_blocks"),
    ).toEqual([]);
    expect(writes.filter((w) => w.op === "delete")).toEqual([]);
    // Now it is a whole copy and is kept.
    await waitFor(async () => expect((await readLocal("u1"))?.data.events.length).toBe(1300));
  }, 60_000);
});
