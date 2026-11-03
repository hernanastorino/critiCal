import { MINUTE, type PlanBlock } from "@critical/engine";
import { useState } from "react";
import { dayAndTime, hours, time } from "../format";
import type { AppTask } from "../model";
import { endOfDay, pinClashes } from "../planning";
import { useStore } from "../store";
import { BlockSheet } from "./BlockSheet";
import { TaskEditor } from "./TaskEditor";

export function Inbox() {
  const { data, now, pending, decisions, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [open, setOpen] = useState<PlanBlock | null>(null);
  const [editing, setEditing] = useState<AppTask | null>(null);
  const titleOf = (b: PlanBlock) => data.tasks.find((t) => t.id === b.taskId)?.title ?? "Bloque";
  const colorOf = (b: PlanBlock) => data.activities.find((a) => a.id === b.activityId)?.color;
  const review = data.tasks.filter((t) => t.needsReview && t.status === "active");
  const clashes = pinClashes(data, now);
  const empty =
    pending.length +
      clashes.length +
      data.proposals.length +
      decisions.options.length +
      decisions.recommendations.length +
      review.length ===
    0;

  const quick = (b: PlanBlock, status: "done" | "missed") =>
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

  return (
    <div className="screen">
      <div className="header">
        <h1>Bandeja</h1>
      </div>
      <div className="scroll">
        {empty && <p className="empty">Todo al día ✓</p>}

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
            <p className="meta">
              {p.plan
                .filter((b) => b.start >= now && b.start < endOfDay(tz, now))
                .map((b) => `${titleOf(b)} ${time(tz, b.start)}`)
                .join(" · ") || "Hoy queda libre"}
            </p>
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
                onClick={() => dispatch({ type: "acceptProposal", id: p.id })}
              >
                Reacomodar
              </button>
            </div>
          </div>
        ))}

        {clashes.length > 0 && <div className="section-title">Fijados que chocan</div>}
        {clashes.map(({ pin, event }) => (
          <div key={pin.id} className="card" style={{ ["--c" as string]: "var(--warn)" }}>
            <div className="title">
              📌 {titleOf(pin)} · {dayAndTime(tz, pin.start)}
            </div>
            <p className="meta">
              Choca con {event.title}. Lo dejé donde lo pusiste; movelo o soltalo.
            </p>
            <button
              type="button"
              className="btn small"
              onClick={() => dispatch({ type: "unpin", blockId: pin.id })}
            >
              Soltar (que el plan decida)
            </button>
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
                <p className="meta">
                  {o.result.feasible
                    ? "Con esto llegás a todos los mínimos."
                    : "Todavía faltaría tiempo."}
                </p>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => dispatch({ type: "applyOption", optionId: o.id })}
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

        {(data.applied ?? []).length > 0 && (
          <div className="section-title">Decisiones que tomaste</div>
        )}
        {(data.applied ?? []).map((d) => (
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
              <button type="button" className="btn" onClick={() => setOpen(b)}>
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
