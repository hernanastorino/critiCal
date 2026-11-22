// How to get to an event: by car or by bus (SPEC §15). Pure: the request for
// `/api/transit` and the words the interface says; the network call is in remote.ts.
import { localParts } from "./engine.js";
import { uruguayHolidays } from "./holidays.js";
import type { AppData, AppEvent, Place, TravelMode } from "./model.js";
import { home, placeOfEvent } from "./places.js";
import {
  type BusLeg,
  type DayType,
  dayTypeOf,
  hhmm,
  inArea,
  type PlanRequest,
  parseHhmm,
  type TransitOption,
  type WalkLeg,
} from "./transit.js";

/** The mode a trip to `place` has by default: bus only when the place says so. */
export const placeMode = (place: Place | undefined): TravelMode =>
  place?.travelMode === "bus" ? "bus" : "car";

export interface EventTrip {
  place: Place;
  /** Where the trip starts: the saved home. */
  from: Place;
  /** The mode in force: the one chosen for this event, else the place's. */
  mode: TravelMode;
  /** Chosen for this event alone (the place says another). */
  once: boolean;
}

/**
 * The trip to an event, when there is one: it is held at a saved place other than home
 * and a home is saved. Without either there is nothing to choose.
 */
export function tripOf(data: AppData, event: AppEvent): EventTrip | undefined {
  const from = home(data);
  const place = placeOfEvent(data, event);
  if (!from || !place || place.id === from.id) return undefined;
  const chosen = data.tripModes?.[event.id];
  return { place, from, mode: chosen ?? placeMode(place), once: chosen !== undefined };
}

/** Why a bus plan cannot be asked for yet, or null when both ends have coordinates in the area. */
export function unlocatedEnd(trip: EventTrip): "from" | "to" | "area" | null {
  const { from, place } = trip;
  if (from.lat == null || from.lon == null) return "from";
  if (place.lat == null || place.lon == null) return "to";
  return inArea({ lat: from.lat, lon: from.lon }) && inArea({ lat: place.lat, lon: place.lon })
    ? null
    : "area";
}

/** Which way of the trip: home → event (`there`) or event → home (`back`). */
export type Way = "there" | "back";

/**
 * The request for the bus of one way. There: home → event, be there by the event's start.
 * Back: event → home, leaving when the event ends. A holiday runs with the Sunday
 * schedule. `maxTransfers` stays unset: the server decides.
 */
export function planRequestFor(
  trip: EventTrip,
  event: AppEvent,
  tz: string,
  way: Way = "there",
): PlanRequest | null {
  const { lat: fromLat, lon: fromLon } = way === "there" ? trip.from : trip.place;
  const { lat: toLat, lon: toLon } = way === "there" ? trip.place : trip.from;
  if (fromLat == null || fromLon == null || toLat == null || toLon == null) return null;
  const from = { lat: fromLat, lon: fromLon };
  const to = { lat: toLat, lon: toLon };
  if (!inArea(from) || !inArea(to)) return null;
  const at = localParts(tz, way === "there" ? event.start : event.end);
  const holiday = uruguayHolidays(at.year).some((h) => h.date === at.date);
  const dayType: DayType = holiday ? 3 : dayTypeOf(at.date);
  return {
    action: "plan",
    from,
    to,
    date: at.date,
    time: hhmm(at.minuteOfDay),
    mode: way === "there" ? "arrive" : "depart",
    dayType,
  };
}

/**
 * The minutes the plan reserves for a way (SPEC §15). There: door to door. Back: from the
 * moment the event ends to arriving home, so the wait for the bus is counted.
 */
export function wayMinutes(option: TransitOption, way: Way, request: PlanRequest): number {
  if (way === "there") return option.totalMinutes;
  const from = parseHhmm(request.time) ?? option.leaveMin;
  return Math.max(0, option.arriveMin - from);
}

export interface BusStep {
  text: string;
  /** Bus steps carry the time they pass. */
  bus?: BusLeg;
}

const walkText = (leg: WalkLeg) => {
  const where = leg.to ? ` hasta ${leg.to.name}` : leg.from ? ` desde ${leg.from.name}` : "";
  return `Caminá ${Math.max(1, Math.round(leg.minutes))} min${where}`;
};

/**
 * The option as steps to read: walks, then each bus with its line, where to board and the
 * time it passes (a theoretical schedule: the interface says so).
 */
export function stepsOf(option: TransitOption): BusStep[] {
  return option.legs.map((leg) =>
    leg.kind === "walk"
      ? { text: walkText(leg) }
      : {
          bus: leg,
          text: `Línea ${leg.line} a ${leg.headsign} · parada ${leg.board.name} a las ${hhmm(leg.boardMin)}`,
        },
  );
}

/** "Salí a las 08:10 · llegás a las 08:52 (42 min)". */
export function summaryOf(option: TransitOption): string {
  return `Salí a las ${hhmm(option.leaveMin)} · llegás a las ${hhmm(option.arriveMin)} (${option.totalMinutes} min)`;
}
