// Small pieces shared by the forms of Ajustes.
import { useEffect, useId, useRef, useState } from "react";

/** What is typed and not saved yet: it stays until saved, even if Ajustes is closed. */
export function Unsaved() {
  return (
    <p className="meta" style={{ margin: "6px 0 0" }}>
      Cambios sin guardar
    </p>
  );
}

/**
 * Moves focus to the first field marked invalid inside `root`, so a refused save does
 * not leave it on the page (a disabled button takes it away; a tap on a button does not
 * focus it in Safari). Returns whether there was one.
 */
export function focusFirstInvalid(root: Element | null | undefined): boolean {
  const bad = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
  bad?.focus();
  return !!bad;
}

/**
 * For a save whose errors appear after the tap: `ask(button)` focuses the first invalid
 * field once the errors have been drawn.
 */
export function useFocusInvalid(): (from: Element | null) => void {
  const [n, setN] = useState(0);
  const root = useRef<Element | null>(null);
  useEffect(() => {
    if (n) focusFirstInvalid(root.current);
  }, [n]);
  return (from) => {
    root.current = from?.parentElement ?? null;
    setN((c) => c + 1);
  };
}

// Two decimals: every whole minute survives a save (105 min → 1.75 h → 105).
/** A whole number of minutes within [min, max] from a field, or undefined if not one. */
/** A plain non-negative figure as typed in a form («2», «1,5»): no letters, signs or exponents. */
export const isFigure = (v: string) => /^\s*\d+(?:[.,]\d+)?\s*$/.test(v);

/** A whole number as typed («3»): no decimals, signs, letters or exponents. */
export const isWhole = (v: string) => /^\s*\d+\s*$/.test(v);

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
  errorId = "week-error",
  help,
}: {
  label: string;
  /** What a screen reader says when several fields share the same visible label. */
  name?: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The field the error shown below is about. */
  invalid?: boolean;
  /** The id of the error text shown for it. */
  errorId?: string;
  /** A short line under the field for what its label does not say (what it is for, an example). */
  help?: string;
}) {
  const helpId = useId();
  const inputId = useId();
  const box = (children: React.ReactNode) =>
    help ? <div className="field-with-help">{children}</div> : children;
  return box(
    <>
      <label className="field" htmlFor={inputId}>
        <span>{label}</span>
        <input
          id={inputId}
          type={type}
          aria-label={name}
          inputMode={type === "text" ? "decimal" : undefined}
          value={value}
          onChange={onChange}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy(invalid ? errorId : undefined, help ? helpId : undefined)}
        />
      </label>
      {help && <Help id={helpId} text={help} />}
    </>,
  );
}

/** The ids a field is described by (its error, then its help), or undefined when none. */
export const describedBy = (...ids: (string | undefined)[]) =>
  ids.filter(Boolean).join(" ") || undefined;

/** The help line under a field: short, and tied to it with `aria-describedby`. */
export function Help({ id, text }: { id: string; text: string }) {
  return (
    <small id={id} className="meta field-help">
      {text}
    </small>
  );
}

/** Planning rules that apply to every day. */

/** A form error, right under its fields; empty when there is none. */
export function Problem({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <p id={id} className="meta" role="alert" style={{ color: "var(--critical)" }}>
      {text}
    </p>
  ) : null;
}
