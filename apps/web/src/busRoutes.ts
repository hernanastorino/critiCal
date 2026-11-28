// Regular bus routes (SPEC §15): «Guardar como ruta habitual» keeps the chosen option in
// `bus_routes` so it is not asked of the server every day. Pure rules plus the few calls
// to the table; the table is the user's own (row-level security).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventTrip, Way } from "./busTrip.js";
import { localParts } from "./engine.js";
import type { AppEvent } from "./model.js";
import {
  ATTRIBUTION,
  type DayType,
  isoWeekday,
  type PlanOk,
  type PlanRequest,
  parseHhmm,
  type SavedPlan,
  type StaleReason,
  staleReason,
  type TransitOption,
} from "./transit.js";

/** A row of `bus_routes` as the app reads it. */
export interface BusRoute {
  id: string;
  from_place: string;
  to_place: string;
  weekday: number | null;
  time_minutes: number;
  mode: "arrive" | "depart";
  feed_version: string;
  plan: SavedPlan;
}

/** A route as a backup file keeps it: no id (the database makes a new one), places as in the file. */
export type BackupRoute = Omit<BusRoute, "id">;

export const backupRoute = (r: BusRoute): BackupRoute => ({
  from_place: r.from_place,
  to_place: r.to_place,
  weekday: r.weekday,
  time_minutes: r.time_minutes,
  mode: r.mode,
  feed_version: r.feed_version,
  plan: r.plan,
});

/** What identifies a route: who goes where, which weekday, at what time, arriving or leaving. */
export type RouteSlot = Pick<
  BusRoute,
  "from_place" | "to_place" | "weekday" | "time_minutes" | "mode"
>;

/** The slot a way of an event falls in: its weekday, and the time of the request. */
export function slotOf(
  trip: EventTrip,
  event: AppEvent,
  tz: string,
  way: Way,
  request: PlanRequest,
): RouteSlot | null {
  const time = parseHhmm(request.time);
  if (time === null) return null;
  const at = localParts(tz, way === "there" ? event.start : event.end);
  return {
    from_place: way === "there" ? trip.from.id : trip.place.id,
    to_place: way === "there" ? trip.place.id : trip.from.id,
    weekday: isoWeekday(at.date),
    time_minutes: time,
    mode: request.mode,
  };
}

/** The saved route in this slot; one that holds every day also counts, the exact weekday first. */
export function findRoute(routes: readonly BusRoute[], slot: RouteSlot): BusRoute | undefined {
  const same = routes.filter(
    (r) =>
      r.from_place === slot.from_place &&
      r.to_place === slot.to_place &&
      r.mode === slot.mode &&
      r.time_minutes === slot.time_minutes,
  );
  return same.find((r) => r.weekday === slot.weekday) ?? same.find((r) => r.weekday === null);
}

/** Why a saved route does not hold for this request (null: it does). */
export function routeStale(
  route: BusRoute,
  request: PlanRequest,
  feedVersion: string | null,
): StaleReason | null {
  return staleReason(
    route,
    {
      date: request.date,
      timeMinutes: parseHhmm(request.time) ?? route.time_minutes,
      dayType: request.dayType,
    },
    // Without the current version (offline) the route is trusted: that is what it is for.
    feedVersion ?? route.feed_version,
  );
}

/** The route as an answer the card can show without asking the server. */
export function routeAnswer(route: BusRoute): PlanOk {
  const { option, dayType, validTo } = route.plan;
  return {
    ok: true,
    options: [option],
    walkOnly: null,
    dayType,
    maxTransfers: 2,
    raised: false,
    feed: { version: route.feed_version, builtAt: "", validTo, sources: [] },
    attribution: ATTRIBUTION,
  };
}

/** What to keep of an answer's best option: the row to insert. */
export function routeRow(
  slot: RouteSlot,
  option: TransitOption,
  answer: PlanOk,
  dayType: DayType,
): Omit<BusRoute, "id"> & { theoretical: boolean } {
  return {
    ...slot,
    plan: { option, dayType, validTo: answer.feed.validTo },
    feed_version: answer.feed.version,
    theoretical: option.theoretical,
  };
}

const COLUMNS = "id,from_place,to_place,weekday,time_minutes,mode,plan,feed_version";

export async function loadRoutes(client: SupabaseClient): Promise<BusRoute[]> {
  const { data, error } = await client.from("bus_routes").select(COLUMNS);
  return error || !data ? [] : (data as BusRoute[]);
}

/** Saves a route, replacing the one in the same slot. False when it could not be saved. */
export async function saveRoute(
  client: SupabaseClient,
  row: ReturnType<typeof routeRow>,
  replacing?: string,
): Promise<boolean> {
  if (replacing) {
    const gone = await client.from("bus_routes").delete().eq("id", replacing);
    if (gone.error) return false;
  }
  const { error } = await client.from("bus_routes").insert(row);
  return !error;
}

export async function deleteRoute(client: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await client.from("bus_routes").delete().eq("id", id);
  return !error;
}

const CHANGED = "critical:bus-routes";

/** Tells every screen that shows routes to read them again. */
export const routesChanged = () => window.dispatchEvent(new Event(CHANGED));
export const onRoutesChanged = (fn: () => void) => {
  window.addEventListener(CHANGED, fn);
  return () => {
    window.removeEventListener(CHANGED, fn);
  };
};

/** The rows of `routes` to insert (the `theoretical` mark comes from the saved option). */
export const routeRows = (routes: readonly BackupRoute[]) =>
  routes.map((r) => ({ ...r, theoretical: r.plan.option.theoretical }));

/** Tries to write the routes of a backup this many times: their places may not be saved yet. */
const RESTORE_TRIES = 8;
const RESTORE_WAIT_MS = 400;

/**
 * Makes the account's regular routes the ones of a backup file (SPEC §18.20): the routes of
 * the account go, the file's come in with new ids. Routes point at places, which are saved
 * by the sync a moment after the import, so this waits for them and tries again.
 */
export async function replaceRoutes(
  client: SupabaseClient,
  routes: readonly BackupRoute[],
  flush: () => Promise<unknown>,
): Promise<boolean> {
  for (let i = 0; i < RESTORE_TRIES; i++) {
    await flush();
    const gone = await client.from("bus_routes").delete().in("mode", ["arrive", "depart"]);
    if (!gone.error) {
      if (routes.length === 0) return true;
      const { error } = await client.from("bus_routes").insert(routeRows(routes));
      if (!error) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, RESTORE_WAIT_MS));
  }
  return false;
}
