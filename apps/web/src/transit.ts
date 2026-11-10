// Bus trips (SPEC §15): the contract between the app and `/api/transit`, and the rules
// the app applies to its saved regular routes. Pure: no network, no database.

/** 1 = weekday, 2 = Saturday, 3 = Sunday and holidays. */
export type DayType = 1 | 2 | 3;

export interface Coords {
  lat: number;
  lon: number;
}

/** A stop as the UI shows it. */
export interface BusStop extends Coords {
  id: string;
  name: string;
}

/** Walking to or from a stop, or between two. `from`/`to` are named when they are stops. */
export interface WalkLeg {
  kind: "walk";
  minutes: number;
  meters: number;
  /** "estimate" (straight line × 1.3) or "route" (OpenRouteService on-foot profile). */
  source: "estimate" | "route";
  to?: BusStop;
  from?: BusStop;
}

export interface BusLeg {
  kind: "bus";
  /** Line number as the bus shows it. */
  line: string;
  /** Where it is heading. */
  headsign: string;
  company: string | null;
  /** `stm` (Montevideo) or `dnt` (metropolitan lines). */
  source: "stm" | "dnt";
  board: BusStop;
  alight: BusStop;
  /** Minutes since 00:00 of the requested date (may pass 1440 after midnight). */
  boardMin: number;
  alightMin: number;
  stops: number;
  /** Minutes waiting at `board` for this bus after arriving there (0 on the first bus: you leave in time). */
  waitMinutes: number;
  /** Always true until live passes exist: the time is the schedule's, not the bus's. */
  theoretical: boolean;
}

export type Leg = WalkLeg | BusLeg;

export interface TransitOption {
  /** Minutes since 00:00 of the date: when to leave the door, and when you arrive. */
  leaveMin: number;
  arriveMin: number;
  /** Door to door: arriveMin − leaveMin. */
  totalMinutes: number;
  walkMinutes: number;
  waitMinutes: number;
  rideMinutes: number;
  transfers: number;
  legs: Leg[];
  theoretical: boolean;
}

export interface PlanRequest {
  action: "plan";
  from: Coords;
  to: Coords;
  /** Local date in Montevideo, YYYY-MM-DD. */
  date: string;
  /** Local time, HH:MM. */
  time: string;
  /** `arrive`: be there by `time` (leave as late as possible). `depart`: leave at `time`. */
  mode: "arrive" | "depart";
  /** Overrides the weekday's schedule (a holiday runs as Sunday: 3). */
  dayType?: DayType;
}

export interface FeedInfo {
  /** Versions by source, joined ("stm:ab12…|dnt:cd34…"): saved with a route to tell if it went stale. */
  version: string;
  builtAt: string;
  /** Earliest end date among the sources that state one (YYYY-MM-DD). */
  validTo: string | null;
  sources: { source: "stm" | "dnt"; version: string; builtAt: string; validTo: string | null }[];
}

export interface PlanOk {
  ok: true;
  /** Best first; empty when no bus gets there in time (walk or drive instead). */
  options: TransitOption[];
  /** The walk, when it is short enough to be an option: no bus needed. */
  walkOnly: { minutes: number; meters: number } | null;
  /** The day type the schedules were read for. */
  dayType: DayType;
  feed: FeedInfo;
  /** Always the attribution to show next to bus times. */
  attribution: string;
}

export type TransitError =
  | "unauthorized"
  | "not_invited"
  | "server_not_configured"
  | "bad_request"
  | "out_of_area"
  | "feed_unavailable"
  | "no_stops_near"
  | "rate_limited"
  | "transit_failed"
  | "unreachable";

export interface PlanFailed {
  ok: false;
  error: TransitError;
}

export type PlanResponse = PlanOk | PlanFailed;

export interface StatusOk {
  ok: true;
  /** Null until the first import has run. */
  feed: FeedInfo | null;
}

/** What a saved route in `bus_routes.plan` holds. */
export interface SavedPlan {
  option: TransitOption;
  dayType: DayType;
  /** Last day the schedules cover (YYYY-MM-DD), if the sources said so. */
  validTo: string | null;
}

export const ATTRIBUTION =
  "Horarios teóricos: Intendencia de Montevideo (STM) y Dirección Nacional de Transporte (MTOP), datos abiertos de Uruguay.";

/** The service area: Montevideo, Canelones and San José. Anything outside has no schedules. */
export const AREA = { south: -35.2, north: -34.3, west: -56.95, east: -55.4 };

export function inArea(p: Coords): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= AREA.south &&
    p.lat <= AREA.north &&
    p.lon >= AREA.west &&
    p.lon <= AREA.east
  );
}

/** The schedule family of a date (YYYY-MM-DD): weekday, Saturday or Sunday. */
export function dayTypeOf(date: string): DayType {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return wd === 0 ? 3 : wd === 6 ? 2 : 1;
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday (`bus_routes.weekday`). */
export function isoWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

/** "08:05" for minutes since midnight; past midnight wraps ("00:10" for 1450). */
export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes since midnight of "HH:MM", or null if it is not a time of day. */
export function parseHhmm(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface SavedRoute {
  weekday: number | null;
  time_minutes: number;
  mode: "arrive" | "depart";
  feed_version: string;
  plan: SavedPlan;
}

export type StaleReason = "feed" | "time" | "day" | "expired";

/**
 * Why a saved route has to be computed again (SPEC §15), or null if it still holds:
 * the schedules changed (`feed`), the event or trip time moved (`time`), the schedule it
 * was computed for does not run that day (`day`: a holiday, or another weekday), or the
 * schedules ended before that day (`expired`). The user can always ask for a recompute.
 */
export function staleReason(
  route: SavedRoute,
  wanted: { date: string; timeMinutes: number; dayType?: DayType },
  currentFeedVersion: string,
): StaleReason | null {
  if (route.feed_version !== currentFeedVersion) return "feed";
  if (route.time_minutes !== wanted.timeMinutes) return "time";
  if (route.weekday != null && route.weekday !== isoWeekday(wanted.date)) return "day";
  if (route.plan.dayType !== (wanted.dayType ?? dayTypeOf(wanted.date))) return "day";
  if (route.plan.validTo && wanted.date > route.plan.validTo) return "expired";
  return null;
}
