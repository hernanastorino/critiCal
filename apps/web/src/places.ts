// Saved places and driving times → the engine's travel options. Pure.
import { normalize } from "./calendars.js";
import type { CalendarEvent, TravelOptions } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";

/** Origin is the previous event's place if it ended less than this ago, else home. */
const STAY_OUT_MINUTES = 120;
const DAY = 86_400_000;

const words = (p: Place) =>
  [p.name, ...p.aliases]
    .map(normalize)
    .filter((w) => w.length > 1)
    .sort((a, b) => b.length - a.length);

/** The saved place a location (or title) mentions; the longest match wins. */
export function placeFor(places: readonly Place[], text: string | undefined): Place | undefined {
  if (!text) return undefined;
  const t = ` ${normalize(text)} `;
  let best: { place: Place; length: number } | undefined;
  for (const place of places) {
    for (const w of words(place)) {
      if (t.includes(` ${w} `) && (!best || w.length > best.length))
        best = { place, length: w.length };
    }
  }
  return best?.place;
}

export const home = (data: AppData) => data.places?.find((p) => p.isHome);

/** Minutes from one place to another: manual first, then computed, else unknown. */
export function minutesBetween(data: AppData, from: string, to: string): number | undefined {
  const times = (data.travelTimes ?? []).filter((t) => t.from === from && t.to === to);
  return (times.find((t) => t.manual) ?? times[0])?.minutes;
}

const skipped = (data: AppData, text: string | undefined) =>
  !!text && (data.noTravel ?? []).includes(normalize(text));

/**
 * Events as the engine should see them for travel: an event without a location
 * takes the place its title names; events marked "no trip" have none.
 */
export function withPlaces<T extends CalendarEvent & { title: string }>(
  data: AppData,
  events: T[],
): T[] {
  const places = data.places ?? [];
  if (!home(data)) return events;
  return events.map((e) => {
    if (skipped(data, e.location) || skipped(data, e.title)) return { ...e, location: undefined };
    if (e.location) return e;
    const place = placeFor(places, e.title);
    return place ? { ...e, location: place.name } : e;
  });
}

export function travelOptions(data: AppData): TravelOptions | undefined {
  const start = home(data);
  if (!start) return undefined;
  const places = data.places ?? [];
  return {
    home: start.id,
    resolvePlace: (location) => placeFor(places, location)?.id,
    travelMinutes: (from, to) => minutesBetween(data, from, to),
    marginMinutes: data.settings.travelMarginMinutes,
    returnHomeAfterMinutes: STAY_OUT_MINUTES,
  };
}

/**
 * Upcoming busy events (next 7 days) whose place is unknown: a location no saved
 * place matches, or no location and no place in the title. Grouped by what the
 * event says, so a weekly class is asked about once.
 */
export function unlocated(data: AppData, events: readonly AppEvent[], now: number) {
  if (!home(data)) return [];
  const places = data.places ?? [];
  const seen = new Map<string, AppEvent>();
  for (const e of events) {
    if (!e.busy || e.allDay || e.end <= now || e.start > now + 7 * DAY) continue;
    const text = e.location || e.title;
    if (!text || skipped(data, e.location) || skipped(data, e.title)) continue;
    if (placeFor(places, e.location) || (!e.location && placeFor(places, e.title))) continue;
    const key = normalize(text);
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.entries()].map(([key, event]) => ({
    key,
    text: event.location || event.title,
    event,
  }));
}
