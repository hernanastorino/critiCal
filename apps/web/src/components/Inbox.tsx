import { useId, useState } from "react";
import { useSync } from "../Connected.js";
import { subjectName } from "../calendars.js";
import { MEAL_RANGE, type MealKind, MINUTE, type PlanBlock } from "../engine.js";
import { dayAndTime, dayDate, hhmmToMinutes, hours, minutesToHhmm, time } from "../format.js";
import {
  FREE_TODAY,
  mealNoRoom,
  REPLANNED_TOAST,
  SKIPPED_TOAST,
  STILL_SHORT,
} from "../friendly.js";
import { lateNight } from "../lateNight.js";
import { type AppTask, undoable } from "../model.js";
import { nameTaken, spotFor, spotKey } from "../places.js";
import { endOfDay } from "../planning.js";
import { useStore } from "../store.js";
import { newClassTitles, unassignedTasks, unsortedActivities } from "../subjects.js";
import { BlockSheet } from "./BlockSheet.js";
import { Loading } from "./Loading.js";
import { PlaceSearch } from "./PlaceSearch.js";
import { RoyLine } from "./Roy.js";
import { SubjectSearch } from "./SubjectSearch.js";
import { TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";

const EAT: Record<MealKind, string> = {
  desayuno: "desayunar",
  almuerzo: "almorzar",
  merienda: "merendar",
  cena: "cenar",
};

/** What a plan B leaves for today: Roy rests when there is nothing left (SPEC §18.1). */
function ProposalToday({ text }: { text: string }) {
  return text ? <p className="meta">{text}</p> : <RoyLine anim="reposo">{FREE_TODAY}</RoyLine>;
}

/** The inbox: everything waiting on the user (questions, proposals, clashes, options). */
export function Inbox({ onDay }: { onDay?: (date: string) => void }) {
  const { data, now, pending, decisions, unlocated, pinShort, clashes, missedMeals, dispatch } =
    useStore();
  const offline = !!useSync()?.status.offline;
  const toast = useToast();
  const tz = data.settings.timezone;
  const [open, setOpen] = useState<PlanBlock | null>(null);
  const [editing, setEditing] = useState<AppTask | null>(null);
  const titleOf = (b: PlanBlock) => data.tasks.find((t) => t.id === b.taskId)?.title ?? "Bloque";
  const colorOf = (b: PlanBlock) => data.activities.find((a) => a.id === b.activityId)?.color;
  const review = data.tasks.filter((t) => t.needsReview && t.status === "active");
  const moves = (data.movedEvents ?? []).flatMap((m) => {
    const event = data.events.find((e) => e.id === m.eventId);
    return event ? [{ ...m, event }] : [];
  });
  const late = lateNight(data, now);
  const classes = newClassTitles(data);
  const unassigned = unassignedTasks(data);
  const unsorted = unsortedActivities(data);
  // Only decisions something can still be undone in (free-time ones never had tasks).
  const applied = (data.applied ?? []).filter(
    (d) => d.before.length === 0 || undoable(data, d).length > 0,
  );
  const empty =
    unlocated.length +
      pending.length +
      clashes.length +
      pinShort.short.length +
      missedMeals.length +
      data.proposals.length +
      decisions.options.length +
      decisions.recommendations.length +
      review.length +
      moves.length +
      (late ? 1 : 0) +
      classes.length +
      unassigned.length +
      unsorted.length ===
    0;

  // Addresses being timed now, and the most there were at once: «Calculando traslados 3 de 8».
  const looking = offline ? 0 : unlocated.filter((u) => u.lookup).length;
  // Adjusting state while rendering settles at once: `seen` catches up with `lookTotal`.
  const [seen, setSeen] = useState(0);
  const lookTotal = looking === 0 ? 0 : Math.max(seen, looking);
  if (lookTotal !== seen) setSeen(lookTotal);

  const quick = (b: PlanBlock, status: "done" | "missed") => {
    dispatch({
      type: "checkIn",
      checkIn: {
        blockId: b.id,
        taskId: b.taskId,
        status,
        minutesDone: status === "done" ? (b.end - b.start) / MINUTE : 0,
        unitIds: [],
      },
    });
    if (status === "missed") toast.show(SKIPPED_TOAST, { roy: "hombros" });
  };

  return (
    <div className="screen">
      <div className="header">
        <h1>Bandeja</h1>
      </div>
      <div className="scroll">
        {empty && <p className="empty">Todo al día ✓</p>}

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
          <div key={c.key} className="card">
            <div className="title">{c.title}</div>
            <p className="meta">
              {dayAndTime(tz, c.event.start)} · ¿es una materia o un evento suelto (una charla, un
              trámite)?
            </p>
            <div className="row">
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: "classTitle", title: c.title, as: "materia" })}
              >
                Es una materia
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: "classTitle", title: c.title, as: "event" })}
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
          <div key={a.id} className="card" style={{ ["--c" as string]: a.color }}>
            <div className="title">{a.name}</div>
            <p className="meta">
              ¿Es una materia, una rutina (como el gimnasio) o parte de otra materia (una de sus
              entregas)?
            </p>
            <div className="row">
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: "sortActivity", activityId: a.id, as: "materia" })}
              >
                Materia
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: "sortActivity", activityId: a.id, as: "rutina" })}
              >
                Rutina
              </button>
            </div>
            <SubjectSearch
              label={`Juntar ${a.name} con una materia`}
              exclude={a.id}
              onPick={(m) => dispatch({ type: "mergeActivity", activityId: a.id, into: m.id })}
            />
          </div>
        ))}

        {review.length > 0 && <div className="section-title">Detectado en tu calendario</div>}
        {review.map((t) => (
          <div
            key={t.id}
            className="card"
            style={{ ["--c" as string]: data.activities.find((a) => a.id === t.activityId)?.color }}
          >
            <div className="title">{t.title}</div>
            <p className="meta">
              {data.activities.find((a) => a.id === t.activityId)?.name} ·{" "}
              {t.deadline ? dayAndTime(tz, t.deadline) : ""} · le planifico{" "}
              {hours(t.estimateMinutes)} (mínimo {hours(t.minMinutes)})
            </p>
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: "review", taskId: t.id, keep: false })}
              >
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
                OK
              </button>
            </div>
          </div>
        ))}

        {data.proposals.length > 0 && <div className="section-title">Cambios para hoy</div>}
        {data.proposals.map((p) => (
          <div key={p.id} className="card">
            <div className="title">{p.message}</div>
            <ProposalToday
              text={p.plan
                .filter((b) => b.start >= now && b.start < endOfDay(tz, now))
                .map((b) => `${titleOf(b)} ${time(tz, b.start)}`)
                .join(" · ")}
            />
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: "rejectProposal", id: p.id })}
              >
                Dejar como está
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  dispatch({ type: "acceptProposal", id: p.id });
                  toast.show(REPLANNED_TOAST, { roy: "festejo" });
                }}
              >
                Reacomodar
              </button>
            </div>
          </div>
        ))}

        {clashes.length > 0 && <div className="section-title">Fijados que chocan</div>}
        {clashes.map(({ pin, event, moveTo }) => (
          <div key={pin.id} className="card" style={{ ["--c" as string]: "var(--warn)" }}>
            <div className="title">
              📌 {titleOf(pin)} · {dayAndTime(tz, pin.start)}
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
                    📌 {titleOf(pin)} · {dayAndTime(tz, pin.start)}
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
            <RoyLine anim="puente">
              {mealNoRoom(
                time(tz, m.preferred.start - MEAL_RANGE),
                time(tz, m.preferred.end + MEAL_RANGE),
                time(tz, (m.at ?? m.preferred).start),
              )}
            </RoyLine>
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
            {decisions.options.map((o) => (
              <div
                key={o.id}
                className="card"
                style={{ ["--c" as string]: o.result.feasible ? "var(--ok)" : "var(--warn)" }}
              >
                <div className="title">{o.label}</div>
                <RoyLine anim="puente">
                  {o.result.feasible ? "Con esto llegás a todos los mínimos." : STILL_SHORT}
                </RoyLine>
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Elegir: ${o.label}`}
                  onClick={() => {
                    dispatch({ type: "applyOption", optionId: o.id });
                    toast.show(REPLANNED_TOAST, { roy: "festejo" });
                  }}
                >
                  Elegir
                </button>
              </div>
            ))}
          </>
        )}

        {decisions.recommendations.map((r) => (
          <div key={r.id} className="card" style={{ ["--c" as string]: "var(--warn)" }}>
            <div className="title">Sugerencia</div>
            <p className="meta">{r.message}</p>
            <button
              type="button"
              className="btn small"
              onClick={() => dispatch({ type: "relaxContext", until: endOfDay(tz, now) })}
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
              onClick={() => dispatch({ type: "undoDecision", id: d.id })}
            >
              Deshacer
            </button>
          </div>
        ))}

        {pending.length > 0 && <div className="section-title">¿Cómo te fue?</div>}
        {pending.map((b) => (
          <div key={b.id} className="card" style={{ ["--c" as string]: colorOf(b) }}>
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
            <div className="row">
              <button
                type="button"
                className="btn done"
                aria-label={`Hecho: ${titleOf(b)}`}
                onClick={() => quick(b, "done")}
              >
                ✓
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Parcial u otro resultado: ${titleOf(b)}`}
                onClick={() => setOpen(b)}
              >
                ◐
              </button>
              <button
                type="button"
                className="btn missed"
                aria-label={`No hecho: ${titleOf(b)}`}
                onClick={() => quick(b, "missed")}
              >
                ✗
              </button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <TaskEditor
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => dispatch({ type: "review", taskId: t.id, keep: true })}
        />
      )}
      {open && (
        <BlockSheet
          item={{ kind: "block", id: open.id, start: open.start, end: open.end, block: open }}
          onClose={() => setOpen(null)}
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
  const canUse = valid && !(save && (!name.trim() || taken));
  const use = () => {
    if (!canUse) return;
    dispatch({ type: "spotMinutes", text: item.text, minutes: typed });
    if (save) dispatch({ type: "saveSpot", key: spotKey(item.text), name });
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
            aria-invalid={taken ? true : undefined}
            aria-describedby={taken ? takenId : undefined}
            placeholder="Casa de Clara"
          />
          {taken && (
            <span className="meta" id={takenId} role="alert" style={{ color: "var(--critical)" }}>
              Ya tenés un lugar con ese nombre.
            </span>
          )}
        </label>
      )}
      <button
        type="button"
        className="btn small"
        onClick={() => dispatch({ type: "locate", text: item.text, placeId: null })}
      >
        No hace falta traslado
      </button>
    </div>
  );
}

/** After a late night: when did you get up? Until answered the plan assumes your usual sleep. */
function LateNightCard({ late }: { late: NonNullable<ReturnType<typeof lateNight>> }) {
  const { data, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [wake, setWake] = useState(minutesToHhmm(late.assumedWake));
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
          <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn small"
          disabled={!wake}
          onClick={() => {
            const own = data.overrides.find((o) => o.date === late.date);
            dispatch({
              type: "override",
              override: { ...own, date: late.date, wake: hhmmToMinutes(wake) },
            });
          }}
        >
          Listo
        </button>
      </div>
    </div>
  );
}
