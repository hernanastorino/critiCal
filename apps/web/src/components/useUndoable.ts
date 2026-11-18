import type { AppData, AppTask } from "../model.js";
import { snapshotOf, useStore } from "../store.js";
import { useToast } from "./Toast.js";

type Doing = Parameters<ReturnType<typeof useStore>["dispatch"]>[0];

/** What each kind of answer may change, to put back on «Deshacer». */
export const PLAN_KEYS = ["plan", "pins", "applied"] as const satisfies readonly (keyof AppData)[];
export const SORT_KEYS = [
  "activities",
  "tasks",
  "notSubjects",
  ...PLAN_KEYS,
] as const satisfies readonly (keyof AppData)[];
export const PROPOSAL_KEYS = [
  "plan",
  "proposals",
  "tentativeHoldUntil",
  "planHistory",
] as const satisfies readonly (keyof AppData)[];

/**
 * An answer taken at the tap, with a notice that offers «Deshacer» (SPEC §14): undoing
 * puts back exactly what the answer changed, and nothing else.
 */
export function useUndoable(onBack?: (key: string) => void) {
  const { data, dispatch } = useStore();
  const toast = useToast();
  return (
    message: string,
    doing: Doing,
    keys: readonly (keyof AppData)[],
    opts: { tasks?: readonly AppTask[]; key?: string } = {},
  ) => {
    const before = snapshotOf(data, keys, opts.tasks);
    dispatch(doing);
    toast.show(message, {
      undo: () => {
        dispatch({ type: "restoreState", before });
        if (opts.key) onBack?.(opts.key);
      },
    });
  };
}
