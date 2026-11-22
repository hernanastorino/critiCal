import { type CalendarEvent, type Interval, MINUTE } from "./types.js";

/** The trip to an event from home, or the one back home after it. */
export type TripLeg = "there" | "back";

export interface TravelOptions {
  home: string;
  /** Maps an event location to a known place id, or undefined if unknown. */
  resolvePlace: (location: string) => string | undefined;
  /** Driving minutes between two places, or undefined if unknown. */
  travelMinutes: (from: string, to: string) => number | undefined;
  /**
   * Door-to-door minutes of a trip by another means (the bus, with its wait), when known:
   * `there` is home → event, `back` is event → home. They replace the driving minutes of
   * the legs between home and the event; with no `back` figure the way back is taken to be
   * as long as the way there. Never called inside the engine for the network: the app hands
   * it the saved figures.
   */
  tripMinutes?: (event: CalendarEvent, leg: TripLeg) => number | undefined;
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
      // Only a trip from home has a figure of its own: from another place it is unknown.
      const own = origin === opts.home ? opts.tripMinutes?.(event, "there") : undefined;
      const there = own ?? opts.travelMinutes(origin, place) ?? 0;
      busy.push({ start: event.start - there * MINUTE - margin, end: event.start });
    }

    const next = located[i + 1];
    const staysOut = next && places[i + 1] && next.start - event.end <= gapLimit;
    if (!staysOut && place !== opts.home) {
      // Without a figure of its own, the way back is taken to be as long as the way there.
      const back =
        opts.tripMinutes?.(event, "back") ??
        opts.tripMinutes?.(event, "there") ??
        opts.travelMinutes(place, opts.home) ??
        0;
      busy.push({ start: event.end, end: event.end + back * MINUTE });
    }
  });

  return { busy, unresolved };
}
