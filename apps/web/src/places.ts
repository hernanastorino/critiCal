// Saved places and driving times → the engine's travel options. Pure.
import { normalize } from "./calendars.js";
import type { CalendarEvent, TravelOptions } from "./engine.js";
import { stripInvisible } from "./limits.js";
import type { AppData, AppEvent, Place, Spot } from "./model.js";

/** Origin is the previous event's place if it ended less than this ago, else home. */
const STAY_OUT_MINUTES = 120;
const DAY = 86_400_000;

const words = (p: Place) =>
  [p.name, ...p.aliases]
    .map(normalize)
    .filter((w) => w.length > 1)
    .sort((a, b) => b.length - a.length);

/** Whether a place word names the normalized text: whole, or (`loose`) among other words. */
function mentions(norm: string, w: string, loose: boolean): boolean {
  if (!loose) return norm === w;
  const t = ` ${norm} `;
  return t.includes(` ${w} `) && !t.includes(` ${w} de `) && !t.includes(` ${w} del `);
}

/**
 * The saved place a text names. A location counts only when it is the place's name or an
 * alias as a whole (or its address): «Casa de la abuela Marta» is another place than «Casa».
 * A title (`loose`) may mention the place among other words, but «Casa de …» is not «Casa».
 */
export function placeFor(
  places: readonly Place[],
  text: string | undefined,
  loose = false,
): Place | undefined {
  if (!text) return undefined;
  const norm = normalize(text);
  // A place's address counts only as the whole text: «Centro» inside «Gym Centro» does not.
  const whole = places.find((p) => p.address && spotKey(p.address) === spotKey(text));
  if (whole) return whole;
  let best: { place: Place; length: number } | undefined;
  for (const place of places) {
    for (const w of words(place)) {
      if (mentions(norm, w, loose) && (!best || w.length > best.length))
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

const EARTH_KM = 6371;
/** Straight-line km → minutes by car: a winding road at city speed. */
const MINUTES_PER_KM = 2.8;

/** Minutes by car from the straight line between two places' coordinates, if both have them. */
export function estimatedMinutes(data: AppData, from: string, to: string): number | undefined {
  const places = data.places ?? [];
  const a = places.find((p) => p.id === from);
  const b = places.find((p) => p.id === to);
  if (a?.lat == null || a.lon == null || b?.lat == null || b.lon == null) return undefined;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  const km = 2 * EARTH_KM * Math.asin(Math.sqrt(h));
  return Math.max(5, Math.round(km * MINUTES_PER_KM));
}

/**
 * What the plan reserves for a trip between two places: its minutes (manual first, then
 * computed), else the way back's, else an estimate from the coordinates. Never 0 by
 * default: a pair with nothing known has no figure (undefined).
 */
export const drivingMinutes = (data: AppData, from: string, to: string): number | undefined =>
  minutesBetween(data, from, to) ??
  minutesBetween(data, to, from) ??
  estimatedMinutes(data, from, to);

const skipped = (data: AppData, text: string | undefined) =>
  !!text && (data.noTravel ?? []).includes(normalize(text));

/**
 * How an event's text is told apart from others: normalized, or (for addresses with no
 * Latin letters or digits, which normalize away) its lower-cased self. Never empty.
 */
export const spotKey = (text: string) => {
  // Emojis tell «🏠🎉 de 👵» from «💼 de 🏢»: keep them when the text has any.
  if (/\p{Extended_Pictographic}/u.test(text)) {
    const kept = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 \p{Extended_Pictographic}]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (kept) return kept;
  }
  return normalize(text) || text.trim().toLowerCase();
};

const legacyKey = (text: string) => normalize(text) || text.trim().toLowerCase();

/**
 * Spots and kept travel saved before emojis counted in `spotKey` are re-keyed from
 * their text; if two collide, the manual one stays. Same data back when nothing changes.
 */
export function rekeySpots(data: AppData): AppData {
  const spots = data.spots ?? [];
  let changed = false;
  const byKey = new Map<string, Spot>();
  for (const s of spots) {
    const key = spotKey(s.text);
    if (key !== s.key) changed = true;
    const next = key === s.key ? s : { ...s, key };
    const old = byKey.get(key);
    if (old) changed = true;
    if (!old || (next.manual && !old.manual)) byKey.set(key, next);
  }
  let eventTravel = data.eventTravel;
  if (eventTravel) {
    for (const e of data.events) {
      const kept: { key: string; minutes: number } | undefined = eventTravel[e.id];
      const key = eventSpotKey(e);
      if (
        kept &&
        kept.key !== key &&
        kept.key === legacyKey(e.location?.trim() ? e.location : e.title)
      ) {
        eventTravel = { ...eventTravel, [e.id]: { ...kept, key } };
        changed = true;
      }
    }
  }
  return changed ? { ...data, spots: [...byKey.values()], eventTravel } : data;
}

/** A saved place (other than `exceptId`) already called `name`, ignoring case and accents. */
export const nameTaken = (places: readonly Place[], name: string, exceptId?: string) => {
  const key = spotKey(name);
  return !!key && places.some((p) => p.id !== exceptId && spotKey(p.name) === key);
};

/** A name or alias with no case, spaces or invisible characters, to tell if two are the same. */
const aliasKey = (text: string) => spotKey(stripInvisible(text)).replace(/\s/g, "");

/** Whether two names are the same for the app (case, spaces and invisible characters aside). */
export const sameName = (a: string, b: string) => !!aliasKey(a) && aliasKey(a) === aliasKey(b);

/** The first of the comma-separated `aliases` that another place already has as name or alias. */
export const aliasTaken = (places: readonly Place[], aliases: string, exceptId?: string) =>
  aliases
    .split(",")
    .map((a) => a.trim())
    .find((a) => {
      const key = aliasKey(a);
      return (
        !!key &&
        places.some(
          (p) => p.id !== exceptId && [p.name, ...p.aliases].some((w) => aliasKey(w) === key),
        )
      );
    });

/** The one-off address an event's text refers to, if the app already has it. */
export const spotFor = (data: AppData, text: string | undefined): Spot | undefined =>
  text?.trim() ? (data.spots ?? []).find((s) => s.key === spotKey(text)) : undefined;

/** A spot the planner can use: its driving time is known. */
const timed = (data: AppData, text: string | undefined) =>
  spotFor(data, text)?.minutes !== undefined;

const SPOT = "spot:";
/**
 * An event whose own minutes were kept after its address was deleted. The NUL makes it
 * a key no calendar location can be (an event at «event:Hospital» stays an address).
 */
const EVENT = "\u0000event:";

/** What an event's travel is keyed by: its address or, without one, its title. */
export const eventSpotKey = (e: { location?: string; title: string }) =>
  spotKey(addressOf(e) ?? e.title);

/** Ids of the events whose address (or, without one, title) is the spot `key`. */
export const eventsAt = (data: AppData, key: string) =>
  data.events.filter((e) => eventSpotKey(e) === key).map((e) => e.id);

/**
 * Events at the spot `key` that can keep its minutes after «Eliminar lugar»: not ones
 * a saved place already names (those use the place's own times).
 */
export const keepableEvents = (data: AppData, key: string) =>
  data.events
    .filter(
      (e) =>
        eventSpotKey(e) === key &&
        !placeFor(data.places ?? [], addressOf(e) ?? e.title, !addressOf(e)),
    )
    .map((e) => e.id);

/**
 * Minutes kept for this event after «Eliminar lugar», while it still says the same and
 * no saved place has claimed it since; otherwise its new location is asked or timed.
 */
export function keptTravel(data: AppData, e: { id: string; location?: string; title: string }) {
  const kept = data.eventTravel?.[e.id];
  if (!kept || eventSpotKey(e) !== kept.key) return undefined;
  if (placeFor(data.places ?? [], addressOf(e) ?? e.title, !addressOf(e))) return undefined;
  return kept.minutes;
}

/** What an event gives as its address; one of blanks is none. */
const addressOf = (e: { location?: string }) => (e.location?.trim() ? e.location : undefined);

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
  return events.map((raw) => {
    // Its address was deleted but its minutes kept: the trip is counted all the same.
    if (keptTravel(data, raw) !== undefined) return { ...raw, location: EVENT + raw.id };
    // An address of blanks is no address, here, in the inbox and in search.
    const e = raw.location && !addressOf(raw) ? { ...raw, location: undefined } : raw;
    // A title answer only counts for events without a location of their own.
    if (skipped(data, e.location || e.title)) return { ...e, location: undefined };
    if (e.location) return e;
    const place = placeFor(places, e.title, true);
    if (place) return { ...e, location: place.name };
    // Minutes typed for an event without an address are kept under its title.
    return timed(data, e.title) ? { ...e, location: e.title } : e;
  });
}

/** Whether the trip to this event is by bus: its own choice, else its saved place's. */
export const goesByBus = (data: AppData, e: AppEvent): boolean => {
  const place = placeOfEvent(data, e);
  const home_ = home(data);
  if (!place || !home_ || place.id === home_.id) return false;
  return (data.tripModes?.[e.id] ?? place.travelMode) === "bus";
};

/**
 * The bus trip's door-to-door minutes the plan reserves for this event (SPEC §15): the
 * figure `/api/transit` gave for the event's current start. Undefined when the trip is by
 * car or no figure was saved yet, and the plan then keeps the driving minutes.
 */
export function busMinutes(
  data: AppData,
  e: AppEvent,
  leg: "there" | "back" = "there",
): number | undefined {
  const saved = data.tripMinutes?.[e.id];
  if (!saved || saved.start !== e.start || !goesByBus(data, e)) return undefined;
  // Without a way home of its own, it is as long as the way there.
  return leg === "back" ? (saved.back ?? saved.minutes) : saved.minutes;
}

/** Upcoming events going by bus that have no usable bus figure: the plan drives for them. */
export const busWithoutMinutes = (data: AppData, events: readonly AppEvent[], now: number) =>
  events.filter(
    (e) =>
      e.busy && !e.allDay && e.end > now && goesByBus(data, e) && busMinutes(data, e) === undefined,
  );

export function travelOptions(data: AppData): TravelOptions | undefined {
  const start = home(data);
  if (!start) return undefined;
  const places = data.places ?? [];
  const byId = new Map(data.events.map((e) => [e.id, e]));
  return {
    tripMinutes: (event, leg) => {
      const own = byId.get(event.id);
      return own && own.start === event.start ? busMinutes(data, own, leg) : undefined;
    },
    home: start.id,
    resolvePlace: (location) =>
      (location.startsWith(EVENT) ? location : undefined) ??
      placeFor(places, location)?.id ??
      (timed(data, location) ? `${SPOT}${spotKey(location)}` : undefined),
    // A spot is only timed from home; trips between it and another place take that long too.
    travelMinutes: (from, to) => {
      const spots = [from, to].filter((id) => id.startsWith(SPOT) || id.startsWith(EVENT));
      if (spots.length === 0) return drivingMinutes(data, from, to);
      return Math.max(
        ...spots.map((id) =>
          id.startsWith(EVENT)
            ? (data.eventTravel?.[id.slice(EVENT.length)]?.minutes ?? 0)
            : ((data.spots ?? []).find((s) => SPOT + s.key === id)?.minutes ?? 0),
        ),
      );
    },
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
    if (keptTravel(data, e) !== undefined) continue;
    // An address of blanks is no address.
    const location = addressOf(e);
    const text = location?.trim() || e.title;
    if (!text || skipped(data, text)) continue;
    if (placeFor(places, location) || (!location && placeFor(places, e.title, true))) continue;
    if (timed(data, text)) continue;
    const key = spotKey(text);
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.entries()].map(([key, event]) => {
    const spot = spotFor(data, event.location);
    return {
      key,
      text: event.location?.trim() || event.title,
      event,
      /** An address the server has not timed yet: no need to ask while it tries. */
      lookup: !!event.location?.trim() && !spot,
    };
  });
}

/**
 * Saved places matching what the user types, best first: every word must start a word
 * of the place's name, aliases, address or the titles of events held there ("clara"
 * finds "Casa de Clara" and "Trabajo de Clara"; "futbol" finds the field used for
 * "Fútbol 5"). Name matches go first, then the most used.
 */
export function searchPlaces(data: AppData, query: string, limit = 6): Place[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (terms.length === 0) return [];
  const places = data.places ?? [];
  const titles = new Map<string, string[]>();
  for (const e of data.events) {
    const place =
      placeFor(places, addressOf(e)) ??
      (!addressOf(e) ? placeFor(places, e.title, true) : undefined);
    if (place) titles.set(place.id, [...(titles.get(place.id) ?? []), e.title]);
  }
  const hits = (texts: (string | undefined)[]) => {
    const words = texts.flatMap((t) => (t ? normalize(t).split(" ") : []));
    return terms.every((q) => words.some((w) => w.startsWith(q)));
  };
  return places
    .map((p) => {
      const used = titles.get(p.id) ?? [];
      const rank = hits([p.name])
        ? 0
        : hits([p.name, ...p.aliases, p.address])
          ? 1
          : hits([p.name, ...p.aliases, p.address, ...used])
            ? 2
            : -1;
      return { p, rank, uses: used.length };
    })
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.uses - a.uses || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

/** How far ahead trips are looked at when working out which driving times are needed. */
const TRIPS_AHEAD_DAYS = 14;

/** A trip between two saved places, by their ids. */
export interface PlacePair {
  from: string;
  to: string;
}

/** The saved place an event is held at: its address first, else what its title names. */
export function placeOfEvent(data: AppData, e: AppEvent): Place | undefined {
  const places = data.places ?? [];
  const location = addressOf(e);
  if (skipped(data, location ?? e.title)) return undefined;
  return location ? placeFor(places, location) : placeFor(places, e.title, true);
}

/**
 * The trips the plan really makes in the next two weeks: home to each event's place and
 * back, and straight from one event's place to the next when there is no time to go
 * home in between. Driving times are worked out for these only, never for every
 * combination of saved places.
 */
export function tripPairs(data: AppData, now: number): PlacePair[] {
  const start = home(data);
  if (!start) return [];
  const held = data.events
    .filter((e) => e.busy && !e.allDay && e.end > now && e.start <= now + TRIPS_AHEAD_DAYS * DAY)
    .flatMap((e) => {
      const place = placeOfEvent(data, e);
      return place ? [{ e, place }] : [];
    })
    .sort((a, b) => a.e.start - b.e.start);
  const seen = new Set<string>();
  const pairs: PlacePair[] = [];
  const add = (from: string, to: string) => {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    pairs.push({ from, to });
  };
  held.forEach(({ e, place }, i) => {
    add(start.id, place.id);
    add(place.id, start.id);
    const previous = held[i - 1];
    if (previous && e.start - previous.e.end < STAY_OUT_MINUTES * 60_000)
      add(previous.place.id, place.id);
  });
  return pairs;
}

/**
 * Trips the plan makes that need a look-up: the driving time is not known yet, or an end has
 * an address but no coordinates and the trip is by bus (which needs them even when the
 * minutes were typed by hand).
 */
export function missingPairs(data: AppData, now: number): PlacePair[] {
  const places = new Map((data.places ?? []).map((p) => [p.id, p]));
  const locatable = (id: string) => {
    const p = places.get(id);
    return !!p && ((p.lat != null && p.lon != null) || !!p.address?.trim());
  };
  const unplaced = (id: string) => {
    const p = places.get(id);
    return p?.lat == null || p.lon == null;
  };
  // Only a trip by bus needs coordinates beyond the minutes.
  const byBus = new Set(
    data.events.filter((e) => goesByBus(data, e)).flatMap((e) => placeOfEvent(data, e)?.id ?? []),
  );
  return tripPairs(data, now).filter(
    (t) =>
      locatable(t.from) &&
      locatable(t.to) &&
      (minutesBetween(data, t.from, t.to) === undefined ||
        ((byBus.has(t.from) || byBus.has(t.to)) && (unplaced(t.from) || unplaced(t.to)))),
  );
}
