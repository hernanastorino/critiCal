import { useRef } from "react";
import { zonedInstant } from "../engine.js";
import { dayAndTime, dayDate, hours } from "../format.js";
import { useStore } from "../store.js";
import { weekPlan, weekToPlan } from "../week-review.js";
import { useModal } from "./modal.js";

/** Sunday's five minutes: the week ahead, what is critical and what needs a decision. */
export function WeeklyPlan({ onClose, onInbox }: { onClose: () => void; onInbox: () => void }) {
  const { data, now, result, decisions } = useStore();
  const tz = data.settings.timezone;
  const dates = weekToPlan(data, now);
  const days = weekPlan(data, dates);
  const from = zonedInstant(tz, dates[0] as string, 0);
  const to = zonedInstant(tz, dates[6] as string, 1440);
  const critical = data.plan
    .filter((b) => b.level === "critical" && b.start >= from && b.start < to)
    .sort((a, b) => a.start - b.start);
  const short = result.status.filter((s) => s.minDeficit > 0);
  const titleOf = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? "—";
  const pendingDecisions = decisions.options.length + decisions.recommendations.length;
  const max = Math.max(60, ...days.map((d) => d.minutes));
  const sheet = useRef<HTMLDivElement>(null);

  // Opened from an Ajustes row that is gone by then: focus goes back to the gear.
  const justOpened = useModal(sheet, onClose, true, () =>
    document.querySelector<HTMLElement>(
      // Without the week on screen (opened from a notification on the inbox), its tab.
      'button[aria-label="Ajustes"], nav.tabs button[aria-current="page"]',
    ),
  );

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
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Planificación semanal"
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>
        <h2 tabIndex={-1}>Planificación semanal</h2>
        <p className="meta">
          {hours(days.reduce((s, d) => s + d.minutes, 0))} planificadas · {critical.length} bloques
          críticos
        </p>

        <div className="week-bars">
          {days.map((d) => (
            <div key={d.date} className="week-bar" title={d.holiday}>
              <div className="bar">
                <div
                  className={d.critical ? "fill critical" : "fill"}
                  style={{ height: `${(d.minutes / max) * 100}%` }}
                />
              </div>
              <span>{dayDate(tz, zonedInstant(tz, d.date, 720)).split(" ")[0]}</span>
              <span className="meta" style={{ margin: 0 }}>
                {d.holiday ? "feriado" : hours(d.minutes)}
              </span>
            </div>
          ))}
        </div>

        {short.length > 0 && (
          <>
            <div className="section-title">No llega al mínimo</div>
            {short.map((s) => (
              <p key={s.taskId} className="meta">
                🔴 {titleOf(s.taskId)}: faltan {hours(s.minDeficit)} de lo mínimo
              </p>
            ))}
          </>
        )}

        <div className="section-title">Críticos de la semana</div>
        {critical.length === 0 ? (
          <p className="meta">Ninguno: hay margen en todo. 🟢</p>
        ) : (
          critical.map((b) => (
            <p key={b.id} className="meta">
              🔴 {dayAndTime(tz, b.start)} · {titleOf(b.taskId)} (
              {hours((b.end - b.start) / 60_000)})
            </p>
          ))
        )}

        {pendingDecisions > 0 && (
          <button type="button" className="btn" style={{ width: "100%" }} onClick={onInbox}>
            {pendingDecisions === 1 ? "1 decisión" : `${pendingDecisions} decisiones`} en la Bandeja
          </button>
        )}
        <button type="button" className="btn primary" style={{ width: "100%" }} onClick={onClose}>
          Listo
        </button>
      </div>
    </>
  );
}
