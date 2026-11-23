import { useRef } from "react";
import { zonedInstant } from "../engine.js";
import { dayAndTime, dayDate, hours, weekdayLong } from "../format.js";
import { useStore } from "../store.js";
import { weekPlan, weekToPlan } from "../week-review.js";
import { weekTypeLine } from "../weekType.js";
import { Marks } from "./icons.js";
import { useModal } from "./modal.js";

/** Sunday's five minutes: the week ahead, what is critical and what needs a decision. */
export function WeeklyPlan({ onClose, onInbox }: { onClose: () => void; onInbox: () => void }) {
  const { data, now, result, inboxCount, dispatch } = useStore();
  const tz = data.settings.timezone;
  const dates = weekToPlan(data, now);
  const days = weekPlan(data, dates);
  const from = zonedInstant(tz, dates[0] as string, 0);
  const to = zonedInstant(tz, dates[6] as string, 1440);
  const critical = data.plan
    .filter((b) => b.level === "critical" && b.start >= from && b.start < to)
    .sort((a, b) => a.start - b.start);
  // Next week's summary blames only what is due in it or later, not what falls due before.
  const short = result.status.filter(
    (s) =>
      s.minDeficit > 0 &&
      (data.tasks.find((t) => t.id === s.taskId)?.deadline ?? Number.POSITIVE_INFINITY) >= from,
  );
  const titleOf = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? "—";
  const typeLine = weekTypeLine(data);
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
          <Marks.close />
        </button>
        <h2 tabIndex={-1}>Planificación semanal</h2>
        <p className="meta">
          {/* It is always next week: say which, the screen behind shows this one. */}
          Semana del {dayDate(tz, zonedInstant(tz, dates[0] as string, 720))} al{" "}
          {dayDate(tz, zonedInstant(tz, dates[6] as string, 720))} ·{" "}
          {hours(days.reduce((s, d) => s + d.minutes, 0))} planificadas · {critical.length} bloques
          críticos
        </p>

        {typeLine && (
          <p className="meta" data-testid="week-type" style={{ overflowWrap: "anywhere" }}>
            {typeLine}
          </p>
        )}

        <div className="week-bars">
          {days.map((d) => (
            <div key={d.date} className="week-bar" title={d.holiday}>
              <div className="bar">
                <div
                  className={d.critical ? "fill critical" : "fill"}
                  style={{ height: `${(d.minutes / max) * 100}%` }}
                />
              </div>
              {/* With big text the three letters do not fit: the initial shows, the name stays whole. */}
              <span
                className="week-day"
                role="img"
                aria-label={weekdayLong(tz, zonedInstant(tz, d.date, 720))}
              >
                <span className="day-short">
                  {dayDate(tz, zonedInstant(tz, d.date, 720)).split(" ")[0]}
                </span>
                <span className="day-initial">
                  {weekdayLong(tz, zonedInstant(tz, d.date, 720))
                    .charAt(0)
                    .toUpperCase()}
                </span>
              </span>
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
          <p className="meta">
            {short.length > 0
              ? "Ningún bloque crítico esta semana, pero revisá lo que no llega al mínimo."
              : "Ninguno: hay margen en todo. 🟢"}
          </p>
        ) : (
          critical.map((b) => (
            <p key={b.id} className="meta">
              🔴 {dayAndTime(tz, b.start)} · {titleOf(b.taskId)} (
              {hours((b.end - b.start) / 60_000)})
            </p>
          ))
        )}

        {inboxCount > 0 && (
          // The same total as the badge of the Bandeja tab.
          <>
            <p className="meta">
              Lo de la Bandeja es de esta semana; el resumen de arriba es solo de la semana próxima.
            </p>
            <button type="button" className="btn" style={{ width: "100%" }} onClick={onInbox}>
              Ver la Bandeja ({inboxCount})
            </button>
          </>
        )}
        <button
          type="button"
          className="btn primary"
          style={{ width: "100%" }}
          onClick={() => {
            // Planned: from now on silos and widget show this week.
            if (data.settings.weekPlannedFor !== dates[0])
              dispatch({
                type: "settings",
                settings: { ...data.settings, weekPlannedFor: dates[0] },
              });
            onClose();
          }}
        >
          Cerrar resumen
        </button>
      </div>
    </>
  );
}
