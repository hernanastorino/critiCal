import type { Activity } from "./engine.js";
import {
  type AppCalendar,
  type AppData,
  type AppEvent,
  type AppTask,
  type CalendarRole,
  type DetectedKind,
  type Effort,
  nextColor,
} from "./model.js";
import { hasClasses, isNoSubject, NO_SUBJECT, NO_SUBJECT_SEED, subjectFor } from "./subjects.js";

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Role from the calendar's name: "Parciales" → parcial, "Entregas" → entrega, … */
export function guessRole(name: string): CalendarRole {
  const n = normalize(name);
  if (/\b(parcial|parciales|examen|examenes|prueba|pruebas|final|finales)\b/.test(n))
    return "parcial";
  if (/\b(entrega|entregas|deadline|deadlines)\b/.test(n)) return "entrega";
  if (/\b(presentacion|presentaciones|exposicion|exposiciones|defensa)\b/.test(n))
    return "presentacion";
  if (/\b(feriado|feriados|holiday|holidays|cumpleanos|birthdays)\b/.test(n)) return "ignore";
  return "busy";
}

/** The app's own output calendar: never an input. */
export const isPlanCalendar = (name: string) => normalize(name) === "plan";

export const roleOf = (c: AppCalendar): CalendarRole =>
  isPlanCalendar(c.name) ? "ignore" : (c.role ?? guessRole(c.name));

export const ROLE_LABEL: Record<CalendarRole, string> = {
  busy: "Ocupado (fijo)",
  parcial: "Parciales",
  entrega: "Entregas",
  presentacion: "Presentaciones",
  clases: "Clases (materias)",
  ignore: "Ignorar",
};

/** Default effort per kind of deadline, in minutes. */
export const DEFAULTS: Record<DetectedKind, Effort> = {
  parcial: { estimate: 600, min: 360, priority: 3 },
  entrega: { estimate: 360, min: 240, priority: 2 },
  presentacion: { estimate: 240, min: 120, priority: 2 },
};

const KEYWORDS =
  /\b(parcial|parciales|1er|2do|3er|primer|segundo|tercer|examen|final|prueba|entrega|entregable|presentacion|exposicion|defensa|de|del|la|el|tp|obligatorio)\b/g;

/** "Parcial 2 de Física I" → "Fisica I"-like subject used to find or name the activity. */
export function subjectOf(title: string): string {
  const cleaned = normalize(title)
    .replace(KEYWORDS, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function calendarFor(data: AppData, e: AppEvent): AppCalendar | undefined {
  return data.calendars?.find((c) => c.id === e.calendarId);
}

/** Tags in an event's title that say what it is, whatever its calendar. */
const TAGS: [RegExp, DetectedKind][] = [
  [/#(parcial|examen)\b/iu, "parcial"],
  [/#presentaci[oó]n\b/iu, "presentacion"],
  [/#entrega\b|📝/iu, "entrega"],
];

/** The kind an event's title tags it as (📝, #entrega, #parcial…), if any. */
export function tagRole(title: string): DetectedKind | undefined {
  return TAGS.find(([re]) => re.test(title))?.[1];
}

/** The title without its tags, as the task is called. */
export const untagged = (title: string) =>
  title
    .replace(/#(parcial|examen|presentaci[oó]n|entrega)\b/giu, "")
    .replace(/📝/gu, "")
    .replace(/\s+/g, " ")
    .trim() || title;

/**
 * What an event is for the planner: a tag in its title wins (it is explicit), except
 * in calendars marked to ignore; otherwise its calendar's role.
 */
export function eventRole(data: AppData, e: AppEvent): CalendarRole {
  const c = calendarFor(data, e);
  const role = c ? roleOf(c) : "busy";
  if (role === "ignore") return role;
  return tagRole(e.title) ?? role;
}

/** An event that may not happen: so marked by its calendar, or a title ending in «?». */
export const isTentative = (e: AppEvent) => !!e.tentative || /\?\s*$/.test(e.title);

/** Events the planner and the week view use: ignored calendars out, deadlines of "entrega" do not block time. */
export function visibleEvents(data: AppData): AppEvent[] {
  return data.events.flatMap((e) => {
    const role = eventRole(data, e);
    if (role === "ignore") return [];
    if (role === "entrega") return [{ ...e, busy: false }];
    return [e];
  });
}

/** Original-spelling subject for naming a new activity: "Entrega TP Programación" → "Programación". */
export function subjectName(title: string): string {
  const kept = title.split(/\s+/).filter((w) => {
    const n = normalize(w);
    return n.length > 0 && !/^\d+$/.test(n) && n.replace(KEYWORDS, "").trim().length > 0;
  });
  const name = kept.join(" ") || title;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Keeps tasks in step with deadline events: a new parcial/entrega/presentación
 * creates a task (marked for review) under the matching activity, and a moved
 * event moves the task's deadline. Pure; returns `data` itself if nothing changed.
 * `newId` gets a seed per event (and per new subject) so that the app and the server,
 * importing the same event at once, create the same row instead of two.
 */
export function importFromCalendars(
  data: AppData,
  now: number,
  newId: (seed: string) => string,
): AppData {
  if (!data.calendars?.length) return data;
  let tasks = data.tasks;
  let activities = data.activities;
  let changed = false;

  for (const e of data.events) {
    const role = eventRole(data, e);
    if (role !== "parcial" && role !== "entrega" && role !== "presentacion") {
      // No longer an evaluation (tag removed, calendar role changed): its task stops
      // being planned; dropped, not deleted, so check-ins keep their history.
      const stale = tasks.find((t) => t.sourceEventId === e.id && t.status === "active");
      if (stale) {
        tasks = tasks.map((t) =>
          t === stale ? { ...t, status: "dropped" as const, endedAt: now, autoDroppedAt: now } : t,
        );
        changed = true;
      }
      continue;
    }
    const deadline = role === "entrega" ? e.end : e.start;
    const existing = tasks.find((t) => t.sourceEventId === e.id);
    const title = untagged(e.title);
    if (existing) {
      // Dropped by the import and untouched since: it comes back with its event.
      const back =
        existing.status === "dropped" &&
        existing.autoDroppedAt !== undefined &&
        existing.autoDroppedAt === existing.endedAt;
      if (back || existing.deadline !== deadline || existing.title !== title) {
        tasks = tasks.map((t) =>
          t === existing
            ? {
                ...t,
                deadline,
                title,
                ...(back
                  ? { status: "active" as const, endedAt: undefined, autoDroppedAt: undefined }
                  : {}),
              }
            : t,
        );
        changed = true;
      }
      continue;
    }
    if (deadline <= now) continue;

    // With a class schedule, evaluations join its materias and never create one: an
    // unknown name waits under "Sin materia" until the inbox asks.
    if (hasClasses(data)) {
      let activity = subjectFor({ ...data, activities }, e.title);
      if (!activity) {
        activity = activities.find(isNoSubject);
        if (!activity) {
          const created: Activity = {
            id: newId(NO_SUBJECT_SEED),
            name: NO_SUBJECT,
            color: nextColor(activities),
            academic: true,
            maxSessionMinutes: 120,
            minBlockMinutes: 60,
          };
          activities = [...activities, created];
          activity = created;
        }
      }
      tasks = [...tasks, deadlineTask(data, e, role, deadline, activity.id, newId)];
      changed = true;
      continue;
    }
    const subject = subjectOf(e.title);
    let activity = activities.find((a) => {
      const name = normalize(a.name);
      return (
        name.length > 0 &&
        (normalize(e.title).includes(name) || (subject.length > 0 && name.includes(subject)))
      );
    });
    if (!activity) {
      const name = subjectName(e.title);
      const created: Activity = {
        id: newId(`activity:${normalize(name)}`),
        name,
        color: nextColor(activities),
        academic: true,
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      };
      activities = [...activities, created];
      activity = created;
    }
    tasks = [...tasks, deadlineTask(data, e, role, deadline, activity.id, newId)];
    changed = true;
  }
  return changed ? { ...data, tasks, activities } : data;
}

/** The task a parcial/entrega/presentación event becomes, waiting for a quick review. */
function deadlineTask(
  data: AppData,
  e: AppEvent,
  role: DetectedKind,
  deadline: number,
  activityId: string,
  newId: (seed: string) => string,
): AppTask {
  const d = data.preferences?.importDefaults?.[role] ?? DEFAULTS[role];
  return {
    id: newId(`task:${e.id}`),
    activityId,
    title: untagged(e.title),
    kind: "deliverable",
    deadline,
    estimateMinutes: d.estimate,
    minMinutes: d.min,
    priority: d.priority,
    status: "active",
    units: [],
    sourceEventId: e.id,
    needsReview: true,
  };
}
