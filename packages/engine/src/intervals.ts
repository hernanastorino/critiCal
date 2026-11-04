import { type Interval, MINUTE } from "./types.js";

/** Sorted, non-overlapping union. */
export function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** `base` minus every interval in `cut`. */
export function subtract(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  const holes = merge(cut);
  const out: Interval[] = [];
  for (const b of merge(base)) {
    let start = b.start;
    for (const h of holes) {
      if (h.end <= start || h.start >= b.end) continue;
      if (h.start > start) out.push({ start, end: h.start });
      start = Math.max(start, h.end);
      if (start >= b.end) break;
    }
    if (start < b.end) out.push({ start, end: b.end });
  }
  return out;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function minutes(i: Interval): number {
  return (i.end - i.start) / MINUTE;
}
