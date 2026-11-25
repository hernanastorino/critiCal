import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chunk } from "./data.js";
import { mondayOf, weekNo } from "./loadQueue.js";
import { firstSpan, Progressive, weekSpan, weeksLeft } from "./progressive.js";

const TZ = "America/Montevideo";
// A Wednesday.
const NOW = Date.parse("2026-11-25T15:00:00Z");
const CURRENT = weekNo("2026-11-23");

const chunkOf = (title: string): Chunk => ({
  events: [
    {
      id: `x:${title}`,
      title,
      start: 0,
      end: 1,
      busy: true,
      allDay: false,
      source: "google",
    },
  ],
  overrides: [],
  blocks: [],
});

describe("what the first load brings", () => {
  it("covers the week before and thirteen weeks after the current one", () => {
    const span = firstSpan(TZ, NOW);
    expect(span.fromDate).toBe("2026-11-15");
    expect(span.toDate).toBe("2027-03-02");
    expect(span.from).toBeLessThan(weekSpan(TZ, CURRENT - 1).from);
    expect(span.to).toBeGreaterThan(weekSpan(TZ, CURRENT + 13).to);
  });

  it("leaves for later every week of the data outside that reach", () => {
    const bounds = {
      first: Date.parse("2026-10-14T10:00:00Z"),
      last: Date.parse("2026-12-30T10:00:00Z"),
    };
    const left = weeksLeft(TZ, NOW, bounds).map(mondayOf);
    expect(left).toEqual(["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
  });

  it("has nothing left for an account with data only near today, or with none", () => {
    const near = { first: NOW - 3 * 86_400_000, last: NOW + 20 * 86_400_000 };
    expect(weeksLeft(TZ, NOW, near)).toEqual([]);
    expect(weeksLeft(TZ, NOW, null)).toEqual([]);
  });

  it("reads a week as seven local days", () => {
    const w = weekSpan(TZ, CURRENT);
    expect([w.fromDate, w.toDate]).toEqual(["2026-11-23", "2026-11-30"]);
    expect(w.to - w.from).toBe(7 * 86_400_000);
  });
});

describe("Progressive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const fetched: number[] = [];
    const applied: Chunk[] = [];
    const onChange = vi.fn();
    const p = new Progressive({
      fetchWeek: (w) => {
        fetched.push(w);
        return Promise.resolve(chunkOf(`w${w}`));
      },
      apply: (c) => applied.push(c),
      onChange,
      batchMs: 400,
    });
    return { p, fetched, applied, onChange };
  }

  it("brings the weeks nearest the current one first, and puts them on the screen in batches", async () => {
    const { p, fetched, applied } = make();
    p.start([CURRENT - 4, CURRENT - 2, CURRENT - 3, CURRENT - 20], CURRENT);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched.slice(0, 2)).toEqual([CURRENT - 2, CURRENT - 3]);
    // Nothing on the screen yet: the batch waits for its moment.
    expect(applied).toEqual([]);
    expect(p.ready(CURRENT - 2)).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(applied).toHaveLength(1);
    expect(applied.flatMap((c) => c.events.map((e) => e.title)).slice(0, 2)).toEqual([
      `w${CURRENT - 2}`,
      `w${CURRENT - 3}`,
    ]);
    expect(p.ready(CURRENT - 2)).toBe(true);
    // A week with nothing to load is always ready.
    expect(p.ready(CURRENT + 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetched).toEqual([CURRENT - 2, CURRENT - 3, CURRENT - 4, CURRENT - 20]);
    expect(p.remaining).toBe(0);
  });

  it("shows at once the week looked at that was already fetched", async () => {
    const { p, applied } = make();
    p.start([CURRENT - 2, CURRENT - 3, CURRENT - 40], CURRENT);
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([]);
    p.focus(CURRENT - 3);
    expect(applied).toHaveLength(1);
    expect(p.ready(CURRENT - 3)).toBe(true);
  });

  it("goes first for the week looked at, shows it as soon as it arrives, and goes on from there", async () => {
    const made = make();
    const { p, applied, fetched } = made;
    p.start([CURRENT - 30, CURRENT - 31, CURRENT - 32, CURRENT - 33], CURRENT);
    p.focus(CURRENT - 33);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched.slice(2, 4)).toEqual([CURRENT - 33, CURRENT - 32]);
    expect(applied.flatMap((c) => c.events.map((e) => e.title))).toContain(`w${CURRENT - 33}`);
  });

  it("counts what remains while anything is queued, fetched and waiting, or given up on", async () => {
    const down = vi.fn(() => Promise.reject(new Error("net")));
    const p = new Progressive({
      fetchWeek: down,
      apply: vi.fn(),
      onChange: vi.fn(),
      queue: { attempts: 1, delay: () => 10 },
    });
    p.start([CURRENT - 1], CURRENT);
    await vi.advanceTimersByTimeAsync(0);
    // Given up on: the indicator stays on, and the week is asked for again on request.
    expect(p.remaining).toBe(1);
    expect(p.ready(CURRENT - 1)).toBe(false);
    p.retryFailed();
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("shows nothing and asks for nothing once cancelled", async () => {
    const { p, fetched, applied } = make();
    p.start([CURRENT - 1, CURRENT - 2, CURRENT - 3], CURRENT);
    p.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(applied).toEqual([]);
    expect(fetched).toHaveLength(2);
    expect(p.remaining).toBe(0);
    p.focus(CURRENT - 3);
    p.retryFailed();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetched).toHaveLength(2);
  });
});
