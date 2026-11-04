import { type CalendarEvent, type Interval, MINUTE } from "./types.js";

export interface TravelOptions {
  home: string;
  /** Maps an event location to a known place id, or undefined if unknown. */
  resolvePlace: (location: string) => string | undefined;
  /** Driving minutes between two places, or undefined if unknown. */
  travelMinutes: (from: string, to: string) => number | undefined;
  marginMinutes: number;
  /** A gap longer than this sends you home between events. */
  returnHomeAfterMinutes: number;
}

export interface TravelResult {
  busy: Interval[];
  /** Events whose location could not be resolved. */
  unresolved: string[];
}

/**
 * Time blocked by driving to and from located events. The origin of each trip is
 * the previous event's place when it ended recently, otherwise home.
 */
export function travelBuffers(events: readonly CalendarEvent[], opts: TravelOptions): TravelResult {
  const located = events
    .filter((e) => e.busy && !e.allDay && e.location)
    .sort((a, b) => a.start - b.start);
  const busy: Interval[] = [];
  const unresolved: string[] = [];
  const gapLimit = opts.returnHomeAfterMinutes * MINUTE;
  const margin = opts.marginMinutes * MINUTE;

  const places = located.map((e) => {
    const place = opts.resolvePlace(e.location as string);
    if (!place) unresolved.push(e.id);
    return place;
  });

  located.forEach((event, i) => {
    const place = places[i];
    if (!place) return;
    const prev = located[i - 1];
    const prevPlace = places[i - 1];
    const fromPrev = prev && prevPlace && event.start - prev.end <= gapLimit;
    const origin = fromPrev ? prevPlace : opts.home;
    if (origin !== place) {
      const there = opts.travelMinutes(origin, place) ?? 0;
      busy.push({ start: event.start - there * MINUTE - margin, end: event.start });
    }

    const next = located[i + 1];
    const staysOut = next && places[i + 1] && next.start - event.end <= gapLimit;
    if (!staysOut && place !== opts.home) {
      const back = opts.travelMinutes(place, opts.home) ?? 0;
      busy.push({ start: event.end, end: event.end + back * MINUTE });
    }
  });

  return { busy, unresolved };
}
