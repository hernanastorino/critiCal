import type { PlanBlock } from "./engine.js";

/**
 * Plan blocks of the same activity that touch (one ends exactly where the next starts) in
 * runs, for the week to draw one pill for each. Presentation only: the blocks stay as they
 * are. `alike` says what else must match to look like one (level, pinned, past or not);
 * a block that touches nothing alike comes out alone.
 */
export function blockRuns(
  blocks: PlanBlock[],
  alike: (a: PlanBlock, b: PlanBlock) => boolean = () => true,
): PlanBlock[][] {
  const runs: PlanBlock[][] = [];
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const b of sorted) {
    const run = runs.find((r) => {
      const last = r[r.length - 1] as PlanBlock;
      return last.activityId === b.activityId && last.end === b.start && alike(last, b);
    });
    if (run) run.push(b);
    else runs.push([b]);
  }
  return runs;
}
