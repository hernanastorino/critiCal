import { useState } from "react";
import { addDays, localParts, type StartAfter, zonedInstant } from "../engine.js";
import { dayDate } from "../format.js";

type Mode = "inherit" | "now" | "date" | "in" | "before";

const modeOf = (v: StartAfter | undefined | null, inherits: boolean): Mode =>
  !v ? (inherits ? "inherit" : "now") : "now" in v ? "now" : "date" in v ? "date" : "before";

/** A rule in a few words, for «Igual que la materia (…)». */
export function describeStart(rule: StartAfter, tz: string): string {
  if ("now" in rule) return "ya";
  if ("daysBefore" in rule) return `${rule.daysBefore} días antes de la entrega`;
  return `desde el ${dayDate(tz, zonedInstant(tz, rule.date, 720))}`;
}

/** Whole days from 0 to a year, or undefined. */
const count = (s: string) => {
  // Blank is not 0: an emptied field must not silently mean «today».
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : undefined;
};

/**
 * «Puedo empezar» (SPEC §18.7): right away, from a date, in N days (saved as that date,
 * so it does not move each day) or N days before the deadline (moves with it).
 * `null` means what was typed is not valid yet: the form must not save it as «Ya».
 */
export function StartAfterField({
  value,
  onChange,
  tz,
  now,
  label = "Puedo empezar",
  inherited,
}: {
  value: StartAfter | undefined | null;
  onChange: (v: StartAfter | undefined | null) => void;
  tz: string;
  now: number;
  label?: string;
  /** A task of a materia with a rule: that rule, in words; «Igual que la materia» is offered. */
  inherited?: string;
}) {
  const today = localParts(tz, now).date;
  const [mode, setMode] = useState<Mode>(modeOf(value, inherited !== undefined));
  const [date, setDate] = useState(value && "date" in value ? value.date : addDays(today, 7));
  const [days, setDays] = useState(value && "daysBefore" in value ? String(value.daysBefore) : "4");
  const [inDays, setInDays] = useState("10");
  const emit = (m: Mode, d = date, b = days, i = inDays) => {
    if (m === "inherit") return onChange(undefined);
    // «Ya» against a materia rule has to be said explicitly.
    if (m === "now") return onChange(inherited !== undefined ? { now: true } : undefined);
    if (m === "date") return onChange(d ? { date: d } : null);
    const n = count(m === "before" ? b : i);
    if (n === undefined) return onChange(null);
    onChange(m === "before" ? { daysBefore: n } : { date: addDays(today, n) });
  };
  const inDate = count(inDays);
  const bad =
    (mode === "in" && inDate === undefined) ||
    (mode === "before" && count(days) === undefined) ||
    (mode === "date" && !date);
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
        {inherited !== undefined && (
          <option value="inherit">Igual que la materia ({inherited})</option>
        )}
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
            aria-invalid={mode === "in" && inDate === undefined ? true : undefined}
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
            aria-invalid={count(days) === undefined ? true : undefined}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              emit("before", date, e.target.value);
            }}
          />
          <span>días antes de la entrega</span>
        </span>
      )}
      {bad && (
        <p className="meta" role="alert" style={{ width: "100%", margin: 0 }}>
          {mode === "date" ? "Elegí un día." : "Poné un número entero de días, de 0 a 365."}
        </p>
      )}
    </fieldset>
  );
}
