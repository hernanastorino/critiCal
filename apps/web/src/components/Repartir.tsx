import { useDeferredValue, useMemo, useRef, useState } from "react";
import { clipName } from "../format.js";
import type { AppTask } from "../model.js";
import { doneMinutes } from "../planning.js";
import {
  applySheet,
  canAccept,
  fitOf,
  openSheet,
  type Prefill,
  type Sheet,
  trialOf,
} from "../repartir.js";
import { useStore } from "../store.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import { Marks } from "./icons.js";
import { useModal } from "./modal.js";
import { SheetBoundary } from "./RepartirBoundary.js";
import { FitWarning, Pickers, Rest, TemaList, TotalRow } from "./RepartirParts.js";
import { PLAN_KEYS, useUndoable } from "./useUndoable.js";

/**
 * «Repartir tiempo» (SPEC §18 punto 18): the total of a task and a slider for each tema.
 * It only gives back what was decided (`onAccept`); the caller saves it.
 */
export function Repartir(props: RepartirProps) {
  return (
    <SheetBoundary onClose={props.onClose}>
      <RepartirSheet {...props} />
    </SheetBoundary>
  );
}

interface RepartirProps {
  task: AppTask;
  /** Where it starts when that is not the task as it is (what an option would leave). */
  initial?: Prefill;
  onAccept: (next: AppTask) => void;
  onClose: () => void;
}

function RepartirSheet({ task: given, initial, onAccept, onClose }: RepartirProps) {
  const { data, now } = useStore();
  // The task as it was when the sheet opened: the plan is not worked out again for a new object.
  const [task] = useState(given);
  const sheetEl = useRef<HTMLDivElement>(null);
  // A weekly silo counts what was done in its week, not all of it: no floor from the past.
  const done = useMemo(
    () => (task.kind === "habit" ? 0 : doneMinutes(data, task.id)),
    [data, task],
  );
  const [start] = useState(() => openSheet(initial ?? task, done));
  const [s, setS] = useState<Sheet>(start);
  const [typing, setTyping] = useState<"total" | string | null>(null);
  const [asking, setAsking] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(start);
  const askClose = () => (dirty ? setAsking(true) : onClose());
  const justOpened = useModal(sheetEl, askClose);
  // The plan is worked out for what the sliders stopped on, not for every step of a drag.
  const calm = useDeferredValue(s);
  const fit = useMemo(() => fitOf(data, now, trialOf(task, calm)), [data, now, task, calm]);
  const hasRows = s.rows.length > 0;

  return (
    <>
      {/* For taps; the keyboard and VoiceOver have ✕ and Escape. */}
      <button
        type="button"
        className="scrim dim top"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) askClose();
        }}
      />
      <div
        ref={sheetEl}
        className="sheet repartir"
        role="dialog"
        aria-modal="true"
        aria-label="Repartir tiempo"
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={askClose}>
          <Marks.close />
        </button>
        <h2>Repartir tiempo</h2>
        <p className="meta rep-task">{clipName(task.title)}</p>
        <div className="rep-top">
          <TotalRow s={s} setS={setS} onOpen={() => setTyping("total")} />
          <FitWarning fit={fit} />
          {hasRows && <Rest s={s} setS={setS} />}
        </div>
        {(hasRows || task.kind !== "habit") && <TemaList s={s} setS={setS} onOpen={setTyping} />}
        <button
          type="button"
          className="btn primary rep-accept"
          disabled={!canAccept(s)}
          onClick={() => onAccept(applySheet(task, s))}
        >
          Aceptar reparto
        </button>
      </div>
      <Pickers s={s} setS={setS} typing={typing} onClose={() => setTyping(null)} />
      {asking && (
        <ConfirmDiscard
          onDiscard={() => {
            setAsking(false);
            onClose();
          }}
          onKeep={() => setAsking(false)}
        />
      )}
    </>
  );
}

/**
 * A weekly study silo has only its total: it is kept as whole sessions of the length it
 * already has (the week asks sessions × minutes).
 */
function weekly(task: AppTask, next: AppTask): AppTask {
  const session = task.sessionMinutes ?? 0;
  if (task.kind !== "habit" || session <= 0) return next;
  // The exact minutes are kept; the sessions that hold them are rounded up (as Semester does).
  return { ...next, sessionsPerWeek: Math.max(1, Math.ceil(next.estimateMinutes / session)) };
}

/**
 * «Repartir tiempo» on a task of the app: «Aceptar» saves it in one step, which leaves one
 * entry in the ↶ («repartir X»), and says so with a notice that undoes it.
 */
export function RepartirTask({
  task,
  initial,
  message,
  optionId,
  onClose,
  onDone,
  onUndone,
}: {
  task: AppTask;
  initial?: Prefill;
  /** What the notice says (it always offers «Deshacer»). */
  message?: string;
  /** An option of the Bandeja: accepted as that decision (it keeps its «Decisión que tomaste»). */
  optionId?: string;
  onClose: () => void;
  onDone?: () => void;
  /** Called when the notice's «Deshacer» took it back (where focus should go). */
  onUndone?: () => void;
}) {
  const answer = useUndoable(() => onUndone?.());
  // A weekly study silo opens with what its week holds: its minutes or its sessions.
  const week =
    task.kind === "habit" && !initial
      ? {
          estimateMinutes:
            task.estimateMinutes > 0
              ? task.estimateMinutes
              : (task.sessionsPerWeek ?? 0) * (task.sessionMinutes ?? 0),
          minMinutes: task.minMinutes,
          units: [],
        }
      : initial;
  return (
    <Repartir
      task={task}
      initial={week}
      onClose={onClose}
      onAccept={(next) => {
        answer(
          message ?? `Repartiste ${clipName(task.title)}`,
          optionId
            ? { type: "applyOption", optionId, task: next }
            : {
                type: "batch",
                label: `repartir ${clipName(task.title, 24)}`,
                actions: [{ type: "saveTask", task: weekly(task, next) }],
              },
          [...PLAN_KEYS],
          { tasks: [task], key: "repartir", ...(message ? { roy: "festejo" as const } : {}) },
        );
        onDone?.();
        onClose();
      }}
    />
  );
}
