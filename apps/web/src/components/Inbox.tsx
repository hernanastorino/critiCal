import { useEffect, useId, useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { subjectName } from "../calendars.js";
import { type Activity, localParts, MINUTE, type OptionKind, type PlanBlock } from "../engine.js";
import {
  clipName,
  dayAndTime,
  dayDate,
  hhmmToMinutes,
  hours,
  minutesToHhmm,
  parseClock,
  time,
} from "../format.js";
import {
  FREE_TODAY,
  mealNoRoom,
  type NoFitKind,
  noFit,
  optionLine,
  REPLANNED_TOAST,
} from "../friendly.js";
import { EAT, inboxCards } from "../inbox.js";
import { lateNight } from "../lateNight.js";
import { isBlank } from "../limits.js";
import { type AppTask, undoable } from "../model.js";
import { nameTaken, spotFor, spotKey } from "../places.js";
import { DECISIONS_SHOWN_MS, endOfDay, onlyImpossibleLeft } from "../planning.js";
import { hoursRange, preferenceMisfits } from "../preferredHours.js";
import { hoursTooShort } from "../routineHours.js";
import { useStore } from "../store.js";
import { newClassTitles, unassignedTasks, unsortedActivities } from "../subjects.js";
import { BlockSheet } from "./BlockSheet.js";
import { Problem } from "./fields.js";
import { Marks } from "./icons.js";
import { useKeepFocus } from "./inboxFocus.js";
import { Loading } from "./Loading.js";
import { PlaceSearch } from "./PlaceSearch.js";
import { type RoyAnim, RoyLine } from "./Roy.js";
import { SubjectSearch } from "./SubjectSearch.js";
import { editorDraft, TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";
import { useCheckIn } from "./useCheckIn.js";
import { buzz, swipeAnswer } from "./useSwipe.js";
import { PLAN_KEYS, useInboxAnswers, useUndoable } from "./useUndoable.js";

/** Taps on «Hecho» / «No hecho» this soon after an answer are ignored (the list moved). */
export const ANSWER_GUARD_MS = 600;

/** What a plan B leaves for today: Roy rests when there is nothing left (SPEC §18.1). */
function ProposalToday({ text }: { text: string }) {
  return text ? <p className="meta">{text}</p> : <RoyLine anim="reposo">{FREE_TODAY}</RoyLine>;
}

const noFitKind = (t: AppTask, activities: Activity[], slot: number): NoFitKind => {
  if (t.kind !== "habit") return "dated";
  if (t.study) return "study";
  const activity = activities.find((a) => a.id === t.activityId);
  // A franja too short for one session is the cause, not the number of times.
  const session = t.sessionMinutes ?? activity?.minBlockMinutes ?? 0;
  if (activity?.kind === "rutina" && hoursTooShort(activity.validHours, session, slot))
    return "hours";
  // A habit made from Silos is not in Rutinas: it is edited where it was made.
  return activity?.kind === "rutina" ? "routine" : "habit";
};

/** Said when the options to choose from go away by themselves: the plan fits again. */
export const OPTIONS_GONE = "Ya no hace falta elegir: el plan alcanza";

/** Roy has this size in every «Elegí» card (SPEC §18.12). */
const ELEGI_ROY = 56;

/** Roy, small, in a pose of its own for each kind of option (SPEC §18.12). */
const OPTION_POSE: Record<OptionKind, RoyAnim> = {
  drop: "desarmado",
  "lower-minimum": "oruga",
  proportional: "cascada",
  "use-free-time": "puente",
  "minimum-only": "oruga",
  "move-event": "vayvuelve",
  "minimum-viable": "oruga",
  prioritize: "cascada",
  "start-earlier": "reposo",
};

/** The inbox: everything waiting on the user (questions, proposals, clashes, options). */
export function Inbox({
  onDay,
  onWeek,
  onRoutine,
}: {
  onDay?: (date: string) => void;
  onWeek?: () => void;
  /** Opens Ajustes on that routine, to edit it. */
  onRoutine?: (activityId: string) => void;
}) {
  const { data, now, pending, decisions, unlocated, pinShort, clashes, missedMeals, dispatch } =
    useStore();
  const { result: plan } = useStore();
  const offline = !!useSync()?.status.offline;
  const toast = useToast();
  const tz = data.settings.timezone;
  const [open, setOpen] = useState<PlanBlock | null>(null);
  const [editing, setEditing] = useState<AppTask | null>(() => {
    const d = editorDraft("inbox");
    return (d && data.tasks.find((t) => t.id === d.taskId)) || null;
  });
  const titleOf = (b: PlanBlock) => data.tasks.find((t) => t.id === b.taskId)?.title ?? "Bloque";
  const colorOf = (b: PlanBlock) => data.activities.find((a) => a.id === b.activityId)?.color;
  const review = data.tasks.filter((t) => t.needsReview && t.status === "active");
  const moves = (data.movedEvents ?? []).flatMap((m) => {
    const event = data.events.find((e) => e.id === m.eventId);
    return event ? [{ ...m, event }] : [];
  });
  // Tasks that fit nowhere even alone: the Bandeja names them as the cause.
  const noFits = decisions.impossible.flatMap((id) => data.tasks.filter((t) => t.id === id));
  // Options that go away by themselves (the plan fits now) are said, not just dropped.
  const optionCount = decisions.options.length;
  const hadOptions = useRef(optionCount);
  const chose = useRef(false);
  useEffect(() => {
    const before = hadOptions.current;
    hadOptions.current = optionCount;
    // Never over another notice (an «Ignorar» that made the plan fit keeps its «Deshacer»).
    if (before > 0 && optionCount === 0 && !chose.current && plan.feasible && !toast.current) {
      toast.show(OPTIONS_GONE);
    }
    if (optionCount === 0) chose.current = false;
  }, [optionCount, plan.feasible, toast]);
  const late = lateNight(data, now);
  const classes = newClassTitles(data);
  const unassigned = unassignedTasks(data);
  const unsorted = unsortedActivities(data);
  const misfits = preferenceMisfits(data);
  // Only decisions something can still be undone in (free-time ones never had tasks),
  // from the last week: older ones are archived. One about a routine holds for its week
  // only, so it goes when that week ends.
  const applied = (data.applied ?? []).filter((d) => {
    if (d.at <= now - DECISIONS_SHOWN_MS) return false;
    const weeks = Object.values(d.skipUntil ?? {});
    if (weeks.length > 0 && weeks.every((until) => until <= now)) return false;
    return d.before.length === 0 || undoable(data, d).length > 0;
  });
  const empty =
    inboxCards({
      data,
      now,
      pending,
      unlocated,
      pinShort,
      clashes,
      missedMeals,
      asked: { choose: decisions.hasOptions, recommendations: decisions.recommendations },
    }).length === 0;

  // Addresses being timed now, and the most there were at once: «Calculando traslados 3 de 8».
  const looking = offline ? 0 : unlocated.filter((u) => u.lookup).length;
  // Adjusting state while rendering settles at once: `seen` catches up with `lookTotal`.
  const [seen, setSeen] = useState(0);
  const lookTotal = looking === 0 ? 0 : Math.max(seen, looking);
  if (lookTotal !== seen) setSeen(lookTotal);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keepFocus = useKeepFocus(listRef, titleRef);

  // «Deshacer» on the notice of an answer brings its card back; the notice that held the
  // focus is gone then, so the card (or the title) takes it instead of <body>.
  const [restored, setRestored] = useState<string | null>(null);
  useEffect(() => {
    if (restored === null) return;
    setRestored(null);
    const card = listRef.current?.querySelector<HTMLElement>(`[data-block-id="${restored}"]`);
    (card?.querySelector<HTMLElement>("button") ?? titleRef.current)?.focus();
  }, [restored]);

  // Answers that are taken at the tap and offer «Deshacer»; undoing gives the focus back.
  const answers = useInboxAnswers(setRestored);

  // The list reflows after each answer: a second tap right after lands on the next item.
  const lastAnswer = useRef(0);
  const answer = useCheckIn(setRestored);
  // The card that is asking which parts were done (tasks with parts only, SPEC §3).
  const [choosing, setChoosing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const pendingParts = (b: PlanBlock) =>
    data.tasks.find((t) => t.id === b.taskId)?.units.filter((u) => !u.doneAt) ?? [];
  const quick = (b: PlanBlock, status: "done" | "missed") => {
    if (Date.now() - lastAnswer.current < ANSWER_GUARD_MS) return;
    lastAnswer.current = Date.now();
    buzz();
    if (status === "done" && pendingParts(b).length > 0) {
      setPicked([]);
      setChoosing(b.id);
      return;
    }
    answer(b, status);
  };
  const confirmParts = (b: PlanBlock) => {
    setChoosing(null);
    answer(b, "done", { unitIds: picked });
  };

  return (
    <div className="screen">
      <div className="header">
        <h1 ref={titleRef} tabIndex={-1}>
          Bandeja
        </h1>
      </div>
      <div
        className="scroll"
        ref={listRef}
        onClickCapture={keepFocus}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) keepFocus(e);
        }}
      >
        {empty && (
          // An empty screen says what goes here and where to go next (SPEC §14).
          <div className="empty">
            <p>Todo al día ✓</p>
            <p className="meta">
              Acá aparece lo que necesita una decisión tuya: eventos para mover, comidas sin lugar y
              cómo te fue.
            </p>
            {onWeek && (
              <button type="button" className="btn" onClick={onWeek}>
                Ver mi semana
              </button>
            )}
          </div>
        )}

        {moves.length > 0 && <div className="section-title">Para mover en tu calendario</div>}
        {moves.map((m) => (
          <div key={m.eventId} className="card">
            <div className="title">{m.event.title}</div>
            <p className="meta">
              Planifico con este evento el {dayAndTime(tz, m.start)}: movelo en tu calendario (de
              {` ${dayAndTime(tz, m.from)}`}). Cuando lo muevas, esto desaparece solo.
            </p>
            <button
              type="button"
              className="btn small"
              onClick={() => dispatch({ type: "unmoveEvent", eventId: m.eventId })}
            >
              Volver a su horario
            </button>
          </div>
        ))}
        {late && <LateNightCard key={`${late.date}@${late.assumedWake}`} late={late} />}

        {unlocated.length > 0 && <div className="section-title">¿Dónde es?</div>}
        {unlocated.map((u) =>
          // Offline it cannot be timed yet: the user may answer meanwhile.
          u.lookup && !offline ? (
            <div key={u.key} className="card">
              <div className="title">{u.event.title}</div>
              <p className="meta">Calculando el traslado a «{u.event.location}»…</p>
              {lookTotal > 1 && (
                <Loading
                  kind="travel"
                  inline
                  progress={{ done: lookTotal - looking, total: lookTotal }}
                />
              )}
            </div>
          ) : (
            <WhereCard key={u.key} item={u} later={u.lookup} />
          ),
        )}

        {classes.length > 0 && <div className="section-title">Clases nuevas en tu calendario</div>}
        {classes.map((c) => (
          <div key={c.key} className="card" data-block-id={c.key}>
            <div className="title">{c.title}</div>
            <p className="meta">
              {dayAndTime(tz, c.event.start)} · ¿es una materia o un evento suelto (una charla, un
              trámite)?
            </p>
            <div className="row">
              <button
                type="button"
                className="btn small"
                onClick={() => answers.classAs(c, "materia")}
              >
                Es una materia
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => answers.classAs(c, "event")}
              >
                Evento suelto
              </button>
            </div>
            <SubjectSearch
              label={`Otra clase de una materia: ${c.title}`}
              onPick={(a) => dispatch({ type: "classOf", title: c.title, activityId: a.id })}
            />
          </div>
        ))}

        {unassigned.length > 0 && <div className="section-title">¿De qué materia es?</div>}
        {unassigned.map((t) => (
          <div key={t.id} className="card">
            <div className="title">{t.title}</div>
            <p className="meta">
              {t.deadline ? `${dayAndTime(tz, t.deadline)} · ` : ""}se planifica igual mientras
              tanto
            </p>
            <SubjectSearch
              label={`Materia de ${t.title}`}
              onPick={(a) => dispatch({ type: "assignSubject", taskId: t.id, activityId: a.id })}
            />
            <button
              type="button"
              className="btn small"
              onClick={() =>
                dispatch({ type: "newSubject", name: subjectName(t.title), taskId: t.id })
              }
            >
              Nueva materia: {subjectName(t.title)}
            </button>
          </div>
        ))}

        {unsorted.length > 0 && <div className="section-title">Ordenar tus actividades</div>}
        {unsorted.map((a) => (
          <div
            key={a.id}
            className="card"
            data-block-id={a.id}
            style={{ ["--c" as string]: a.color }}
          >
            <div className="title">{a.name}</div>
            <p className="meta">
              ¿Es una materia, una rutina (como el gimnasio) o parte de otra materia (una de sus
              entregas)?
            </p>
            <div className="row">
              <button
                type="button"
                className="btn small"
                onClick={() => answers.sort(a, "materia")}
              >
                Materia
              </button>
              <button type="button" className="btn small" onClick={() => answers.sort(a, "rutina")}>
                Rutina
              </button>
            </div>
            <SubjectSearch
              label={`Juntar ${a.name} con una materia`}
              exclude={a.id}
              onPick={(m) => answers.merge(a, m)}
            />
          </div>
        ))}

        {review.length > 0 && <div className="section-title">Detectado en tu calendario</div>}
        {review.map((t) => (
          <div
            key={t.id}
            className="card"
            data-block-id={t.id}
            style={{ ["--c" as string]: data.activities.find((a) => a.id === t.activityId)?.color }}
          >
            <div className="title">{t.title}</div>
            <p className="meta">
              {data.activities.find((a) => a.id === t.activityId)?.name} ·{" "}
              {t.deadline ? dayAndTime(tz, t.deadline) : ""} · le planifico{" "}
              {hours(t.estimateMinutes)} (mínimo {hours(t.minMinutes)})
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={() => answers.ignore(t)}>
                Ignorar
              </button>
              <button type="button" className="btn" onClick={() => setEditing(t)}>
                Ajustar
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => dispatch({ type: "review", taskId: t.id, keep: true })}
              >
                Planificar así
              </button>
            </div>
          </div>
        ))}

        {misfits.length > 0 && <div className="section-title">Franja de rutina</div>}
        {misfits.map((m) => (
          <div
            key={m.activity.id}
            className="card"
            data-block-id={m.activity.id}
            style={{ ["--c" as string]: m.activity.color }}
          >
            <div className="title">{m.activity.name}</div>
            <p className="meta">
              Preferís {hoursRange(m.preferred)}, pero solo puede ir {m.allowed}.
            </p>
            {onRoutine && (
              <button type="button" className="btn small" onClick={() => onRoutine(m.activity.id)}>
                Editar rutina
              </button>
            )}
          </div>
        ))}

        {data.proposals.length > 0 && <div className="section-title">Cambios para hoy</div>}
        {data.proposals.map((p) => (
          <div key={p.id} className="card" data-block-id={p.id}>
            <div className="title">{p.message}</div>
            <ProposalToday
              text={p.plan
                .filter((b) => b.start >= now && b.start < endOfDay(tz, now))
                .map((b) => `${titleOf(b)} ${time(tz, b.start)}`)
                .join(" · ")}
            />
            <div className="row">
              <button type="button" className="btn" onClick={() => answers.reject(p)}>
                Dejar como está
              </button>
              <button type="button" className="btn primary" onClick={() => answers.accept(p)}>
                Reacomodar
              </button>
            </div>
          </div>
        ))}

        {clashes.length > 0 && <div className="section-title">Fijados que chocan</div>}
        {clashes.map(({ pin, event, moveTo }) => (
          <div key={pin.id} className="card" style={{ ["--c" as string]: "var(--warn)" }}>
            <div className="title">
              <Marks.pinned /> {titleOf(pin)} · {dayAndTime(tz, pin.start)}
            </div>
            <p className="meta">
              {moveTo
                ? `Está sobre ${event.title}, que se puede mover. ¿Lo paso al ${dayAndTime(tz, moveTo.start)}?`
                : `Choca con ${event.title}. Lo dejé donde lo pusiste; movelo o soltalo.`}
            </p>
            <div className="row">
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: "unpin", blockId: pin.id })}
              >
                Soltar (que el plan decida)
              </button>
              {moveTo && (
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => dispatch({ type: "moveEvent", eventId: event.id, ...moveTo })}
                >
                  Mover {event.title}
                </button>
              )}
            </div>
          </div>
        ))}

        {pinShort.short.length > 0 && (
          <>
            <div className="section-title">Lo que fijaste no te deja llegar</div>
            <div className="card" style={{ ["--c" as string]: "var(--critical)" }}>
              <p className="meta">
                Con los bloques fijados faltan{" "}
                {pinShort.short
                  .map(
                    (s) =>
                      `${hours(s.minutes)} de ${data.tasks.find((t) => t.id === s.taskId)?.title ?? "una tarea"}`,
                  )
                  .join(", ")}
                . Movelos o soltá alguno para que el plan lo acomode.
              </p>
              {pinShort.pins.map((pin) => (
                <div key={pin.id} className="check">
                  <span style={{ flex: 1 }}>
                    <Marks.pinned /> {titleOf(pin)} · {dayAndTime(tz, pin.start)}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => dispatch({ type: "unpin", blockId: pin.id })}
                  >
                    Soltar
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {missedMeals.length > 0 && <div className="section-title">Comidas sin lugar</div>}
        {missedMeals.map((m) => (
          <div
            key={`${m.date}-${m.kind ?? m.preferred.start}`}
            className="card"
            style={{ ["--c" as string]: "var(--meal)" }}
          >
            <div className="title">
              Sin lugar para {m.kind ? EAT[m.kind] : "comer"} · {dayDate(tz, m.preferred.start)}
            </div>
            <RoyLine anim="puente">{mealNoRoom(time(tz, (m.at ?? m.preferred).start))}</RoyLine>
            {onDay && (
              <button type="button" className="btn small" onClick={() => onDay(m.date)}>
                Ver el día
              </button>
            )}
          </div>
        ))}

        {decisions.options.length > 0 && (
          <>
            <div className="section-title">No llegás a todo · elegí</div>
            {noFits.map((t) => (
              <div key={t.id} className="card" style={{ ["--c" as string]: "var(--warn)" }}>
                <div className="title">«{t.title}» no entra</div>
                <RoyLine anim="hombros" size={ELEGI_ROY} uniform>
                  {noFit(t.title, noFitKind(t, data.activities, data.settings.slotMinutes))}
                </RoyLine>
              </div>
            ))}
            {decisions.options.map((o) => (
              <div
                key={o.id}
                className="card"
                style={{ ["--c" as string]: o.result.feasible ? "var(--ok)" : "var(--warn)" }}
              >
                <div className="title">{o.label}</div>
                <RoyLine anim={OPTION_POSE[o.kind]} size={ELEGI_ROY} uniform>
                  {optionLine(
                    o,
                    plan.feasible,
                    // What fits nowhere stays short whatever the option: say so, not «llegás».
                    onlyImpossibleLeft(o, decisions.impossible)
                      ? noFits
                          .filter((t) => o.result.status.some((s) => s.taskId === t.id))
                          .map((t) => t.title)
                      : null,
                  )}
                </RoyLine>
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Elegir: ${o.label}`}
                  onClick={() => {
                    chose.current = true;
                    // The decision is recorded as it is made: «Deshacer» takes that one back.
                    let made: string | undefined;
                    dispatch({ type: "applyOption", optionId: o.id }, (after) => {
                      made = (after.applied ?? [])
                        .filter((d) => d.id.startsWith(`${o.id}@`))
                        .at(-1)?.id;
                    });
                    toast.show(REPLANNED_TOAST, {
                      roy: "festejo",
                      undo: () => {
                        if (made) dispatch({ type: "undoDecision", id: made });
                      },
                    });
                  }}
                >
                  Elegir
                </button>
              </div>
            ))}
          </>
        )}

        {decisions.recommendations.map((r) => (
          <div
            key={r.id}
            className="card"
            data-focus-title
            style={{ ["--c" as string]: "var(--warn)" }}
          >
            <div className="title">Sugerencia</div>
            <p className="meta">{r.message}</p>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                dispatch({ type: "relaxContext", until: endOfDay(tz, now) });
                toast.show("Hoy se mezclan más materias.", {
                  undo: () => dispatch({ type: "undoPlan" }),
                });
              }}
            >
              Hacelo por hoy
            </button>
          </div>
        ))}

        {applied.length > 0 && <div className="section-title">Decisiones que tomaste</div>}
        {applied.map((d) => (
          <div key={d.id} className="card">
            <div className="title">{d.label}</div>
            <p className="meta">{dayAndTime(tz, d.at)}</p>
            <button
              type="button"
              className="btn small"
              aria-label={`Deshacer: ${d.label}`}
              onClick={() => {
                dispatch({ type: "undoDecision", id: d.id });
                toast.show(`Deshecho: ${clipName(d.label, 60)}`);
              }}
            >
              Deshacer
            </button>
          </div>
        ))}

        {pending.length > 0 && <div className="section-title">¿Cómo te fue?</div>}
        {pending.map((b) => (
          <div
            key={b.id}
            className="card swipeable"
            data-block-id={b.id}
            style={{ ["--c" as string]: colorOf(b) }}
            {...swipeAnswer((status) => quick(b, status))}
          >
            <button
              type="button"
              className="title"
              onClick={() => setOpen(b)}
              style={{ textAlign: "left" }}
            >
              {titleOf(b)} ›
            </button>
            <p className="meta">
              {dayAndTime(tz, b.start)} – {time(tz, b.end)} · {hours((b.end - b.start) / MINUTE)}
            </p>
            {choosing === b.id ? (
              <>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {pendingParts(b).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={`chip${picked.includes(u.id) ? " on" : ""}`}
                      style={{
                        flex: "1 1 45%",
                        height: "auto",
                        minHeight: 36,
                        padding: "6px 12px",
                      }}
                      aria-pressed={picked.includes(u.id)}
                      onClick={() =>
                        setPicked(
                          picked.includes(u.id)
                            ? picked.filter((x) => x !== u.id)
                            : [...picked, u.id],
                        )
                      }
                    >
                      {u.title}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button type="button" className="btn" onClick={() => setChoosing(null)}>
                    Volver
                  </button>
                  <button type="button" className="btn primary" onClick={() => confirmParts(b)}>
                    Anotar hecho
                  </button>
                </div>
              </>
            ) : (
              <div className="row">
                <button
                  type="button"
                  className="btn done"
                  aria-label={`Hecho: ${titleOf(b)}, ${dayAndTime(tz, b.start)}`}
                  onClick={() => quick(b, "done")}
                >
                  <Marks.done />
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`Hice una parte: ${titleOf(b)}, ${dayAndTime(tz, b.start)}`}
                  onClick={() => setOpen(b)}
                >
                  <Marks.partial />
                </button>
                <button
                  type="button"
                  className="btn missed"
                  aria-label={`No hecho: ${titleOf(b)}, ${dayAndTime(tz, b.start)}`}
                  onClick={() => quick(b, "missed")}
                >
                  <Marks.missed />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <TaskEditor
          origin="inbox"
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => dispatch({ type: "review", taskId: t.id, keep: true })}
        />
      )}
      {open && (
        <BlockSheet
          item={{ kind: "block", id: open.id, start: open.start, end: open.end, block: open }}
          onUndone={setRestored}
          onClose={() => {
            keepFocus.rearm();
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Where an event happens, when its address could not be timed: a saved place (found by
 * typing), minutes from home typed here (optionally saved as a new place), or no trip.
 */
function WhereCard({
  item,
  later,
}: {
  item: ReturnType<typeof useStore>["unlocated"][number];
  /** Not timed yet only for lack of connection: it will be, unless answered here. */
  later?: boolean;
}) {
  const { data, dispatch } = useStore();
  const undoable = useUndoable();
  const tz = data.settings.timezone;
  const [minutes, setMinutes] = useState("");
  // An id without spaces: «Instituto Anglo» would split aria-describedby in two.
  const helpId = useId();
  const [save, setSave] = useState(false);
  const [name, setName] = useState("");
  const failed = spotFor(data, item.event.location)?.failed;
  // «12,5» and «12.5» are both 13 minutes.
  const typed = Math.round(Number(minutes.replace(",", ".")));
  const valid = /^\s*\d+(?:[.,]\d+)?\s*$/.test(minutes) && typed <= 1440;
  const takenId = `${helpId}-taken`;
  const taken = save && nameTaken(data.places ?? [], name);
  const blank = save && isBlank(name);
  const canUse = valid && !(blank || taken);
  // «Usar» is off for lack of a name: say so once the name was touched or the minutes are there.
  const nameMissing = blank && (name !== "" || valid);
  const use = () => {
    if (!canUse) return;
    undoable(
      save ? `«${name.trim()}» guardado como lugar` : `${typed} min para «${item.event.title}»`,
      save
        ? [
            { type: "spotMinutes", text: item.text, minutes: typed },
            { type: "saveSpot", key: spotKey(item.text), name },
          ]
        : { type: "spotMinutes", text: item.text, minutes: typed },
      [...PLAN_KEYS, "spots", "places", "travelTimes"],
    );
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    use();
  };
  return (
    <div className="card">
      <div className="title">{item.event.title}</div>
      <p className="meta">
        {dayAndTime(tz, item.event.start)}
        {item.event.location
          ? ` · ${item.event.location.length > 120 ? `${item.event.location.slice(0, 120)}…` : item.event.location}`
          : " · sin ubicación"}
        {failed ? " · no encontré esa dirección" : ""}
        {later ? " · sin conexión: lo calculo al volver, o respondé acá" : ""}
      </p>
      <PlaceSearch
        label={`Lugar de ${item.event.title}`}
        onPick={(place) => dispatch({ type: "locate", text: item.text, placeId: place.id })}
      />
      <div className="row fields">
        <label className="field" style={{ flex: 1, marginBottom: 0 }}>
          <span>O minutos desde casa</span>
          <input
            type="text"
            inputMode="decimal"
            value={minutes}
            aria-label={`O minutos desde casa para ${item.event.title.slice(0, 40)}`}
            onKeyDown={onEnter}
            aria-invalid={minutes.trim() !== "" && !valid ? true : undefined}
            aria-describedby={helpId}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <button type="button" className="btn small" disabled={!canUse} onClick={use}>
          Usar
        </button>
      </div>
      <p
        className="meta"
        id={helpId}
        role={minutes.trim() !== "" && !valid ? "alert" : undefined}
        style={minutes.trim() !== "" && !valid ? { color: "var(--critical)" } : undefined}
      >
        {minutes.trim() !== "" && !valid
          ? "Poné minutos de 0 a 1440, solo cifras (12,5 se guarda como 13)."
          : "Minutos de 0 a 1440; con coma o punto se redondea."}
      </p>
      <label className="check">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        <span>Guardar como lugar</span>
      </label>
      {save && (
        <label className="field">
          <span>Nombre del lugar</span>
          <input
            // Ticking «Guardar como lugar» goes straight to typing the name.
            ref={(el) => el?.focus()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
            aria-invalid={taken || nameMissing ? true : undefined}
            aria-describedby={taken || nameMissing ? takenId : undefined}
            placeholder="Casa de Clara"
          />
          {taken && (
            <span className="meta" id={takenId} role="alert" style={{ color: "var(--critical)" }}>
              Ya tenés un lugar con ese nombre.
            </span>
          )}
        </label>
      )}
      {nameMissing && (
        // Outside the label: the field keeps its name.
        <p className="meta" id={takenId} role="alert" style={{ color: "var(--critical)" }}>
          Poné un nombre para el lugar.
        </p>
      )}
      <button
        type="button"
        className="btn small"
        onClick={() =>
          undoable(
            "Sin traslado para este evento",
            { type: "locate", text: item.text, placeId: null },
            [...PLAN_KEYS, "noTravel", "spots"],
          )
        }
      >
        No hace falta traslado
      </button>
    </div>
  );
}

/** After a late night: when did you get up? Until answered the plan assumes your usual sleep. */
function LateNightCard({ late }: { late: NonNullable<ReturnType<typeof lateNight>> }) {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [wake, setWake] = useState(minutesToHhmm(late.assumedWake));
  const [problem, setProblem] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="card">
      <div className="title">¿A qué hora te levantaste?</div>
      <p className="meta">
        Anoche «{late.event.title}» terminó a las {time(tz, late.event.end)}. Mientras tanto
        planifico como si hubieras dormido tus horas de siempre.
      </p>
      <div className="row fields">
        <label className="field" style={{ flex: 1, marginBottom: 0 }}>
          <span>Me levanté a las</span>
          <input
            type="time"
            value={wake}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            onChange={(e) => {
              setWake(e.target.value);
              setProblem(null);
            }}
          />
        </label>
        <button
          type="button"
          className="btn small"
          disabled={!wake}
          onClick={() => {
            // Like Ajustes → Hoy: the card asks about today, so it cannot be later than now.
            const woke = parseClock(wake);
            if (woke !== null && woke > localParts(tz, now).minuteOfDay) {
              setProblem(`Todavía no son las ${minutesToHhmm(woke)}.`);
              return;
            }
            const own = data.overrides.find((o) => o.date === late.date);
            dispatch({
              type: "override",
              override: { ...own, date: late.date, wake: hhmmToMinutes(wake) },
            });
          }}
        >
          Guardar hora
        </button>
      </div>
      <Problem id={errorId} text={problem} />
    </div>
  );
}
