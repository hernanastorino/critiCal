import { MINUTE, type PlanBlock } from "../engine.js";
import { SKIPPED_TOAST } from "../friendly.js";
import { newId } from "../model.js";
import { standingCheckIns } from "../planning.js";
import { useStore } from "../store.js";
import { useToast } from "./Toast.js";
import { useTapOnce } from "./useTapOnce.js";

export type CheckInStatus = "done" | "missed" | "partial";

/** What the notice says: the answer, or that it was corrected. */
function said(status: CheckInStatus, corrects: boolean): string {
  if (status === "done")
    return corrects ? "Corregido: ahora figura como hecho." : "Anotado como hecho.";
  if (status === "partial")
    return corrects ? "Corregido: ahora figura como parcial." : "Anotado como parcial.";
  return corrects ? "Corregido: ahora figura como no hecho." : SKIPPED_TOAST;
}

/**
 * Answers how a block went, and says so with a notice that offers «Deshacer» (SPEC §14).
 * Answering a block that already has an answer adds a correction: the log only grows
 * (SPEC §3), the newest check-in of the block is the one that stands, and undoing it
 * brings the previous answer back. `onUndone` runs after an undo, for whoever must put
 * the focus back where the answer was.
 */
export function useCheckIn(onUndone?: (blockId: string) => void) {
  const { data, dispatch } = useStore();
  const toast = useToast();
  const once = useTapOnce();
  return (
    block: PlanBlock,
    status: CheckInStatus,
    opts: { minutesDone?: number; unitIds?: string[] } = {},
  ) =>
    once(`${block.id}:${status}:${opts.minutesDone ?? 0}`, () => {
      const corrects = standingCheckIns(data).some((c) => c.blockId === block.id);
      // The record is named here so «Deshacer» takes back this one and nothing newer.
      const id = newId();
      // The plan before the answer and right after it: «Deshacer» puts the first one back.
      const plans = { before: data.plan, after: data.plan };
      dispatch(
        {
          type: "checkIn",
          checkIn: {
            id,
            blockId: block.id,
            taskId: block.taskId,
            status,
            minutesDone:
              status === "done"
                ? (block.end - block.start) / MINUTE
                : status === "partial"
                  ? (opts.minutesDone ?? 0)
                  : 0,
            unitIds: status === "missed" ? [] : (opts.unitIds ?? []),
          },
        },
        (after) => {
          plans.after = after.plan;
        },
      );
      toast.show(said(status, corrects), {
        ...(status === "missed" && !corrects ? { roy: "hombros" as const } : {}),
        undo: () => {
          dispatch({ type: "undoCheckIn", id, plans });
          onUndone?.(block.id);
        },
      });
    });
}
