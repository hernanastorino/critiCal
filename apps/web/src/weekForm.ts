// What «Mi semana» checks and shows for the times and minutes typed in it.
import { isFigure, isWhole } from "./components/fields.js";
import { awakeProblem } from "./dayLength.js";
import { hhmmToMinutes, minutesToHhmm, parseClock } from "./format.js";
import { MEAL_NAMES } from "./planning.js";

export interface WeekFormValues {
  wake: string;
  morning: string;
  breakfast: string;
  breakfastMin: string;
  lunch: string;
  lunchMin: string;
  snack: string;
  snackMin: string;
  dinner: string;
  dinnerMin: string;
  freeFrom: string;
  bed: string;
}

/** An error and the fields it is about (it shows under the first one, all are marked). */
export interface WeekProblem {
  message: string;
  fields: string[];
}

type MealName = "desayuno" | "almuerzo" | "merienda" | "cena";

/** Each meal with the time and the minutes typed for it. */
const mealRows = (
  f: WeekFormValues,
): { kind: MealName; field: string; at: string; minutes: string }[] => [
  { kind: "desayuno", field: "Desayuno", at: f.breakfast, minutes: f.breakfastMin },
  { kind: "almuerzo", field: "Almuerzo", at: f.lunch, minutes: f.lunchMin },
  { kind: "merienda", field: "Merienda", at: f.snack, minutes: f.snackMin },
  { kind: "cena", field: "Cena", at: f.dinner, minutes: f.dinnerMin },
];

/** Every minutes field that is not a whole number from 0 to 240, each said for its field. */
function minutesProblems(form: WeekFormValues): WeekProblem[] {
  // A figure out of range would be corrected without a word (−20 → 0, 999 → 240).
  return (
    [
      ["Arreglarse, traslado (min)", form.morning],
      ["Dura (min), desayuno", form.breakfastMin],
      ["Dura (min), almuerzo", form.lunchMin],
      ["Dura (min), merienda", form.snackMin],
      ["Dura (min), cena", form.dinnerMin],
    ] as const
  )
    .filter(([, v]) => v.trim() !== "" && !(isWhole(v) && Number(v) <= 240))
    .map(([field, typed]) => ({
      fields: [field],
      // «1,5» is not rounded behind the back: whole minutes only (as in Rutinas and Materias).
      message:
        isFigure(typed) && !isWhole(typed)
          ? `«${field}»: solo números enteros, entre 0 y 240 min.`
          : `«${field}» tiene que ser un número de minutos entre 0 y 240.`,
    }));
}

/** A time that is not one (a blank or impossible hour) would be read as midnight. */
function timeProblems(form: WeekFormValues): WeekProblem[] {
  const times: [string, string, string][] = [
    ["Me levanto", form.wake, "1"],
    ["Me acuesto", form.bed, "1"],
    ["Nada de estudio desde", form.freeFrom, "1"],
    ...mealRows(form).map((m): [string, string, string] => [m.field, m.at, m.minutes]),
  ];
  return times
    .filter(([, v, minutes]) => Number(minutes) > 0 && parseClock(v) === null)
    .map(([field]) => ({ message: "Hora inválida.", fields: [field] }));
}

interface PlacedMeal {
  kind: MealName;
  field: string;
  start: number;
  length: number;
}

/** The meals that exist: a duration above 0 and a real time. */
function placedMeals(form: WeekFormValues): PlacedMeal[] {
  return mealRows(form).flatMap((m) => {
    const start = parseClock(m.at);
    const length = isWhole(m.minutes) && Number(m.minutes) <= 240 ? Number(m.minutes) : 0;
    return length > 0 && start !== null ? [{ kind: m.kind, field: m.field, start, length }] : [];
  });
}

/** A meal while asleep (the whole meal, not just its start) would vanish silently. */
function asleepProblems(meals: PlacedMeal[], form: WeekFormValues): WeekProblem[] {
  const wake = hhmmToMinutes(form.wake);
  const bed = hhmmToMinutes(form.bed);
  const bedEnd = wake < bed ? bed : bed + 1440;
  return meals
    .filter((m) => {
      const start = m.start < wake ? m.start + 1440 : m.start;
      return !(start >= wake && start + m.length <= bedEnd);
    })
    .map((m) => ({
      message: `${MEAL_NAMES[m.kind]} a las ${minutesToHhmm(m.start)} cae, o termina, cuando estás dormido (de ${form.bed} a ${form.wake}). Cambiá la hora, acortala o poné duración 0.`,
      fields: [m.field],
    }));
}

/** «Nada de estudio desde» between waking up and going to bed (after midnight, the gap is sleep). */
function freeProblems(form: WeekFormValues): WeekProblem[] {
  if (parseClock(form.freeFrom) === null) return [];
  const wake = hhmmToMinutes(form.wake);
  const bed = hhmmToMinutes(form.bed);
  const free = hhmmToMinutes(form.freeFrom);
  const fields = ["Nada de estudio desde"];
  if (bed < wake ? free > bed && free < wake : free < wake)
    return [
      {
        message: `«Nada de estudio desde» (${form.freeFrom}) cae antes de que te levantes (${form.wake}).`,
        fields,
      },
    ];
  if (bed > wake && free > bed)
    return [
      {
        message: `«Nada de estudio desde» (${form.freeFrom}) cae después de que te acuestes (${form.bed}).`,
        fields,
      },
    ];
  return [];
}

/** Breakfast, lunch, snack and dinner in that order (the later one never before). */
function orderProblems(meals: PlacedMeal[], form: WeekFormValues): WeekProblem[] {
  const wake = hhmmToMinutes(form.wake);
  const at = (m: PlacedMeal) => (m.start < wake ? m.start + 1440 : m.start);
  return meals.flatMap((m, i) => {
    const before = meals[i - 1];
    if (!before || at(m) >= at(before)) return [];
    return [
      {
        message: `${MEAL_NAMES[m.kind]} (${minutesToHhmm(m.start)}) no puede ir antes que ${MEAL_NAMES[before.kind].toLowerCase()} (${minutesToHhmm(before.start)}): las comidas van en orden, de desayuno a cena.`,
        fields: [m.field],
      },
    ];
  });
}

/** What depends on wake and bed being real, different times. */
function clockProblems(form: WeekFormValues): WeekProblem[] {
  const wake = parseClock(form.wake);
  const bed = parseClock(form.bed);
  if (wake === null || bed === null) return [];
  if (wake === bed)
    return [
      {
        message: "Me levanto y me acuesto no pueden ser a la misma hora.",
        fields: ["Me levanto", "Me acuesto"],
      },
    ];
  const meals = placedMeals(form);
  const asleep = [...asleepProblems(meals, form), ...freeProblems(form)];
  // Said after what is about the meals and the free time, which fall asleep first in a day that is not one.
  const tooLong = asleep.length === 0 ? awakeProblem(form.wake, form.bed) : null;
  return [
    ...asleep,
    ...orderProblems(meals, form),
    ...(tooLong ? [{ message: tooLong, fields: ["Me levanto", "Me acuesto"] }] : []),
  ];
}

/** Every problem of the form at once, each for its field(s); empty when it can be saved. */
export function weekProblems(form: WeekFormValues): WeekProblem[] {
  return [...minutesProblems(form), ...timeProblems(form), ...clockProblems(form)];
}

/** A time as typed («7», «7:5»), written the way a time field shows it («07:00»). */
export const clockText = (v: string) => {
  const m = parseClock(v);
  return m === null ? v : minutesToHhmm(m);
};
