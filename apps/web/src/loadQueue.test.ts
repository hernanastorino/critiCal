import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoff, LoadQueue, mondayOf, weekNo } from "./loadQueue.js";

/** A queue whose jobs the test finishes by hand. */
function setup(options: { attempts?: number; concurrency?: number } = {}) {
  const started: number[] = [];
  const open = new Map<number, { ok: () => void; fail: () => void }>();
  const onChange = vi.fn();
  const queue = new LoadQueue({
    ...options,
    onChange,
    run: (w) =>
      new Promise<void>((resolve, reject) => {
        started.push(w);
        open.set(w, { ok: resolve, fail: () => reject(new Error("net")) });
      }),
  });
  const finish = async (w: number, how: "ok" | "fail" = "ok") => {
    const job = open.get(w);
    if (!job) throw new Error(`week ${w} is not running`);
    open.delete(w);
    job[how]();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { queue, started, finish, onChange };
}

describe("LoadQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("goes outwards from the week in view, the next week before the previous", () => {
    const { queue, started } = setup({ concurrency: 1 });
    queue.focus(10);
    queue.add([7, 8, 9, 11, 12, 13, 10 + 5]);
    // 10 is not queued: it came with the first load.
    expect(started).toEqual([11]);
    expect(queue.order()).toEqual([9, 12, 8, 13, 7, 15]);
  });

  it("keeps two jobs in flight", async () => {
    const { queue, started, finish } = setup();
    queue.add([1, 2, 3, 4]);
    expect(started).toEqual([1, 2]);
    await finish(1);
    expect(started).toEqual([1, 2, 3]);
  });

  it("never asks for a week twice", async () => {
    const { queue, started, finish } = setup();
    queue.add([1, 2, 3]);
    queue.add([1, 2, 3]);
    await finish(1);
    queue.add([1, 3]);
    await finish(2);
    await finish(3);
    queue.add([1, 2, 3]);
    expect(started).toEqual([1, 2, 3]);
    expect(queue.pending).toBe(0);
    expect(queue.isLoaded(2)).toBe(true);
  });

  it("does not ask again for what came with the first load", () => {
    const { queue, started } = setup();
    queue.markLoaded([5, 6]);
    queue.add([5, 6, 7]);
    expect(started).toEqual([7]);
  });

  it("jumps the week looked at to the front", async () => {
    const { queue, started, finish } = setup({ concurrency: 1 });
    queue.add([1, 2, 3, 50]);
    queue.focus(50);
    await finish(1);
    expect(started).toEqual([1, 50]);
    expect(queue.order()).toEqual([3, 2]);
  });

  it("retries with a growing wait and then goes on", async () => {
    const { queue, started, finish } = setup({ attempts: 4 });
    queue.add([1]);
    await finish(1, "fail");
    expect(queue.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(backoff(1) - 1);
    expect(started).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([1, 1]);
    await finish(1, "fail");
    await vi.advanceTimersByTimeAsync(backoff(2));
    expect(started).toEqual([1, 1, 1]);
    await finish(1);
    expect(queue.isLoaded(1)).toBe(true);
    expect(queue.pending).toBe(0);
  });

  it("waits longer each time, up to 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(backoff)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("gives a week up after its attempts, and tries again on request", async () => {
    const { queue, started, finish } = setup({ attempts: 2, concurrency: 1 });
    queue.add([1, 2]);
    await finish(1, "fail");
    // The failed week rests; the next one does not wait for it.
    expect(started).toEqual([1, 2]);
    await finish(2);
    await vi.advanceTimersByTimeAsync(backoff(1));
    await finish(1, "fail");
    expect(queue.failedWeeks).toEqual([1]);
    expect(queue.pending).toBe(0);
    queue.retryFailed();
    expect(started).toEqual([1, 2, 1, 1]);
    expect(queue.failedWeeks).toEqual([]);
  });

  it("does not make a week wait for its clock when it is the one looked at", async () => {
    const { queue, started, finish } = setup({ concurrency: 1 });
    queue.add([1]);
    await finish(1, "fail");
    queue.focus(1);
    expect(started).toEqual([1, 1]);
  });

  it("stops for good when cancelled: no job starts and a late answer is ignored", async () => {
    const { queue, started, finish, onChange } = setup({ concurrency: 1 });
    queue.add([1, 2, 3]);
    queue.cancel();
    expect(queue.pending).toBe(0);
    await finish(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toEqual([1]);
    expect(queue.isLoaded(1)).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it("cancels the weeks resting before a retry", async () => {
    const { queue, started, finish } = setup({ concurrency: 1 });
    queue.add([1]);
    await finish(1, "fail");
    queue.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toEqual([1]);
  });
});

describe("week numbers", () => {
  it("turn Mondays into consecutive numbers and back", () => {
    expect(weekNo("2026-11-30") - weekNo("2026-11-23")).toBe(1);
    expect(mondayOf(weekNo("2026-11-23"))).toBe("2026-11-23");
    expect(weekNo("2027-03-29") - weekNo("2027-03-22")).toBe(1);
  });
});
