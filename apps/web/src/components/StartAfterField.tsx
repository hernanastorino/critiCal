import { useState } from "react";
import { addDays, localParts, type StartAfter, zonedInstant } from "../engine.js";
import { dayDate } from "../format.js";

type Mode = "now" | "date" | "in" | "before";

const modeOf = (v: StartAfter | undefined): Mode => (!v ? "now" : "date" in v ? "date" : "before");

/** Whole days from 0 to a year, or undefined. */
const count = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : undefined;
};

/**
 * «Puedo empezar» (SPEC §18.7): right away, from a date, in N days (saved as that date,
 * so it does not move each day) or N days before the deadline (moves with it).
 */
export function StartAfterField({
  value,
  onChange,
  tz,
  now,
  label = "Puedo empezar",
}: {
  value: StartAfter | undefined;
  onChange: (v: StartAfter | undefined) => void;
  tz: string;
  now: number;
  label?: string;
}) {
  const today = localParts(tz, now).date;
  const [mode, setMode] = useState<Mode>(modeOf(value));
  const [date, setDate] = useState(value && "date" in value ? value.date : addDays(today, 7));
  const [days, setDays] = useState(value && "daysBefore" in value ? String(value.daysBefore) : "4");
  const [inDays, setInDays] = useState("10");
  const emit = (m: Mode, d = date, b = days, i = inDays) => {
    if (m === "now") return onChange(undefined);
    if (m === "date") return onChange(d ? { date: d } : undefined);
    const n = count(m === "before" ? b : i);
    if (n === undefined) return onChange(undefined);
    onChange(m === "before" ? { daysBefore: n } : { date: addDays(today, n) });
  };
  const inDate = count(inDays);
  return (
    <fieldset className="field start-after">
      <legend>{label}</legend>
      <select
        aria-label={label}
        value={mode}
        onChange={(e) => {
          const m = e.target.value as Mode;
          setMode(m);
          emit(m);
        }}
      >
        <option value="now">Ya</option>
        <option value="date">Desde una fecha</option>
        <option value="in">Dentro de unos días</option>
        <option value="before">Unos días antes de la entrega</option>
      </select>
      {mode === "date" && (
        <input
          type="date"
          aria-label="Desde el día"
          value={date}
          min="2000-01-01"
          onChange={(e) => {
            setDate(e.target.value);
            emit("date", e.target.value);
          }}
        />
      )}
      {mode === "in" && (
        <span className="inline">
          <span>Dentro de</span>
          <input
            inputMode="numeric"
            aria-label="Dentro de cuántos días"
            value={inDays}
            onChange={(e) => {
              setInDays(e.target.value);
              emit("in", date, days, e.target.value);
            }}
          />
          <span>
            días
            {inDate === undefined
              ? ""
              : ` (desde el ${dayDate(tz, zonedInstant(tz, addDays(today, inDate), 720))})`}
          </span>
        </span>
      )}
      {mode === "before" && (
        <span className="inline">
          <input
            inputMode="numeric"
            aria-label="Cuántos días antes de la entrega"
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              emit("before", date, e.target.value);
            }}
          />
          <span>días antes de la entrega</span>
        </span>
      )}
    </fieldset>
  );
}
