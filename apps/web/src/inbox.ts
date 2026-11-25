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
import { preferenceMisfits } from "./preferredHours.js";
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

/** A card of the Bandeja: a row, and whether it is only «Calculando el traslado…». */
export interface InboxCard extends InboxRow {
  /** An address being timed: the app shows it, but it is not a question yet. */
  lookup?: boolean;
}

/** What the cards are worked out from: the derived pieces, so each caller reuses its own. */
export interface InboxInputs {
  data: AppData;
  now: number;
  pending: ReturnType<typeof pendingConfirmations>;
  unlocated: ReturnType<typeof unlocated>;
  pinShort: ReturnType<typeof pinShortfall>;
  clashes: ReturnType<typeof pinClashes>;
  missedMeals: ReturnType<typeof missedMeals>;
  /** «No llegás a todo» is one decision, whatever its options. */
  asked: { choose: boolean; recommendations: readonly { message: string }[] };
}

/** Cards about the calendar: events to move, the wake-up, places. */
function calendarCards(i: InboxInputs): InboxCard[] {
  const { data, now } = i;
  const cards: InboxCard[] = [];
  for (const m of data.movedEvents ?? []) {
    const event = data.events.find((e) => e.id === m.eventId);
    if (event) cards.push({ title: event.title, detail: "Para mover en tu calendario" });
  }
  const late = lateNight(data, now);
  if (late)
    cards.push({ title: "¿A qué hora te levantaste?", detail: `Anoche «${late.event.title}»` });
  for (const u of i.unlocated) {
    cards.push({ title: u.event.title, detail: "¿Dónde es?", lookup: u.lookup });
  }
  return cards;
}

/** Cards about materias and what was detected or proposed. */
function subjectCards(data: AppData): InboxCard[] {
  const cards: InboxCard[] = [];
  for (const c of newClassTitles(data)) {
    cards.push({ title: c.title, detail: "Clase nueva en tu calendario" });
  }
  for (const t of unassignedTasks(data))
    cards.push({ title: t.title, detail: "¿De qué materia es?" });
  for (const a of unsortedActivities(data)) {
    cards.push({ title: a.name, detail: "Ordenar tus actividades", color: a.color });
  }
  for (const t of data.tasks.filter((x) => x.needsReview && x.status === "active")) {
    cards.push({
      title: t.title,
      detail: "Detectado en tu calendario",
      color: data.activities.find((a) => a.id === t.activityId)?.color,
    });
  }
  for (const m of preferenceMisfits(data)) {
    cards.push({
      title: m.activity.name,
      detail: "Franja de rutina",
      color: m.activity.color,
    });
  }
  for (const p of data.proposals) cards.push({ title: p.message, detail: "Cambios para hoy" });
  return cards;
}

/** Cards about the plan: pins, meals and what does not fit. */
function planCards(i: InboxInputs): InboxCard[] {
  const { data } = i;
  const tz = data.settings.timezone;
  const cards: InboxCard[] = [];
  for (const { pin, event } of i.clashes) {
    const title = data.tasks.find((t) => t.id === pin.taskId)?.title ?? "Bloque";
    cards.push({
      title: `${title} · ${dayAndTime(tz, pin.start)}`,
      detail: `Fijado que choca con ${event.title}`,
    });
  }
  if (i.pinShort.short.length > 0) {
    cards.push({ title: "Lo que fijaste no te deja llegar", detail: "Movelos o soltá alguno" });
  }
  for (const m of i.missedMeals) {
    const eat = m.kind ? EAT[m.kind] : "comer";
    cards.push({
      title: `Sin lugar para ${eat} · ${dayDate(tz, m.preferred.start)}`,
      detail: "Comidas sin lugar",
    });
  }
  if (i.asked.choose) cards.push({ title: "No llegás a todo", detail: "Elegí cómo acomodarlo" });
  for (const r of i.asked.recommendations) cards.push({ title: "Sugerencia", detail: r.message });
  return cards;
}

/** «¿Cómo te fue?»: blocks that ended and were not answered. */
function answerCards(i: InboxInputs): InboxCard[] {
  const { data } = i;
  const tz = data.settings.timezone;
  return i.pending.map((b) => ({
    title: clipName(data.tasks.find((t) => t.id === b.taskId)?.title ?? "Bloque"),
    detail: `¿Cómo te fue? · ${dayAndTime(tz, b.start)} – ${time(tz, b.end)}`,
    color: data.activities.find((a) => a.id === b.activityId)?.color,
  }));
}

/**
 * Every card the Bandeja holds, in the order it shows them. The one place that says what
 * enters: the screen, its tab count and the widget all read it.
 */
export function inboxCards(i: InboxInputs): InboxCard[] {
  return [...calendarCards(i), ...subjectCards(i.data), ...planCards(i), ...answerCards(i)];
}

/** Cards that are questions already (the tab counts these). */
export const asking = (cards: InboxCard[]): InboxCard[] => cards.filter((c) => !c.lookup);

/** Everything the Bandeja asks the user to decide or register, from the data alone. */
export function inboxRows(data: AppData, now: number): InboxRow[] {
  const plan = refreshPlan(data, now);
  const asked = decisions(plan.input, plan.result, { data, now });
  // The server times addresses by itself, so they are not questions while being timed.
  const cards = inboxCards({
    data,
    now,
    pending: pendingConfirmations(data, now),
    unlocated: unlocated(data, visibleEvents(data), now),
    pinShort: pinShortfall(data, now, plan.result),
    clashes: pinClashes(data, now, plan.input),
    missedMeals: missedMeals(data, now),
    asked: { choose: asked.hasOptions, recommendations: asked.recommendations },
  });
  return asking(cards).map(({ title, detail, color }) => ({ title, detail, color }));
}
