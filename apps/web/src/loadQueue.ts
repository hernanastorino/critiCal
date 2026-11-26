// The queue that brings the rest of an account's history in after the app has opened
// (SPEC §«Carga progresiva»): one job per week, nearest to the week on screen first,
// two at a time, each retried with a growing wait, none asked for twice.

const DAY = 86_400_000;
const WEEK_MS = 7 * DAY;
/** The first Monday after 1970-01-01 (a Thursday): week 0 starts there. */
const FIRST_MONDAY = 4 * DAY;

/** A number for each week (Monday), so distances between weeks are plain differences. */
export const weekNo = (monday: string): number =>
  Math.round((Date.parse(`${monday}T00:00:00Z`) - FIRST_MONDAY) / WEEK_MS);

/** The Monday (`YYYY-MM-DD`) of week number `n`. */
export const mondayOf = (n: number): string =>
  new Date(n * WEEK_MS + FIRST_MONDAY).toISOString().slice(0, 10);

export interface QueueOptions {
  /** Brings in one week; a rejection is retried. */
  // eslint-disable-next-line no-unused-vars -- a parameter name in a function type
  run: (week: number) => Promise<void>;
  /** Jobs in flight at once. */
  concurrency?: number;
  /** Attempts before a week is given up (until `retryFailed`). */
  attempts?: number;
  /** Wait before attempt number `attempt` (1 = after the first failure). */
  // eslint-disable-next-line no-unused-vars -- a parameter name in a function type
  delay?: (attempt: number) => number;
  /** Told after every change: something started, finished, failed. */
  onChange?: () => void;
}

/** 1 s, 2 s, 4 s … up to 30 s. */
export const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** (attempt - 1));

export class LoadQueue {
  private readonly waiting = new Set<number>();
  private readonly running = new Set<number>();
  private readonly done = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly tries = new Map<number, number>();
  private readonly paused = new Map<number, ReturnType<typeof setTimeout>>();
  private center = 0;
  private generation = 0;
  private readonly run: QueueOptions["run"];
  private readonly concurrency: number;
  private readonly attempts: number;
  private readonly delay: NonNullable<QueueOptions["delay"]>;
  private readonly onChange: () => void;

  constructor(options: QueueOptions) {
    this.run = options.run;
    this.concurrency = options.concurrency ?? 2;
    this.attempts = options.attempts ?? 5;
    this.delay = options.delay ?? backoff;
    this.onChange = options.onChange ?? (() => undefined);
  }

  /** Weeks not loaded yet: waiting, in flight or in a pause before the next try. */
  get pending(): number {
    return this.waiting.size + this.running.size + this.paused.size;
  }

  /** Weeks given up on after every attempt. */
  get failedWeeks(): number[] {
    return [...this.failed];
  }

  /** Whether the week's rows are in. */
  isLoaded(week: number): boolean {
    return this.done.has(week);
  }

  /** The order the waiting weeks go in: nearest to the focus, the next week before the previous. */
  order(): number[] {
    return [...this.waiting].sort(
      (a, b) =>
        Math.abs(a - this.center) - Math.abs(b - this.center) ||
        Number(a < this.center) - Number(b < this.center) ||
        a - b,
    );
  }

  /** Queues weeks; one already queued, in flight, paused or loaded is not queued again. */
  add(weeks: Iterable<number>): void {
    for (const w of weeks) {
      if (
        this.done.has(w) ||
        this.running.has(w) ||
        this.waiting.has(w) ||
        this.paused.has(w) ||
        this.failed.has(w)
      )
        continue;
      this.waiting.add(w);
    }
    this.pump();
  }

  /** Marks weeks as already in (they came with the first load). */
  markLoaded(weeks: Iterable<number>): void {
    for (const w of weeks) {
      this.done.add(w);
      this.waiting.delete(w);
    }
  }

  /** The person looks at week `week`: it, and then its neighbours, go first. */
  focus(week: number): void {
    this.center = week;
    // A week resting before its next try does not wait for the clock when it is the one looked at.
    const rest = this.paused.get(week);
    if (rest !== undefined) {
      clearTimeout(rest);
      this.paused.delete(week);
      this.waiting.add(week);
    }
    // A week given up on is worth another go when someone looks at it.
    if (this.failed.delete(week)) {
      this.tries.delete(week);
      this.waiting.add(week);
    }
    this.pump();
  }

  /** Gives the weeks that ran out of attempts a fresh start (back online, next sync). */
  retryFailed(): void {
    for (const w of this.failed) {
      this.tries.delete(w);
      this.waiting.add(w);
    }
    this.failed.clear();
    this.pump();
  }

  /** Stops everything for good: no job starts, a late answer is ignored. */
  cancel(): void {
    this.generation++;
    for (const t of this.paused.values()) clearTimeout(t);
    this.paused.clear();
    this.waiting.clear();
    this.running.clear();
    this.failed.clear();
    this.onChange();
  }

  private pump(): void {
    while (this.running.size < this.concurrency) {
      const next = this.order().at(0);
      if (next === undefined) break;
      this.waiting.delete(next);
      this.start(next);
    }
    this.onChange();
  }

  private start(week: number): void {
    const generation = this.generation;
    this.running.add(week);
    this.run(week).then(
      () => {
        if (generation !== this.generation) return;
        this.running.delete(week);
        this.done.add(week);
        this.pump();
      },
      () => {
        if (generation !== this.generation) return;
        this.running.delete(week);
        this.retryLater(week);
      },
    );
  }

  private retryLater(week: number): void {
    const attempt = (this.tries.get(week) ?? 0) + 1;
    this.tries.set(week, attempt);
    if (attempt >= this.attempts) {
      this.failed.add(week);
      this.pump();
      return;
    }
    const timer = setTimeout(() => {
      this.paused.delete(week);
      this.waiting.add(week);
      this.pump();
    }, this.delay(attempt));
    this.paused.set(week, timer);
    this.pump();
  }
}
