export interface Column {
  date: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where a dragged block lands: the day column under `x` (or the nearest one) and
 * the minute of day its top edge `y` points at, snapped to `slot` minutes and kept
 * inside the visible span.
 */
export function dropTarget(
  columns: readonly Column[],
  x: number,
  y: number,
  viewStart: number,
  viewEnd: number,
  durationMinutes: number,
  slot = 30,
): { date: string; minute: number } | null {
  if (columns.length === 0) return null;
  const column =
    columns.find((c) => x >= c.left && x < c.right) ??
    [...columns].sort(
      (a, b) => Math.abs((a.left + a.right) / 2 - x) - Math.abs((b.left + b.right) / 2 - x),
    )[0];
  if (!column) return null;
  const frac = Math.min(1, Math.max(0, (y - column.top) / (column.bottom - column.top || 1)));
  const raw = viewStart + frac * (viewEnd - viewStart);
  const snapped = Math.round(raw / slot) * slot;
  const minute = Math.min(Math.max(snapped, viewStart), viewEnd - durationMinutes);
  return { date: column.date, minute };
}

/**
 * The start closest to `minute` (in `slot` steps, later first on ties) where a block
 * of `duration` fits inside [min, max] without touching any `busy` interval.
 */
export function nearestFree(
  minute: number,
  duration: number,
  busy: readonly { start: number; end: number }[],
  slot: number,
  min: number,
  max: number,
): number | null {
  const fits = (s: number) =>
    s >= min && s + duration <= max && busy.every((b) => s + duration <= b.start || s >= b.end);
  for (let d = 0; d <= max - min; d += slot) {
    if (fits(minute + d)) return minute + d;
    if (fits(minute - d)) return minute - d;
  }
  return null;
}
