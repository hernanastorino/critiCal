export interface EffortSample {
  activityId: string;
  estimatedMinutes: number;
  actualMinutes: number;
}

/** Pseudo-minutes pulling the ratio towards 1 until there is enough history. */
const PRIOR_MINUTES = 120;

/**
 * How long things really take versus the estimate, per activity (e.g. 1.3 means
 * 30 % longer). Shrunk towards 1 with little data and clamped to [0.5, 2].
 */
export function effortRatio(samples: readonly EffortSample[], activityId: string): number {
  let estimated = PRIOR_MINUTES;
  let actual = PRIOR_MINUTES;
  for (const s of samples) {
    if (s.activityId !== activityId || s.estimatedMinutes <= 0) continue;
    estimated += s.estimatedMinutes;
    actual += Math.max(0, s.actualMinutes);
  }
  return Math.min(2, Math.max(0.5, actual / estimated));
}

export interface Unit {
  estimateMinutes: number;
  done: boolean;
}

/** Remaining minutes of a task from its pending units, scaled by the learned ratio. */
export function remainingFromUnits(units: readonly Unit[], ratio: number): number {
  const pending = units.filter((u) => !u.done).reduce((sum, u) => sum + u.estimateMinutes, 0);
  return Math.round(pending * ratio);
}
