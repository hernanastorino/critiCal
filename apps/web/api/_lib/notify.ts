// Which push notifications are due right now. Pure: the cron passes what it read.
import { localParts } from "../../src/engine.js";
import { NOTIFY_DEFAULTS, type NotificationPrefs, type Proposal } from "../../src/model.js";

const MINUTE = 60_000;

export interface Note {
  /** Sent once per user and key. */
  key: string;
  title: string;
  body: string;
  url: string;
}

export interface CriticalBlock {
  id: string;
  start: number;
  title: string;
}

export function dueNotes(input: {
  now: number;
  timeZone: string;
  prefs?: NotificationPrefs;
  critical: readonly CriticalBlock[];
  proposal?: Proposal;
}): Note[] {
  const prefs = { ...NOTIFY_DEFAULTS, ...input.prefs };
  const { now } = input;
  const notes: Note[] = [];
  if (prefs.critical) {
    for (const b of input.critical) {
      const minutes = Math.round((b.start - now) / MINUTE);
      if (b.start <= now || minutes > prefs.leadMinutes) continue;
      notes.push({
        key: `critical:${b.id}`,
        title: `🔴 En ${minutes} min: ${b.title}`,
        body: "Bloque crítico: si lo salteás, no llegás al mínimo.",
        url: "/",
      });
    }
  }
  if (prefs.proposals && input.proposal) {
    notes.push({
      key: `proposal:${[...input.proposal.conflicts].sort().join(",")}`,
      title: "Cambios para hoy",
      body: input.proposal.message,
      url: "/?tab=inbox",
    });
  }
  if (prefs.sunday) {
    const { date, weekday, minuteOfDay: minutes } = localParts(input.timeZone, now);
    // A late cron still reminds the same evening, never the next day.
    if (weekday === 0 && minutes >= prefs.sundayAt && minutes < prefs.sundayAt + 180) {
      notes.push({
        key: `sunday:${date}`,
        title: "Planificación semanal",
        body: "5 minutos para mirar la semana, los críticos y las decisiones.",
        url: "/?tab=week",
      });
    }
  }
  return notes;
}
