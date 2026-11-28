import { useState } from "react";
import { useDraft } from "../drafts.js";
import { isBlank, NAME_MAX, stripBidi } from "../limits.js";
import { daysAllowed, emptyHoursForm, readHours } from "../routineHours.js";
import { useStore } from "../store.js";
import { sameName, validRoutine } from "../subjects.js";
import { slotNote } from "../taskForm.js";
import {
  describedBy,
  focusFirstInvalid,
  Help,
  isFigure,
  isWhole,
  Problem,
  ProblemSlot,
  Unsaved,
  useFocusInvalid,
} from "./fields.js";
import { hoursSummary, RoutineHours } from "./RoutineHours.js";

type Enter = React.KeyboardEventHandler<HTMLInputElement>;

/** A whole number from what was typed, or NaN: «3.5» is not rounded to 4 behind the back. */
const wholeOf = (v: string) => (isWhole(v) ? Number(v) : Number.NaN);
const timesOutOfRange = (t: number) => !Number.isFinite(t) || t < 1 || t > 14;
const minutesOutOfRange = (m: number) => !Number.isFinite(m) || m < 1 || m > 360;
const hasDecimals = (v: string) => isFigure(v) && !isWhole(v);

function timesProblem(typed: string, t: number, m: number, days: number): string | null {
  if (hasDecimals(typed)) return "Las veces por semana: solo números enteros, de 1 a 14.";
  if (timesOutOfRange(t)) return "Las veces por semana van de 1 a 14.";
  if (!minutesOutOfRange(m) && !validRoutine(t, m)) return "Eso suma más de 40 h por semana.";
  if (t > days) return `Como mucho una por día: con esos días son ${days} por semana.`;
  return null;
}

function minutesProblem(typed: string, m: number): string | null {
  if (hasDecimals(typed)) return "Los minutos por sesión: solo números enteros, de 1 a 360.";
  if (minutesOutOfRange(m)) return "Los minutos por sesión van de 1 a 360.";
  return null;
}

/** What is wrong with the times a week and the minutes of a routine, each in its own field. */
function routineProblems(times: string, minutes: string, days = 7) {
  const t = wholeOf(times);
  const m = wholeOf(minutes);
  return { times: timesProblem(times, t, m, days), minutes: minutesProblem(minutes, m) };
}

/** What is typed for a new routine; it waits (a draft) under `key` until it is added or left. */
export const emptyRoutineDraft = () => ({
  name: "",
  times: "3",
  minutes: "60",
  hours: emptyHoursForm(),
});

type Draft = ReturnType<typeof emptyRoutineDraft>;

export function useRoutineDraft(key: string) {
  return useDraft(key, emptyRoutineDraft);
}

/** What the typed figures say: the problems of each field and how the plan will round them. */
function checkRoutine(draft: Draft, slot: number) {
  const { times, minutes, hours } = draft;
  const minutesBad = routineProblems(times, minutes).minutes;
  // A franja shorter than the session is said once the session is a valid figure.
  const read = readHours(hours, minutesBad ? undefined : Number(minutes), slot);
  // One a day at most: more times than days the routine can go is said in its own field.
  const days = minutesBad ? 7 : daysAllowed(read.hours, Number(minutes), slot);
  const problem = routineProblems(times, minutes, days);
  const bad = Boolean(problem.times ?? problem.minutes) || read.problems.length > 0;
  const rounding = minutesBad ? null : slotNote(Number(minutes), slot);
  return { read, problem, bad, rounding };
}

/** What is said about the name, and whether the button looks ready. */
function nameStatus(name: string, repeated: boolean, tried: boolean, bad: boolean) {
  // Nothing readable in the name (spaces, zero-width characters): said when typed or tried.
  const empty = isBlank(name);
  const blank = empty && (name !== "" || tried);
  const clash = repeated && !!name.trim();
  const problemId = blank ? "routine-blank-error" : clash ? "routine-name-error" : undefined;
  return { blank, clash, problemId, empty, ready: !empty && !repeated && !bad };
}

function NameField({
  name,
  problemId,
  onChange,
  onEnter,
}: {
  name: string;
  problemId: string | undefined;
  onChange(value: string): void;
  onEnter: Enter;
}) {
  return (
    <label className="field name-wide" style={{ flex: 2 }}>
      <span>Rutina</span>
      <input
        value={name}
        maxLength={NAME_MAX}
        aria-invalid={problemId ? true : undefined}
        aria-describedby={problemId}
        // Direction-changing characters never show in the field (see `stripBidi`).
        onChange={(e) => {
          onChange(stripBidi(e.target.value));
        }}
        onKeyDown={onEnter}
        placeholder="Gimnasio"
      />
    </label>
  );
}

function FigureField({
  label,
  value,
  problem,
  id,
  help,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  problem: string | null;
  /** «times» or «minutes»: the ids of its error and its help. */
  id: string;
  help: string;
  onChange(value: string): void;
  onEnter: Enter;
}) {
  return (
    <div style={{ flex: 1 }}>
      <label className="field">
        <span>{label}</span>
        <input
          inputMode="numeric"
          value={value}
          aria-invalid={problem ? true : undefined}
          aria-describedby={describedBy(
            problem ? `routine-${id}-error` : undefined,
            `routine-${id}-help`,
          )}
          onKeyDown={onEnter}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </label>
      <Help id={`routine-${id}-help`} text={help} />
    </div>
  );
}

function BackHeader({ onBack }: { onBack: (() => void) | undefined }) {
  if (!onBack) return null;
  return (
    <>
      <button type="button" className="settings-back" onClick={onBack}>
        ‹ Rutinas
      </button>
      <h3>Rutina nueva</h3>
    </>
  );
}

function AddFooter({
  ready,
  repeated,
  blocked,
  dirty,
  onAdd,
}: {
  /** Valid data and a name nobody has: the button looks ready. */
  ready: boolean;
  repeated: boolean;
  blocked: boolean;
  dirty: boolean;
  onAdd(form: Element | null): void;
}) {
  return (
    <>
      <Unsaved show={dirty} />
      <button
        type="button"
        className={`btn${ready ? " primary" : ""}`}
        style={{ width: "100%" }}
        disabled={repeated}
        aria-disabled={blocked ? true : undefined}
        onClick={(e) => {
          onAdd(e.currentTarget.parentElement);
        }}
      >
        Agregar rutina
      </button>
    </>
  );
}

/**
 * The form of a new routine: the one of Ajustes › Rutinas and of «Hábito semanal» (a habit
 * is a routine). `onBack` draws the way back to the list; without it the form sits in a sheet.
 */
export function RoutineForm({
  state,
  onBack,
  onAdded,
}: {
  state: ReturnType<typeof useRoutineDraft>;
  onBack?: () => void;
  onAdded: () => void;
}) {
  const { data, dispatch } = useStore();
  const [draft, setDraft, drafted, dirty] = state;
  const { name, times, minutes, hours } = draft;
  // Two «Nadar» would be told apart by nothing.
  const repeated = data.activities.some((a) => sameName(a.name, name));
  const { read, problem, bad, rounding } = checkRoutine(draft, data.settings.slotMinutes);
  const [nameTried, setNameTried] = useState(false);
  const status = nameStatus(name, repeated, nameTried, bad);
  const askFocus = useFocusInvalid();
  // The button and Enter in any field do the same: a wrong field is said, not added.
  const add = (form: Element | null) => {
    if (status.empty) {
      setNameTried(true);
      askFocus(form?.querySelector(".fields") ?? null);
    } else if (bad) {
      if (!repeated) focusFirstInvalid(form);
    } else if (!repeated) {
      dispatch({
        type: "saveRoutine",
        name,
        sessionsPerWeek: Math.round(Number(times)),
        sessionMinutes: Math.round(Number(minutes)),
        validHours: read.hours,
      });
      // Back to the defaults: the next routine does not inherit this one's figures.
      drafted(emptyRoutineDraft());
      onAdded();
    }
  };
  const onEnter: Enter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add(e.currentTarget.closest(".fields")?.parentElement ?? null);
  };
  return (
    <div className="routine-form-view">
      <BackHeader onBack={onBack} />
      <div className="row fields top wrap-big">
        <NameField
          name={name}
          problemId={status.problemId}
          onChange={(v) => {
            setDraft({ ...draft, name: v });
            setNameTried(false);
          }}
          onEnter={onEnter}
        />
        <FigureField
          label="Veces/sem."
          value={times}
          problem={problem.times}
          id="times"
          help="Cuántas veces por semana la hacés."
          onChange={(v) => {
            setDraft({ ...draft, times: v });
          }}
          onEnter={onEnter}
        />
        <FigureField
          label="Minutos"
          value={minutes}
          problem={problem.minutes}
          id="minutes"
          help={rounding ?? "Lo que dura cada vez."}
          onChange={(v) => {
            setDraft({ ...draft, minutes: v });
          }}
          onEnter={onEnter}
        />
      </div>
      <RoutineHours
        form={hours}
        onChange={(v) => {
          setDraft({ ...draft, hours: v });
        }}
        problems={read.problems}
        errorId="routine-hours-error"
        onEnter={onEnter}
      />
      <ProblemSlot>
        <Problem id="routine-hours-error" text={hoursSummary(read.problems)} />
        <Problem id="routine-blank-error" text={status.blank ? "Poné un nombre." : null} />
        <Problem id="routine-times-error" text={problem.times} />
        <Problem id="routine-minutes-error" text={problem.minutes} />
      </ProblemSlot>
      <AddFooter
        ready={status.ready}
        repeated={repeated}
        blocked={bad || status.empty}
        dirty={dirty}
        onAdd={add}
      />
      <Problem
        id="routine-name-error"
        text={status.clash ? "Ya hay una materia o rutina con ese nombre." : null}
      />
    </div>
  );
}
