// What waits in the Bandeja, as plain rows. Pure; the server (widget) uses it too, so the
// text there is the one the cards of the app show.
import { visibleEvents } from "./calendars.js";
import type { MealKind } from "./engine.js";
import { clipName, dayAndTime, dayDate, time } from "./format.js";
import { lateNight } from "./lateNight.js";
import type { AppData } from "./model.js";
import { unlocated } from "./places.js";
import {
  decisions,
  missedMeals,
  pendingConfirmations,
  pinClashes,
  pinShortfall,
  refreshPlan,
} from "./planning.js";
import { newClassTitles, unassignedTasks, unsortedActivities } from "./subjects.js";

/** The verb of a meal, as the Bandeja says it: «Sin lugar para almorzar». */
export const EAT: Record<MealKind, string> = {
  desayuno: "desayunar",
  almuerzo: "almorzar",
  merienda: "merendar",
  cena: "cenar",
};

export interface InboxRow {
  /** The title of the card. */
  title: string;
  /** Its section in the Bandeja («¿Dónde es?»), with the day when it has one. */
  detail: string;
  color?: string;
}

/** Rows about things to sort out in the calendar and the materias. */
function sortingRows(data: AppData, now: number): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const m of data.movedEvents ?? []) {
    const event = data.events.find((e) => e.id === m.eventId);
    if (event) rows.push({ title: event.title, detail: "Para mover en tu calendario" });
  }
  const late = lateNight(data, now);
  if (late)
    rows.push({ title: "¿A qué hora te levantaste?", detail: `Anoche «${late.event.title}»` });
  // The server times addresses by itself, so they are not questions while being timed.
  for (const u of unlocated(data, visibleEvents(data), now)) {
    if (!u.lookup) rows.push({ title: u.event.title, detail: "¿Dónde es?" });
  }
  for (const c of newClassTitles(data)) {
    rows.push({ title: c.title, detail: "Clase nueva en tu calendario" });
  }
  for (const t of unassignedTasks(data))
    rows.push({ title: t.title, detail: "¿De qué materia es?" });
  for (const a of unsortedActivities(data)) {
    rows.push({ title: a.name, detail: "Ordenar tus actividades", color: a.color });
  }
  for (const t of data.tasks.filter((x) => x.needsReview && x.status === "active")) {
    rows.push({
      title: t.title,
      detail: "Detectado en tu calendario",
      color: data.activities.find((a) => a.id === t.activityId)?.color,
    });
  }
  for (const p of data.proposals) rows.push({ title: p.message, detail: "Cambios para hoy" });
  return rows;
}

/** Rows about the plan: pins, meals and what does not fit. */
function planRows(data: AppData, now: number, plan: ReturnType<typeof refreshPlan>): InboxRow[] {
  const tz = data.settings.timezone;
  const rows: InboxRow[] = [];
  const asked = decisions(plan.input, plan.result, { data, now });
  for (const { pin, event } of pinClashes(data, now, plan.input)) {
    const title = data.tasks.find((t) => t.id === pin.taskId)?.title ?? "Bloque";
    rows.push({
      title: `${title} · ${dayAndTime(tz, pin.start)}`,
      detail: `Fijado que choca con ${event.title}`,
    });
  }
  if (pinShortfall(data, now, plan.result).short.length > 0) {
    rows.push({ title: "Lo que fijaste no te deja llegar", detail: "Movelos o soltá alguno" });
  }
  for (const m of missedMeals(data, now)) {
    const eat = m.kind ? EAT[m.kind] : "comer";
    rows.push({
      title: `Sin lugar para ${eat} · ${dayDate(tz, m.preferred.start)}`,
      detail: "Comidas sin lugar",
    });
  }
  // «No llegás a todo» is one decision, whatever its options.
  if (asked.options.length > 0) {
    rows.push({ title: "No llegás a todo", detail: "Elegí cómo acomodarlo" });
  }
  for (const r of asked.recommendations) rows.push({ title: "Sugerencia", detail: r.message });
  return rows;
}

/** «¿Cómo te fue?»: blocks that ended and were not answered. */
function answerRows(data: AppData, now: number): InboxRow[] {
  const tz = data.settings.timezone;
  return pendingConfirmations(data, now).map((b) => ({
    title: clipName(data.tasks.find((t) => t.id === b.taskId)?.title ?? "Bloque"),
    detail: `¿Cómo te fue? · ${dayAndTime(tz, b.start)} – ${time(tz, b.end)}`,
    color: data.activities.find((a) => a.id === b.activityId)?.color,
  }));
}

/** Everything the Bandeja asks the user to decide or register (its tab counts these). */
export function inboxRows(data: AppData, now: number): InboxRow[] {
  const plan = refreshPlan(data, now);
  return [...sortingRows(data, now), ...planRows(data, now, plan), ...answerRows(data, now)];
}
