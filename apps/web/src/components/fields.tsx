// Small pieces shared by the forms of Ajustes.

/** What is typed and not saved yet: it stays until saved, even if Ajustes is closed. */
export function Unsaved() {
  return (
    <p className="meta" style={{ margin: "6px 0 0" }}>
      Cambios sin guardar
    </p>
  );
}

// Two decimals: every whole minute survives a save (105 min → 1.75 h → 105).
/** A whole number of minutes within [min, max] from a field, or undefined if not one. */
/** A plain non-negative figure as typed in a form («2», «1,5»): no letters, signs or exponents. */
export const isFigure = (v: string) => /^\s*\d+(?:[.,]\d+)?\s*$/.test(v);

// «3,5» reads as 3.5; «0x10» or «1e2» are not figures.
export const clampMinutes = (v: string, min: number, max: number) => {
  if (!isFigure(v)) return undefined;
  const n = Math.round(Number(v.replace(",", ".")));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

export const toHours = (m: number) => String(Math.round((m / 60) * 100) / 100);
export const fromHours = (v: string) =>
  Math.max(0, Math.round(Number(v.replace(",", ".")) * 60) || 0);

export function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  invalid,
}: {
  label: string;
  /** What a screen reader says when several fields share the same visible label. */
  name?: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The field the error shown below is about. */
  invalid?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        aria-label={name}
        inputMode={type === "text" ? "decimal" : undefined}
        value={value}
        onChange={onChange}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? "week-error" : undefined}
      />
    </label>
  );
}

/** Planning rules that apply to every day. */
