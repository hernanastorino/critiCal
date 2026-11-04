// Materias, rutinas and the class schedule. Pure; shared by the app and the server.
import { eventRole, normalize, roleOf, subjectOf } from "./calendars.js";
import type { Activity } from "./engine.js";
import type { AppData, AppEvent, AppTask } from "./model.js";

/** Name of the activity evaluations wait in until the user says whose they are. */
export const NO_SUBJECT = "Sin materia";
/** Seed of its id, so the app and the server create the same one. */
export const NO_SUBJECT_SEED = "activity:sin-materia";

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
  Math.round(minutes) <= 1440;

/** Title of a materia's weekly study silo (Inicio de cuatrimestre uses it too). */
export const studyTitle = (a: Activity) => `Estudio ${a.name}`;

/** A materia's weekly study: its active habit marked as such, never another habit. */
export const studyOf = (data: AppData, a: Activity): AppTask | undefined =>
  data.tasks.find(
    (t) => t.activityId === a.id && t.kind === "habit" && t.status === "active" && t.study,
  );
