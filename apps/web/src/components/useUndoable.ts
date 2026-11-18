import type { Activity } from "../engine.js";
import type { AppData, AppTask, Proposal } from "../model.js";
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

/** The answers of the Bandeja that are taken at the tap and can be undone. */
export function useInboxAnswers(onBack: (key: string) => void) {
  const answer = useUndoable(onBack);
  return {
    classAs: (c: { key: string; title: string }, as: "materia" | "event") => {
      answer(
        `«${c.title}» es ${as === "materia" ? "una materia" : "un evento suelto"}`,
        { type: "classTitle", title: c.title, as },
        SORT_KEYS,
        { key: c.key },
      );
    },
    sort: (a: Activity, as: "materia" | "rutina") => {
      answer(
        `«${a.name}» es ${as === "materia" ? "una materia" : "una rutina"}`,
        { type: "sortActivity", activityId: a.id, as },
        SORT_KEYS,
        { key: a.id },
      );
    },
    merge: (a: Activity, into: Activity) => {
      answer(
        `«${a.name}» juntada con ${into.name}`,
        { type: "mergeActivity", activityId: a.id, into: into.id },
        SORT_KEYS,
        { key: a.id },
      );
    },
    ignore: (t: AppTask) => {
      answer(`«${t.title}» ignorada`, { type: "review", taskId: t.id, keep: false }, PLAN_KEYS, {
        tasks: [t],
        key: t.id,
      });
    },
    reject: (p: Proposal) => {
      answer("Todo sigue como estaba", { type: "rejectProposal", id: p.id }, PROPOSAL_KEYS, {
        key: p.id,
      });
    },
  };
}
