import { useId, useState } from "react";
import { dayAndTime, hhmmToMinutes, minutesToHhmm, time } from "../format.js";
import type { lateNight } from "../lateNight.js";
import { nameTaken, spotFor, spotKey } from "../places.js";
import { useStore } from "../store.js";
import { PlaceSearch } from "./PlaceSearch.js";

/**
 * Where an event happens, when its address could not be timed: a saved place (found by
 * typing), minutes from home typed here (optionally saved as a new place), or no trip.
 */
export function WhereCard({
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
export function LateNightCard({ late }: { late: NonNullable<ReturnType<typeof lateNight>> }) {
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
