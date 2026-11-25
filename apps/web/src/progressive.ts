import type { Chunk, Span } from "./data.js";
import { addDays, zonedInstant } from "./engine.js";
import { LoadQueue, mondayOf, type QueueOptions, weekNo } from "./loadQueue.js";
import { weekStart } from "./planning.js";

/** Weeks before and after the current one that come with the first load (the planner's reach). */
export const FIRST_WEEKS_BEFORE = 1;
export const FIRST_WEEKS_AFTER = 13;
/** Chunks that arrive within this time of each other reach the screen as one. */
const BATCH_MS = 400;
const DAY_MS = 86_400_000;

const mondayNo = (tz: string, instant: number) => weekNo(weekStart(tz, instant));

/** The stretch of time of week `week`, in the account's time zone. */
export function weekSpan(tz: string, week: number): Span {
  const monday = mondayOf(week);
  const next = addDays(monday, 7);
  return {
    from: zonedInstant(tz, monday, 0),
    to: zonedInstant(tz, next, 0),
    fromDate: monday,
    toDate: next,
  };
}

/** What the first load asks of the growing tables: the planning reach, around `now`. */
export function firstSpan(tz: string, now: number): Span {
  const current = mondayNo(tz, now);
  const from = weekSpan(tz, current - FIRST_WEEKS_BEFORE);
  const to = weekSpan(tz, current + FIRST_WEEKS_AFTER);
  // A day more on each side: the time zone is a guess until the settings are in, and the
  // weeks the queue leaves for later are worked out with the real one.
  return {
    from: from.from - DAY_MS,
    to: to.to + DAY_MS,
    fromDate: addDays(from.fromDate, -1),
    toDate: addDays(to.toDate, 1),
  };
}

/** The weeks the data reaches (`bounds`, instants) that the first load did not bring. */
export function weeksLeft(
  tz: string,
  now: number,
  bounds: { first: number; last: number } | null,
): number[] {
  if (!bounds) return [];
  const current = mondayNo(tz, now);
  const inFirst = (w: number) =>
    w >= current - FIRST_WEEKS_BEFORE && w <= current + FIRST_WEEKS_AFTER;
  const first = mondayNo(tz, bounds.first);
  const last = mondayNo(tz, bounds.last);
  const weeks: number[] = [];
  for (let w = first; w <= last; w++) if (!inFirst(w)) weeks.push(w);
  return weeks;
}

export interface ProgressiveOptions {
  /** Reads one week from the database. */
  fetchWeek(week: number): Promise<Chunk>;
  /** Puts rows on the screen and in the baseline. */
  apply(chunk: Chunk): void;
  /** Told when anything the screen shows about the loading changed. */
  onChange: () => void;
  queue?: Pick<QueueOptions, "concurrency" | "attempts" | "delay">;
  batchMs?: number;
}

/**
 * The rest of an account's history, after the app has opened: the queue asks for weeks
 * nearest the one in view first, and what arrives reaches the screen in batches (each
 * one is a render and a plan, so not one per week).
 */
export class Progressive {
  private readonly queue: LoadQueue;
  private readonly left = new Set<number>();
  private readonly shown = new Set<number>();
  private buffer: { week: number; chunk: Chunk }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private center = 0;
  private stopped = false;
  private started = false;
  private readonly opts: ProgressiveOptions;

  constructor(opts: ProgressiveOptions) {
    this.opts = opts;
    this.queue = new LoadQueue({
      ...opts.queue,
      // Nothing is told before the weeks are in: an empty queue is not a finished one.
      onChange: () => {
        if (this.started) opts.onChange();
      },
      run: async (week) => {
        const chunk = await opts.fetchWeek(week);
        if (this.stopped) return;
        this.buffer.push({ week, chunk });
        if (week === this.center) this.flush();
        else {
          this.timer ??= setTimeout(() => this.flush(), opts.batchMs ?? BATCH_MS);
        }
      },
    });
  }

  /** Weeks still to come (or given up on): the loading indicator is on while this is not 0. */
  get remaining(): number {
    return this.queue.pending + this.queue.failedWeeks.length + this.buffer.length;
  }

  /** Whether the rows of week `week` are on the screen (a week with nothing to load always is). */
  ready(week: number): boolean {
    return !this.left.has(week) || this.shown.has(week);
  }

  start(weeks: number[], center: number): void {
    this.center = center;
    for (const w of weeks) this.left.add(w);
    this.queue.focus(center);
    this.queue.add(weeks);
    this.started = true;
    this.opts.onChange();
  }

  /** The week in view changed: it and its neighbours go first. */
  focus(week: number): void {
    if (this.stopped || week === this.center) return;
    this.center = week;
    this.queue.focus(week);
    // Already fetched and only waiting for its batch: show it now.
    if (this.buffer.some((b) => b.week === week)) this.flush();
  }

  retryFailed(): void {
    if (!this.stopped) this.queue.retryFailed();
  }

  /** The account leaves or a whole copy came in: nothing more is asked or shown. */
  cancel(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.buffer = [];
    this.queue.cancel();
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.buffer;
    this.buffer = [];
    if (this.stopped || !batch.length) return;
    this.opts.apply({
      events: batch.flatMap((b) => b.chunk.events),
      blocks: batch.flatMap((b) => b.chunk.blocks),
      overrides: batch.flatMap((b) => b.chunk.overrides),
    });
    for (const b of batch) this.shown.add(b.week);
    this.opts.onChange();
  }
}
