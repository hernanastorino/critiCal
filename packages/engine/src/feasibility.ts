/** Minutes of work that must be done before a deadline. */
export interface Demand {
  id: string;
  /** Deadline, in minutes from "now". */
  deadline: number;
  /** Minimum minutes still required. */
  minRemaining: number;
}

export interface FeasibilityResult {
  feasible: boolean;
  /** Slack per demand id: free minutes left over at its deadline (negative = infeasible). */
  slack: Record<string, number>;
  /** First demand (by deadline) that cannot be met, if any. */
  firstViolation?: string;
}

/**
 * EDF feasibility: sorted by deadline, cumulative demand must never exceed the
 * capacity available up to that deadline.
 *
 * @param capacityUntil free minutes available between now and `t`; must be non-decreasing.
 */
export function checkFeasibility(
  demands: readonly Demand[],
  capacityUntil: (t: number) => number,
): FeasibilityResult {
  const sorted = [...demands].sort((a, b) => a.deadline - b.deadline);
  const slack: Record<string, number> = {};
  let cumulative = 0;
  let firstViolation: string | undefined;

  for (const d of sorted) {
    cumulative += Math.max(0, d.minRemaining);
    const s = capacityUntil(d.deadline) - cumulative;
    slack[d.id] = s;
    if (s < 0 && firstViolation === undefined) firstViolation = d.id;
  }

  return { feasible: firstViolation === undefined, slack, firstViolation };
}
