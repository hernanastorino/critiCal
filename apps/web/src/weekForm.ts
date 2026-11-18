// What «Mi semana» checks and shows for the times and minutes typed in it.
import { isFigure, isWhole } from "./components/fields.js";
import { minutesToHhmm, parseClock } from "./format.js";

/** The minutes of Mi semana that are not whole numbers from 0 to 240, said for their field. */
export function weekMinutesProblem(form: {
  morning: string;
  breakfastMin: string;
  lunchMin: string;
  snackMin: string;
  dinnerMin: string;
}): { message: string; field: string } | null {
  // A figure out of range would be corrected without a word (−20 → 0, 999 → 240).
  const bad = (
    [
      ["Arreglarse, traslado (min)", form.morning],
      ["Dura (min), desayuno", form.breakfastMin],
      ["Dura (min), almuerzo", form.lunchMin],
      ["Dura (min), merienda", form.snackMin],
      ["Dura (min), cena", form.dinnerMin],
    ] as const
  ).find(([, v]) => v.trim() !== "" && !(isWhole(v) && Number(v) <= 240));
  if (!bad) return null;
  const [field, typed] = bad;
  return {
    field,
    // «1,5» is not rounded behind the back: whole minutes only (as in Rutinas and Materias).
    message:
      isFigure(typed) && !isWhole(typed)
        ? `«${field}»: solo números enteros, entre 0 y 240 min.`
        : `«${field}» tiene que ser un número de minutos entre 0 y 240.`,
  };
}

/** A time as typed («7», «7:5»), written the way a time field shows it («07:00»). */
export const clockText = (v: string) => {
  const m = parseClock(v);
  return m === null ? v : minutesToHhmm(m);
};
