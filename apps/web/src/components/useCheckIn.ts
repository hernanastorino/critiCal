import { MINUTE, type PlanBlock } from "../engine.js";
import { SKIPPED_TOAST } from "../friendly.js";
import { useStore } from "../store.js";
import { useToast } from "./Toast.js";

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
  return (
    block: PlanBlock,
    status: CheckInStatus,
    opts: { minutesDone?: number; unitIds?: string[] } = {},
  ) => {
    const corrects = data.checkIns.some((c) => c.blockId === block.id);
    dispatch({
      type: "checkIn",
      checkIn: {
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
    });
    toast.show(said(status, corrects), {
      ...(status === "missed" && !corrects ? { roy: "hombros" as const } : {}),
      undo: () => {
        dispatch({ type: "undoCheckIn", blockId: block.id });
        onUndone?.(block.id);
      },
    });
  };
}
