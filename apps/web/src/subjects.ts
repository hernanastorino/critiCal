// Materias, rutinas and the class schedule. Pure; shared by the app and the server.
import { eventRole, normalize, roleOf, subjectOf } from "./calendars.js";
import type { Activity } from "./engine.js";
import type { AppData, AppEvent, AppTask } from "./model.js";

/** Name of the activity evaluations wait in until the user says whose they are. */
export const NO_SUBJECT = "Sin materia";
/** Seed of its id, so the app and the server create the same one. */
export const NO_SUBJECT_SEED = "activity:sin-materia";

/** Two names are the same ignoring case and any run of spaces: «Cálculo   II» is «cálculo ii». */
export const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

export const isMateria = (a: Activity) => a.kind === "materia";
export const isNoSubject = (a: Activity) => !a.kind && a.name === NO_SUBJECT;

/** The user has a class schedule: materias come from it, not from evaluations' names. */
export const hasClasses = (data: AppData) =>
  (data.calendars ?? []).some((c) => roleOf(c) === "clases");

/** Normalized names a materia answers to: its own and its aliases. */
const namesOf = (a: Activity) =>
  [a.name, ...(a.aliases ?? [])].map(normalize).filter((n) => n.length > 0);

/**
 * The materia an event or evaluation title belongs to: one whose name or alias appears
 * in it as whole words, or equals what is left after dropping "Parcial 2 de…" and the
 * like ("P2 ADD" → "p add" contains "add"). The longest match wins.
 */
export function subjectFor(data: AppData, title: string): Activity | undefined {
  const text = ` ${normalize(title)} `;
  const rest = ` ${subjectOf(title)} `;
  let best: { a: Activity; length: number } | undefined;
  for (const a of data.activities.filter(isMateria)) {
    for (const n of namesOf(a)) {
      if ((text.includes(` ${n} `) || rest.includes(` ${n} `)) && (!best || n.length > best.length))
        best = { a, length: n.length };
    }
  }
  return best?.a;
}

/**
 * Titles in the class calendars that are not a known materia yet nor marked as just an
 * event: the inbox asks about each once (all of them at the start of a semester).
 */
export function newClassTitles(data: AppData): { key: string; title: string; event: AppEvent }[] {
  if (!hasClasses(data)) return [];
  const skip = new Set(data.notSubjects ?? []);
  const seen = new Map<string, AppEvent>();
  for (const e of data.events) {
    if (eventRole(data, e) !== "clases") continue;
    const key = normalize(e.title);
    if (!key || skip.has(key) || seen.has(key) || subjectFor(data, e.title)) continue;
    seen.set(key, e);
  }
  return [...seen.entries()].map(([key, event]) => ({ key, title: event.title, event }));
}

/** Activities from before materias and rutinas were told apart: the inbox sorts them. */
export function unsortedActivities(data: AppData): Activity[] {
  if (!hasClasses(data)) return [];
  return data.activities.filter((a) => !a.kind && !isNoSubject(a));
}

/**
 * What can hold exams and weekly study: the materias once there is a class schedule;
 * before that, every activity but routines and "Sin materia".
 */
export function subjectsOf(data: AppData): Activity[] {
  return hasClasses(data)
    ? data.activities.filter(isMateria)
    : data.activities.filter((a) => a.kind !== "rutina" && !isNoSubject(a));
}

/** Evaluations waiting to be told which materia they belong to. */
export function unassignedTasks(data: AppData) {
  const waiting = data.activities.find(isNoSubject);
  if (!waiting) return [];
  return data.tasks.filter((t) => t.activityId === waiting.id && t.status === "active");
}

/** Short forms of kinds of evaluation that titles use: "P2", "Pres", "Preentrega"… */
const CODES = /^(p|tp|ob|lab)\d*$|^(pres|prac|practico|practica|preentrega|pre|eval|evaluacion)$/;

/** What an evaluation's title calls its materia ("P2 ADD" → "add"), to learn as an alias. */
export const aliasFrom = (title: string) =>
  subjectOf(title)
    .split(" ")
    .filter((w) => w && !CODES.test(w))
    .join(" ");

/** Times a week and minutes a session that a routine can be planned with. */
export const validRoutine = (times: number, minutes: number) =>
  Number.isFinite(times) &&
  Number.isFinite(minutes) &&
  Math.round(times) >= 1 &&
  Math.round(times) <= 14 &&
  Math.round(minutes) >= 1 &&
  // At most 6 h a time and 40 h a week: 14 × 999 min could never be planned.
  Math.round(minutes) <= 360 &&
  Math.round(times) * Math.round(minutes) <= 40 * 60;

/**
 * A habit as Rutinas allows it: up to 14 sessions a week, 6 h a time and 40 h a week. The weekly
 * study of a materia may be bigger (up to 168 sessions): when the materia becomes a routine its
 * habit is fitted to those limits, so the backup it goes into can be imported back.
 */
export function fitRoutine(t: AppTask): AppTask {
  const { sessionsPerWeek: times, sessionMinutes: minutes } = t;
  if (t.kind !== "habit" || times === undefined || minutes === undefined) return t;
  if (validRoutine(times, minutes)) return t;
  const fitTimes = Math.max(1, Math.min(14, Math.round(times)));
  const fitMinutes = Math.max(1, Math.min(360, Math.round(minutes), Math.floor(2400 / fitTimes)));
  return {
    ...t,
    sessionsPerWeek: fitTimes,
    sessionMinutes: fitMinutes,
    minMinutes: Math.min(t.minMinutes, fitTimes * fitMinutes),
  };
}

/** Title of a materia's weekly study silo (Inicio de cuatrimestre uses it too). */
export const studyTitle = (a: Activity) => `Estudio ${a.name}`;

/** A materia's weekly study: its active habit marked as such, never another habit. */
export const studyOf = (data: AppData, a: Activity): AppTask | undefined =>
  data.tasks.find(
    (t) => t.activityId === a.id && t.kind === "habit" && t.status === "active" && t.study,
  );

/**
 * Marks the weekly study of materias saved before the mark existed (a backup): the
 * active habit titled «Estudio <materia>», if the materia has no marked one yet. Same
 * rule as the database migration.
 */
export function markLegacyStudy(data: AppData): AppData {
  let changed = false;
  // One per materia: those already marked, then each one marked here.
  const marked = new Set(data.tasks.filter((t) => t.study).map((t) => t.activityId));
  const tasks = data.tasks.map((t) => {
    const a = data.activities.find((x) => x.id === t.activityId);
    if (!a || t.study || t.kind !== "habit" || t.status !== "active" || t.title !== studyTitle(a))
      return t;
    if (marked.has(a.id)) return t;
    marked.add(a.id);
    changed = true;
    return { ...t, study: true };
  });
  return changed ? { ...data, tasks } : data;
}

/**
 * A habit made from «Nueva › Hábito semanal» before it was a routine got its own activity with
 * no kind (it showed in Materias, with study fields). A habit is a routine: such an activity
 * is read as one, with the limits a routine of those minutes gets (`saveRoutine`). Only an
 * activity with nothing but one active habit of its own, never a weekly study nor an entrega.
 * Derived on every load: nothing is rewritten in the database.
 */
export function habitsAsRoutines(data: AppData): AppData {
  let changed = false;
  const activities = data.activities.map((a) => {
    if (a.kind || a.academic || isNoSubject(a)) return a;
    const own = data.tasks.filter((t) => t.activityId === a.id);
    const habit = own.find((t) => t.kind === "habit" && t.status === "active");
    if (!habit?.sessionMinutes || own.some((t) => t.kind !== "habit" || t.study)) return a;
    changed = true;
    return {
      ...a,
      kind: "rutina" as const,
      maxSessionMinutes: Math.max(habit.sessionMinutes, 30),
      minBlockMinutes: Math.min(habit.sessionMinutes, 60),
    };
  });
  if (!changed) return data;
  const routine = new Set(activities.filter((a) => a.kind === "rutina").map((a) => a.id));
  return {
    ...data,
    activities,
    tasks: data.tasks.map((t) => (routine.has(t.activityId) ? fitRoutine(t) : t)),
  };
}
