export interface Span {
  key: string;
  start: number;
  end: number;
}

/**
 * Side-by-side columns for what overlaps in a day, like Calendario de iOS: each group of
 * blocks that touch each other in time shares its width, and each block takes the first
 * column free at its start. Blocks that overlap nothing keep the whole width.
 */
export function lanes(spans: Span[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...spans]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: { key: string; col: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const g of group) out.set(g.key, { col: g.col, cols: colEnds.length });
    group = [];
    colEnds = [];
  };
  for (const s of sorted) {
    if (s.start >= groupEnd) {
      close();
      groupEnd = s.end;
    } else groupEnd = Math.max(groupEnd, s.end);
    let col = colEnds.findIndex((end) => end <= s.start);
    if (col === -1) col = colEnds.push(s.end) - 1;
    else colEnds[col] = s.end;
    group.push({ key: s.key, col });
  }
  close();
  return out;
}
