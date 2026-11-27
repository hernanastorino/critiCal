// «Repartir tiempo» (SPEC §18 punto 18): the figures of the sheet where a task's total is
// split among its temas. Pure: the sheet only draws and calls these.
import { scheduleAlone, selfShort } from "./engine.js";
import { UNIT_MINUTES_MAX, UNIT_MINUTES_MIN } from "./limits.js";
import { type AppData, type AppTask, newId, type Unit } from "./model.js";
import { shortfall } from "./need.js";
import { refreshPlan } from "./planning.js";

/** Every slider moves in steps of a quarter of an hour. */
export const STEP = 15;
/** A slider reaches a bit past its value, so there is room to raise it. */
export const SCALE = 1.3;
/** A tema that asks for time when there is nothing left to give it: an hour. */
export const NEW_TEMA_SCALE = 60;

export const ceil15 = (m: number): number => Math.ceil(m / STEP) * STEP;

/**
 * Minutes as the sheet opens them: up to 5 over a multiple of 15 goes down, more goes up
 * (50 → 45, 52 → 60). Nothing but 0 rounds to 0: a tema that had minutes keeps 15.
 */
export function roundOpen(minutes: number): number {
  const over = ((minutes % STEP) + STEP) % STEP;
  const r = over <= 5 ? minutes - over : minutes - over + STEP;
  return r <= 0 && minutes > 0 ? STEP : r;
}

/** How far a slider reaches for a value: the value × 1,3, rounded up to 15 (at least one step). */
export const scaleOf = (value: number): number => Math.max(STEP, ceil15(value * SCALE));

export interface Row {
  id: string;
  title: string;
  minutes: number;
  /** How far its slider reaches (kept while it is dragged, recalculated when a value is typed). */
  scale: number;
  /** What was done: it does not go below (the whole tema when it is done). */
  floor: number;
  /** A tema that is done: its slider is blocked. */
  locked: boolean;
  weight?: number;
  /** What it held before it was left out (0 minutes): where it goes back to if raised. */
  was: number;
  /** Typed here, not in the task yet. */
  added?: boolean;
}

export interface Sheet {
  total: number;
  totalScale: number;
  /** The minimum of the whole task. */
  min: number;
  /** What was done of the whole task: the total does not go below. */
  totalFloor: number;
  rows: Row[];
  /** The tema raised last: it is the one that turns red if the sum goes past the total. */
  lastUp?: string;
}

/** What a sheet starts from, when it is not the task as it is (an option's result). */
export interface Prefill {
  estimateMinutes: number;
  minMinutes: number;
  units: Unit[];
}

/** The sheet of a task: its figures as they are, rounded as they open. `done`: minutes logged. */
export function openSheet(task: AppTask | Prefill, done = 0): Sheet {
  const units = task.units;
  const rows: Row[] = units.map((u) => {
    const out = !!u.skipped;
    const minutes = out ? 0 : roundOpen(u.estimateMinutes);
    const locked = !!u.doneAt && !out;
    return {
      id: u.id,
      title: u.title,
      minutes,
      scale: scaleOf(out ? roundOpen(u.estimateMinutes) : minutes),
      floor: locked ? minutes : 0,
      locked,
      ...(u.weight === undefined ? {} : { weight: u.weight }),
      was: roundOpen(u.estimateMinutes),
    };
  });
  const sum = rows.reduce((n, r) => n + r.minutes, 0);
  // What the plan reserves is the lesser of the estimate and the temas (see `progress`): an
  // estimate below them (an option cut it) is the total, and the temas are cut to it.
  const cut = rows.length > 0 && roundOpen(task.estimateMinutes) < sum;
  const total = rows.length > 0 && !cut ? sum : roundOpen(task.estimateMinutes);
  const floor = rows.length > 0 ? sum - rowsFree(rows) : ceil15(done);
  const opened: Sheet = {
    total,
    totalScale: scaleOf(total),
    min: Math.min(roundOpen(task.minMinutes), total),
    totalFloor: Math.min(floor, total),
    rows,
  };
  return cut ? proportional(opened) : opened;
}

/** What the tema that can still move hold: the rest of the total is done (blocked). */
const rowsFree = (rows: Row[]) => rows.reduce((n, r) => n + (r.locked ? 0 : r.minutes), 0);

/** What is assigned to the temas. */
export const assigned = (s: Sheet): number => s.rows.reduce((n, r) => n + r.minutes, 0);

/** What the total has that no tema holds (negative: the temas hold more). 0 without temas. */
export const unassigned = (s: Sheet): number => (s.rows.length > 0 ? s.total - assigned(s) : 0);

/** The sheet can be accepted: everything assigned, and something to do. */
export const canAccept = (s: Sheet): boolean => unassigned(s) === 0 && s.total >= STEP;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The sheet's own limits for a total (the backup has a ceiling for a tema; see limits.ts). */
const TOP = UNIT_MINUTES_MAX;

/** The total dragged: the temas stay as they are; a minimum above it comes down to it. */
export function slideTotal(s: Sheet, value: number): Sheet {
  const total = clamp(value, s.totalFloor, TOP);
  return { ...s, total, min: Math.min(s.min, total) };
}

/** The total typed: it is the new value and its slider reaches from it. */
export function typeTotal(s: Sheet, value: number): Sheet {
  const next = slideTotal(s, value);
  return { ...next, totalScale: scaleOf(next.total) };
}

/** The minimum dragged: steps of 15, never above the total. */
export function slideMin(s: Sheet, value: number): Sheet {
  return { ...s, min: clamp(Math.round(value / STEP) * STEP, 0, s.total) };
}

/**
 * Where the minimum's mark falls on a tema: the minimum's share of the total, on the tema's
 * minutes (4 h of 6 h is 2/3 of every tema). Automatic, never edited.
 */
export function markOf(s: Sheet, row: Row): number {
  return s.total > 0 ? (s.min / s.total) * row.minutes : 0;
}

/** A tema moved. A blocked tema does not move; none goes below what was done. */
export function slideRow(s: Sheet, id: string, value: number, typed = false): Sheet {
  const rows = s.rows.map((r) => {
    if (r.id !== id || r.locked) return r;
    const minutes = clamp(value, r.floor, TOP);
    return { ...r, minutes, ...(typed ? { scale: scaleOf(minutes) } : {}) };
  });
  const before = s.rows.find((r) => r.id === id);
  const after = rows.find((r) => r.id === id);
  const up = !!before && !!after && after.minutes > before.minutes;
  return { ...s, rows, ...(up ? { lastUp: id } : {}) };
}

/** The hour of a tema is red when raising it took the sum past the total. */
export const overRow = (s: Sheet, id: string): boolean => s.lastUp === id && unassigned(s) < 0;

/**
 * «Repartir el resto»: 15 minutes at a time, a tema after another from the top (30 minutes
 * among 3: 15, 15, 0). When the temas hold more, it takes 15 at a time the same way, never
 * below 0 nor below what was done.
 */
export function fillRest(s: Sheet): Sheet {
  let rest = unassigned(s);
  const rows = s.rows.map((r) => ({ ...r }));
  const open = rows.filter((r) => !r.locked);
  while (rest !== 0 && open.length > 0) {
    let moved = false;
    for (const r of open) {
      if (rest === 0) break;
      const step =
        rest > 0
          ? Math.min(STEP, rest, TOP - r.minutes)
          : -Math.min(STEP, -rest, r.minutes - r.floor);
      if (step === 0) continue;
      r.minutes += step;
      rest -= step;
      moved = true;
    }
    if (!moved) break;
  }
  return { ...s, rows };
}

/** A tema added at the end: it reaches as far as what is left, or an hour if nothing is. */
export function addRow(s: Sheet, title: string, id = newId()): Sheet {
  const left = unassigned(s);
  const row: Row = {
    id,
    title,
    minutes: 0,
    scale: left > 0 ? ceil15(left) : NEW_TEMA_SCALE,
    floor: 0,
    locked: false,
    was: 0,
    added: true,
  };
  return { ...s, rows: [...s.rows, row] };
}

/** A tema taken out (one that is done stays: it was worked on). */
export function removeRow(s: Sheet, id: string): Sheet {
  const row = s.rows.find((r) => r.id === id);
  if (!row || row.locked) return s;
  return { ...s, rows: s.rows.filter((r) => r.id !== id) };
}

/**
 * The total split by shares (what the blocked temas hold is theirs): quarters of an hour by
 * the largest remainder, so nothing is left over. Without any share, equal parts.
 */
function split(s: Sheet, share: (r: Row) => number): Sheet {
  const open = s.rows.filter((r) => !r.locked);
  const free = s.total - s.rows.reduce((n, r) => n + (r.locked ? r.minutes : 0), 0);
  if (open.length === 0 || free < 0) return s;
  const raw = open.map((r) => Math.max(0, share(r)));
  const sum = raw.reduce((n, v) => n + v, 0);
  const weights = sum > 0 ? raw : raw.map(() => 1);
  const all = weights.reduce((n, v) => n + v, 0);
  const quarters = Math.floor(free / STEP);
  const exact = weights.map((w) => (w / all) * quarters);
  const given = exact.map(Math.floor);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let left = quarters - given.reduce((n, v) => n + v, 0);
  for (const o of order) {
    if (left <= 0) break;
    given[o.i] = (given[o.i] ?? 0) + 1;
    left -= 1;
  }
  const out = new Map(open.map((r, i) => [r.id, (given[i] ?? 0) * STEP]));
  // What is not a whole quarter (a total that was not one) goes to the first that can take it.
  const extra = free - quarters * STEP;
  const first = open[0];
  if (extra > 0 && first) out.set(first.id, (out.get(first.id) ?? 0) + extra);
  return {
    ...s,
    lastUp: undefined,
    rows: s.rows.map((r) => (r.locked ? r : { ...r, minutes: out.get(r.id) ?? 0 })),
  };
}

/** «Proporcional»: as the temas held when the sheet opened (or as they were typed). */
export const proportional = (s: Sheet): Sheet => split(s, (r) => r.was || r.minutes);

/** «Por peso»: by what each tema weighs in the exam. */
export const byWeight = (s: Sheet): Sheet => split(s, (r) => r.weight ?? 0);

/** «Por peso» needs some tema with a weight. */
export const hasWeights = (s: Sheet): boolean => s.rows.some((r) => (r.weight ?? 0) > 0);

/** The task with what the sheet says: the units keep what the sheet does not touch. */
export function applySheet(task: AppTask, s: Sheet): AppTask {
  const byId = new Map(task.units.map((u) => [u.id, u]));
  const units: Unit[] = s.rows.map((r) => {
    const old = byId.get(r.id);
    const base: Unit = old ?? { id: r.id, title: r.title, estimateMinutes: UNIT_MINUTES_MIN };
    if (r.minutes <= 0) {
      // Left out: not studied, not counted as missing; it keeps its minutes for later.
      const kept = Math.max(UNIT_MINUTES_MIN, old?.estimateMinutes ?? r.was);
      return { ...base, title: r.title, estimateMinutes: kept, skipped: true };
    }
    return { ...base, title: r.title, estimateMinutes: r.minutes, skipped: undefined };
  });
  return { ...task, estimateMinutes: s.total, minMinutes: s.min, units };
}

/** «1 hora 15», «2 horas», «45 minutos»: how a value is spoken. */
export function spoken(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} ${m === 1 ? "minuto" : "minutos"}`;
  const hs = `${h} ${h === 1 ? "hora" : "horas"}`;
  return m === 0 ? hs : `${hs} ${m}`;
}

/** What VoiceOver reads on a tema's slider: «Derivadas, 1 hora 15, mínimo 1 hora». */
export const rowSpoken = (s: Sheet, r: Row): string =>
  `${r.title}, ${spoken(r.minutes)}, mínimo ${spoken(Math.round(markOf(s, r)))}`;

/** The task as the plan would see it with the sheet's figures. */
export const trialOf = (task: AppTask, s: Sheet): AppTask => applySheet(task, s);

export type Fit = "plan" | "deadline" | null;

/**
 * Whether the figures fit: «deadline» when they do not even with the time all to the
 * task (physically impossible until its date), «plan» when they clash with what else the
 * plan holds. The same simulation that forecasts the options of the Bandeja.
 */
export function fitOf(data: AppData, now: number, trial: AppTask): Fit {
  if (trial.kind === "habit" || trial.estimateMinutes <= 0) return null;
  const next: AppData = {
    ...data,
    tasks: data.tasks.some((t) => t.id === trial.id)
      ? data.tasks.map((t) => (t.id === trial.id ? trial : t))
      : [...data.tasks, trial],
  };
  const { input, result } = refreshPlan(next, now);
  if (!shortfall(result).has(trial.id)) return null;
  const alone = scheduleAlone(input, trial.id).status.some(
    (s) => s.taskId === trial.id && s.minDeficit > 0,
  );
  return alone || selfShort(input, result).includes(trial.id) ? "deadline" : "plan";
}
