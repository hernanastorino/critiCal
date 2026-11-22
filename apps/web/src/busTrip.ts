// How to get to an event: by car or by bus (SPEC §15). Pure: the request for
// `/api/transit` and the words the interface says; the network call is in remote.ts.
import type { RouteSlot } from "./busRoutes.js";
import { localParts, type TripLeg } from "./engine.js";
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

/**
 * The request for the bus of one leg of the trip. `there`: home → event, done by the
 * event's start. `back`: event → home, leaving when the event ends. A holiday runs with
 * the Sunday schedule. `maxTransfers` stays unset: the server decides.
 */
export function planRequestFor(
  trip: EventTrip,
  event: AppEvent,
  tz: string,
  leg: TripLeg = "there",
): PlanRequest | null {
  const { lat: fromLat, lon: fromLon } = trip.from;
  const { lat: toLat, lon: toLon } = trip.place;
  if (fromLat == null || fromLon == null || toLat == null || toLon == null) return null;
  const home_ = { lat: fromLat, lon: fromLon };
  const place = { lat: toLat, lon: toLon };
  if (!inArea(home_) || !inArea(place)) return null;
  const back = leg === "back";
  const at = localParts(tz, back ? event.end : event.start);
  const holiday = uruguayHolidays(at.year).some((h) => h.date === at.date);
  const dayType: DayType = holiday ? 3 : dayTypeOf(at.date);
  return {
    action: "plan",
    from: back ? place : home_,
    to: back ? home_ : place,
    date: at.date,
    time: hhmm(at.minuteOfDay),
    mode: back ? "depart" : "arrive",
    dayType,
  };
}

/** The saved-route slot a request for this leg falls in (`bus_routes`). */
export function slotFor(trip: EventTrip, request: PlanRequest): RouteSlot {
  const back = request.mode === "depart";
  return {
    from: back ? trip.place.id : trip.from.id,
    to: back ? trip.from.id : trip.place.id,
    mode: request.mode,
    date: request.date,
    timeMinutes: parseHhmm(request.time) ?? -1,
  };
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
