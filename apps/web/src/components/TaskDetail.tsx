import { useRef, useState } from "react";
import { dayDate, dueDate, hours } from "../format.js";
import type { AppTask } from "../model.js";
import { checkInFactor, earliestStartOf, endOfWeek, progress } from "../planning.js";
import { type RecurrenceChange, useStore } from "../store.js";
import { ActionSheet } from "./ActionSheet.js";
import { focusFirstInvalid, isFigure, isWhole, Problem } from "./fields.js";
import { useModal } from "./modal.js";
import { useToast } from "./Toast.js";

/** Each topic becomes a unit, so a typo like 1e9 must not allocate a billion. */
export const MAX_TOPICS = 500;

/** The most minutes one record can hold: a whole day. */
const MAX_LOG_MINUTES = 1440;

/** What is wrong with the minutes typed in the log, if anything (empty is fine: 0). */
export function minutesError(text: string): string | null {
  if (text.trim() === "") return null;
  const ok = isFigure(text) && Number(text.replace(",", ".")) <= MAX_LOG_MINUTES;
  if (!ok) return "Poné minutos de 0 a 1440, solo cifras.";
  return isWhole(text) ? null : "Poné solo minutos enteros, sin decimales.";
}

/** What is wrong with the topics in total typed in the log, if anything (empty is fine). */
export function topicsError(text: string): string | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return isWhole(text) && n >= 1 && n <= MAX_TOPICS
    ? null
    : `Poné de 1 a ${MAX_TOPICS} temas, en cifras enteras.`;
}

/** What is wrong with the topics done typed in the log, given the total typed. */
export function topicsDoneError(done: string, total: string): string | null {
  if (done.trim() === "") return null;
  if (!isWhole(done)) return "Poné los temas hechos en cifras enteras, de 0 hasta el total.";
  if (total.trim() === "" || topicsError(total)) return "Poné primero los temas en total.";
  return Number(done) > Number(total) ? "No pueden ser más que los temas en total." : null;
}

/** Silo detail: what is left and a quick "this is how far I got" log. */
export function TaskDetail({
  task,
  onEdit,
  onClose,
}: {
  task: AppTask;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { data, now, dispatch } = useStore();
  const toast = useToast();
  const startsAt = earliestStartOf(data, task);
  const tz = data.settings.timezone;
  const p = progress(data, now).find((x) => x.task.id === task.id);
  const factor = checkInFactor(data, task.id) ?? 1;
  const [minutes, setMinutes] = useState("");
  const [topics, setTopics] = useState("");
  const [topicsDone, setTopicsDone] = useState("");
  const [units, setUnits] = useState<string[]>([]);
  /** Parts already done that were unchecked here. */
  const [reopen, setReopen] = useState<string[]>([]);
  const [ask, setAsk] = useState<"off" | "delete" | null>(null);
  const live = data.tasks.find((t) => t.id === task.id) ?? task;
  const repeat = (change: RecurrenceChange) => {
    dispatch({ type: "recurrence", taskId: task.id, change });
    setAsk(null);
    if (change !== "resume") onClose();
  };
  const offState = live.paused
    ? "Pausado hasta que lo reactives."
    : (live.skipUntil ?? 0) > now
      ? `Salteado esta semana · vuelve el ${dayDate(tz, live.skipUntil as number)}.`
      : null;
  const sheet = useRef<HTMLDivElement>(null);
  const justOpened = useModal(sheet, onClose);
  const badMinutes = minutesError(minutes);
  const badTopics = topicsError(topics);
  const badDone = topicsDoneError(topicsDone, topics);
  const invalid = !!(badMinutes || badTopics || badDone);
  // Saved with nothing written: said, and it stays open (until something changes).
  const form = JSON.stringify([minutes, topics, topicsDone, units, reopen]);
  const [emptyAt, setEmptyAt] = useState<string | null>(null);
  const parts = live.units;
  const isDone = (u: AppTask["units"][number]) =>
    u.doneAt ? !reopen.includes(u.id) : units.includes(u.id);
  const done = parts.filter(isDone).length;

  return (
    <>
      {/* For taps; the keyboard and VoiceOver have ✕ and Escape. */}
      <button
        type="button"
        className="scrim dim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) onClose();
        }}
      />
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label={task.title}>
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>
        <h2>{task.title}</h2>
        <p className="meta">
          {p && `Faltan ${hours(p.remainingMinutes)} (mínimo ${hours(p.minRemainingMinutes)})`}
          {task.deadline &&
            ` · ${task.deadline <= now && (p?.remainingMinutes ?? 0) > 0 ? "Venció " : ""}${dueDate(tz, task.deadline, now)}`}
        </p>
        {task.units.length > 0 && p && (
          <p className="meta">
            «Faltan» se mide por las partes: marcá las que hiciste para bajarlo (los minutos solos
            no lo mueven).
          </p>
        )}
        {startsAt !== undefined &&
          startsAt > now &&
          (task.deadline !== undefined && startsAt >= task.deadline ? (
            <p className="meta">
              Empieza el {dayDate(tz, startsAt)}, después de la entrega: el plan no le da tiempo.
              Cambiá «Puedo empezar» en la tarea o en su materia.
            </p>
          ) : (
            <p className="meta">
              Empezás el {dayDate(tz, startsAt)}, como pusiste en «Puedo empezar»: antes el plan no
              le da tiempo.
            </p>
          ))}

        <div className="section-title" style={{ marginTop: 4 }}>
          Registrar avance
        </div>
        <label className="field">
          <span>Le dediqué (minutos)</span>
          <input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="40"
            aria-invalid={badMinutes ? true : undefined}
            aria-describedby={
              [badMinutes && "minutes-error", factor > 1 && "break-note"]
                .filter(Boolean)
                .join(" ") || undefined
            }
          />
          {badMinutes && (
            <span
              className="meta"
              id="minutes-error"
              role="alert"
              style={{ margin: 0, color: "var(--critical)" }}
            >
              {badMinutes}
            </span>
          )}
          {factor > 1 && (
            <span className="meta" id="break-note" style={{ margin: 0 }}>
              Contá el tiempo con descansos: {hours(240)} de bloque descuentan ~
              {hours(Math.round(240 / factor))} de estudio.
              {task.units.length > 0 &&
                " Marcá también las partes hechas: lo que falta se mide por ellas."}
            </span>
          )}
        </label>
        {task.units.length > 0 ? (
          <div className="field">
            <span>
              Partes hechas ({done} de {parts.length})
            </span>
            {parts.map((u) => (
              <label key={u.id} className="check">
                <input
                  type="checkbox"
                  checked={isDone(u)}
                  onChange={(e) => {
                    // One already done is taken back, not marked again.
                    const set = u.doneAt ? setReopen : setUnits;
                    const list = u.doneAt ? reopen : units;
                    const on = u.doneAt ? !e.target.checked : e.target.checked;
                    set(on ? [...list, u.id] : list.filter((x) => x !== u.id));
                  }}
                />
                {u.title}
              </label>
            ))}
          </div>
        ) : task.kind === "habit" ? null : (
          <>
            <div className="grid2">
              <label className="field">
                <span>Temas en total</span>
                <input
                  inputMode="numeric"
                  value={topics}
                  onChange={(e) => setTopics(e.target.value)}
                  placeholder="10"
                  aria-invalid={badTopics ? true : undefined}
                  aria-describedby={badTopics ? "topics-error" : undefined}
                />
              </label>
              <label className="field">
                <span>Llevo hechos</span>
                <input
                  inputMode="numeric"
                  value={topicsDone}
                  onChange={(e) => setTopicsDone(e.target.value)}
                  placeholder="6"
                  aria-invalid={badDone ? true : undefined}
                  aria-describedby={badDone ? "done-error" : undefined}
                />
              </label>
            </div>
            <Problem id="topics-error" text={badTopics} />
            <Problem id="done-error" text={badDone} />
          </>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onEdit}>
            Editar
          </button>
          <button
            type="button"
            className="btn primary"
            aria-disabled={invalid ? true : undefined}
            onClick={() => {
              if (invalid) {
                focusFirstInvalid(sheet.current);
                return;
              }
              const total = topics.trim() === "" ? 0 : Number(topics);
              const logged = Number(minutes.replace(",", ".")) || 0;
              if (logged <= 0 && total === 0 && units.length === 0 && reopen.length === 0) {
                setEmptyAt(form);
                return;
              }
              dispatch({
                type: "logProgress",
                taskId: task.id,
                minutes: logged,
                unitIds: units,
                reopenUnitIds: reopen,
                topics: total || undefined,
                topicsDone: Number(topicsDone) || 0,
              });
              toast.show(
                logged > 0
                  ? `Avance guardado: ${hours(logged)} en ${task.title}`
                  : `Avance guardado en ${task.title}`,
              );
              onClose();
            }}
          >
            Guardar avance
          </button>
        </div>
        <Problem
          id="no-progress"
          text={emptyAt === form ? "No anotaste avance: poné minutos, temas o marcá partes." : null}
        />

        {(task.kind === "habit" || offState) && (
          <div className="repeat">
            <div className="section-title">Se repite cada semana</div>
            {offState && <p className="state">{offState}</p>}
            <div className="row">
              {offState ? (
                <button type="button" className="btn" onClick={() => repeat("resume")}>
                  Reactivar
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => setAsk("off")}>
                  Desactivar…
                </button>
              )}
              <button type="button" className="btn danger" onClick={() => setAsk("delete")}>
                Eliminar…
              </button>
            </div>
          </div>
        )}
      </div>
      {ask === "off" && (
        <ActionSheet
          title={`Desactivar ${task.title}`}
          message="Las semanas anteriores no cambian."
          onCancel={() => setAsk(null)}
          options={[
            {
              label: "Solo esta semana",
              detail: `Vuelve el ${dayDate(tz, endOfWeek(tz, now))}`,
              onPick: () => repeat("skipWeek"),
            },
            {
              label: "Hasta que lo reactive",
              detail: "Lo podés volver a prender desde este silo",
              onPick: () => repeat("pause"),
            },
          ]}
        />
      )}
      {ask === "delete" && (
        <ActionSheet
          title={`Eliminar ${task.title}`}
          message="Es un silo que se repite cada semana."
          onCancel={() => setAsk(null)}
          options={[
            {
              label: "Eliminar de hoy en adelante",
              detail: "Las semanas anteriores quedan en tu historial",
              danger: true,
              onPick: () => repeat("endFromToday"),
            },
            {
              label: "Eliminar todo",
              detail: "También borra lo registrado en semanas anteriores",
              danger: true,
              onPick: () => repeat("deleteAll"),
            },
          ]}
        />
      )}
    </>
  );
}
