import { HOURS_DAYS, type HoursField, type HoursForm, type HoursProblem } from "../routineHours.js";

/** What the problems say, as one announcement: its own text when there is one, else a summary. */
export function hoursSummary(problems: HoursProblem[]): string | null {
  if (problems.length === 0) return null;
  return problems.length === 1
    ? (problems[0]?.text ?? null)
    : `Revisá los horarios: ${problems.map((p) => p.text).join(" ")}`;
}

function Pair({
  label,
  name,
  value,
  onChange,
  problems,
  field,
  errorId,
  onEnter,
}: {
  label?: string;
  name: string;
  value: HoursField;
  onChange: (v: HoursField) => void;
  problems: HoursProblem[];
  field: string;
  errorId: string;
  onEnter?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const bad = (side: "from" | "to") => problems.some((p) => p.field === `${field}-${side}`);
  const set = (side: "from" | "to", v: string) => {
    onChange(side === "from" ? { ...value, from: v } : { ...value, to: v });
  };
  return (
    <div className="row fields">
      {label && (
        <span className="grid3-label" style={{ minWidth: 72 }}>
          {label}
        </span>
      )}
      {(["from", "to"] as const).map((side) => (
        <label className="field" style={{ flex: 1 }} key={side}>
          <span>{side === "from" ? "Desde" : "Hasta"}</span>
          <input
            inputMode="numeric"
            placeholder={side === "from" ? "7" : "19:30"}
            aria-label={`${side === "from" ? "Desde" : "Hasta"}${name ? `, ${name}` : ""}`}
            value={side === "from" ? value.from : value.to}
            aria-invalid={bad(side) ? true : undefined}
            aria-describedby={bad(side) ? errorId : undefined}
            onKeyDown={onEnter}
            onChange={(e) => {
              set(side, e.target.value);
            }}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * The valid hours of a routine: «Desde» and «Hasta» for every day, and «Distinto según el
 * día» to give some days their own. Empty is no limit. The errors come from `readHours`;
 * they are one announcement (`errorId`), written by the form that holds this.
 */
export function RoutineHours({
  form,
  onChange,
  problems,
  errorId,
  onEnter,
}: {
  form: HoursForm;
  onChange: (f: HoursForm) => void;
  problems: HoursProblem[];
  errorId: string;
  onEnter?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <fieldset className="routine-hours" style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
      <legend className="meta" style={{ padding: 0 }}>
        Horario válido (vacío: a cualquier hora)
      </legend>
      <Pair
        name={form.perDay ? "los demás días" : "todos los días"}
        value={form.all}
        onChange={(all) => {
          onChange({ ...form, all });
        }}
        problems={problems}
        field="all"
        errorId={errorId}
        onEnter={onEnter}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={form.perDay}
          onChange={(e) => {
            onChange({ ...form, perDay: e.target.checked });
          }}
        />
        <span>Distinto según el día</span>
      </label>
      {form.perDay && (
        <>
          <p className="meta" style={{ margin: "0 0 4px" }}>
            Un día vacío usa el horario de arriba.
          </p>
          {HOURS_DAYS.map((d) => (
            <Pair
              key={d.weekday}
              label={d.short}
              name={d.name}
              value={form.days[d.weekday] ?? { from: "", to: "" }}
              onChange={(v) => {
                onChange({ ...form, days: form.days.map((x, i) => (i === d.weekday ? v : x)) });
              }}
              problems={problems}
              field={`day-${d.weekday}`}
              errorId={errorId}
              onEnter={onEnter}
            />
          ))}
        </>
      )}
    </fieldset>
  );
}
