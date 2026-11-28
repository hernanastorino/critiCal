import { useRef, useState } from "react";
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

/** What is wrong with the times a week and the minutes of a routine, each in its own field. */
function routineProblems(times: string, minutes: string, days = 7) {
  // «3.5» is not rounded to 4 behind the back: whole numbers only.
  const t = isWhole(times) ? Number(times) : Number.NaN;
  const m = isWhole(minutes) ? Number(minutes) : Number.NaN;
  const timesBad = !Number.isFinite(t) || t < 1 || t > 14;
  const minutesBad = !Number.isFinite(m) || m < 1 || m > 360;
  const decimals = (v: string) => isFigure(v) && !isWhole(v);
  return {
    times: decimals(times)
      ? "Las veces por semana: solo números enteros, de 1 a 14."
      : timesBad
        ? "Las veces por semana van de 1 a 14."
        : !minutesBad && !validRoutine(t, m)
          ? "Eso suma más de 40 h por semana."
          : t > days
            ? `Como mucho una por día: con esos días son ${days} por semana.`
            : null,
    minutes: decimals(minutes)
      ? "Los minutos por sesión: solo números enteros, de 1 a 360."
      : minutesBad
        ? "Los minutos por sesión van de 1 a 360."
        : null,
  };
}

/** What is typed for a new routine; it waits (a draft) under `key` until it is added or left. */
export const emptyRoutineDraft = () => ({
  name: "",
  times: "3",
  minutes: "60",
  hours: emptyHoursForm(),
});

export function useRoutineDraft(key: string) {
  return useDraft(key, emptyRoutineDraft);
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
  const setName = (v: string) => setDraft({ ...draft, name: v });
  const setTimes = (v: string) => setDraft({ ...draft, times: v });
  const setMinutes = (v: string) => setDraft({ ...draft, minutes: v });
  const setHours = (v: typeof hours) => setDraft({ ...draft, hours: v });
  // Two «Nadar» would be told apart by nothing.
  const repeated = data.activities.some((a) => sameName(a.name, name));
  const minutesBad = routineProblems(times, minutes).minutes;
  // A franja shorter than the session is said once the session is a valid figure.
  const read = readHours(
    hours,
    minutesBad ? undefined : Number(minutes),
    data.settings.slotMinutes,
  );
  // One a day at most: more times than days the routine can go is said in its own field.
  const problem = routineProblems(
    times,
    minutes,
    minutesBad ? 7 : daysAllowed(read.hours, Number(minutes), data.settings.slotMinutes),
  );
  const bad = !!(problem.times || problem.minutes || read.problems.length);
  const rounding = minutesBad ? null : slotNote(Number(minutes), data.settings.slotMinutes);
  const nameField = useRef<HTMLInputElement>(null);
  // Nothing readable in the name (spaces, zero-width characters): said when typed or tried.
  const [nameTried, setNameTried] = useState(false);
  const blank = isBlank(name) && (name !== "" || nameTried);
  const askFocus = useFocusInvalid();
  // The button and Enter in any field do the same: a wrong field is said, not added.
  const add = (form: Element | null) => {
    if (isBlank(name)) {
      setNameTried(true);
      askFocus(form?.querySelector(".fields") ?? null);
      return;
    }
    if (repeated) return;
    if (bad) {
      focusFirstInvalid(form);
      return;
    }
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
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add(e.currentTarget.closest(".fields")?.parentElement ?? null);
  };
  return (
    <div className="routine-form-view">
      {onBack && (
        <>
          <button type="button" className="settings-back" onClick={onBack}>
            ‹ Rutinas
          </button>
          <h3>Rutina nueva</h3>
        </>
      )}
      <div className="row fields top wrap-big">
        <label className="field name-wide" style={{ flex: 2 }}>
          <span>Rutina</span>
          <input
            ref={nameField}
            value={name}
            maxLength={NAME_MAX}
            aria-invalid={blank || (repeated && name.trim()) ? true : undefined}
            aria-describedby={
              blank
                ? "routine-blank-error"
                : repeated && name.trim()
                  ? "routine-name-error"
                  : undefined
            }
            onChange={(e) => {
              // Direction-changing characters never show in the field (see `stripBidi`).
              setName(stripBidi(e.target.value));
              setNameTried(false);
            }}
            onKeyDown={onEnter}
            placeholder="Gimnasio"
          />
        </label>
        <div style={{ flex: 1 }}>
          <label className="field">
            <span>Veces/sem.</span>
            <input
              inputMode="numeric"
              value={times}
              aria-invalid={problem.times ? true : undefined}
              aria-describedby={describedBy(
                problem.times ? "routine-times-error" : undefined,
                "routine-times-help",
              )}
              onKeyDown={onEnter}
              onChange={(e) => setTimes(e.target.value)}
            />
          </label>
          <Help id="routine-times-help" text="Cuántas veces por semana la hacés." />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field">
            <span>Minutos</span>
            <input
              inputMode="numeric"
              value={minutes}
              aria-invalid={problem.minutes ? true : undefined}
              aria-describedby={describedBy(
                problem.minutes ? "routine-minutes-error" : undefined,
                "routine-minutes-help",
              )}
              onKeyDown={onEnter}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <Help id="routine-minutes-help" text={rounding ?? "Lo que dura cada vez."} />
        </div>
      </div>
      <RoutineHours
        form={hours}
        onChange={setHours}
        problems={read.problems}
        errorId="routine-hours-error"
        onEnter={onEnter}
      />
      <ProblemSlot>
        <Problem id="routine-hours-error" text={hoursSummary(read.problems)} />
        <Problem id="routine-blank-error" text={blank ? "Poné un nombre." : null} />
        <Problem id="routine-times-error" text={problem.times} />
        <Problem id="routine-minutes-error" text={problem.minutes} />
      </ProblemSlot>
      <Unsaved show={dirty} />
      <button
        type="button"
        // Looks ready (dark) with valid data, and off with a blank name, a repeated one or a wrong field.
        className={`btn${isBlank(name) || repeated || bad ? "" : " primary"}`}
        style={{ width: "100%" }}
        disabled={repeated}
        aria-disabled={bad || isBlank(name) ? true : undefined}
        onClick={(e) => add(e.currentTarget.parentElement)}
      >
        Agregar rutina
      </button>
      <Problem
        id="routine-name-error"
        text={repeated && name.trim() ? "Ya hay una materia o rutina con ese nombre." : null}
      />
    </div>
  );
}
