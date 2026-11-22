// Regular bus routes (SPEC §15, table `bus_routes`): the option the user chose for a pair
// of places at a time, kept so it is not worked out again every day. The rules that pick
// one for a trip are pure; reading and writing go through the signed-in client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanOk, SavedPlan, SavedRoute, TransitOption } from "./transit.js";
import { isoWeekday } from "./transit.js";

export interface RouteRow extends SavedRoute {
  id: string;
  from_place: string;
  to_place: string;
  computed_at: string;
  theoretical: boolean;
}

/** What identifies a route: the pair of places, the day, and the time to arrive by or leave at. */
export interface RouteSlot {
  from: string;
  to: string;
  mode: "arrive" | "depart";
  /** The trip's local date (YYYY-MM-DD). */
  date: string;
  timeMinutes: number;
}

/**
 * The saved route for a trip, if there is one: same places, mode and time, and either that
 * weekday or every day. The one for the weekday wins over the one for every day.
 */
export function findRoute(routes: readonly RouteRow[], slot: RouteSlot): RouteRow | undefined {
  const weekday = isoWeekday(slot.date);
  const fits = routes.filter(
    (r) =>
      r.from_place === slot.from &&
      r.to_place === slot.to &&
      r.mode === slot.mode &&
      r.time_minutes === slot.timeMinutes &&
      (r.weekday === null || r.weekday === weekday),
  );
  return fits.find((r) => r.weekday !== null) ?? fits[0];
}

/** What gets saved for the option on screen. */
export function savedPlanOf(option: TransitOption, answer: PlanOk): SavedPlan {
  return { option, dayType: answer.dayType, validTo: answer.feed.validTo };
}

/** A saved route as a plan response, so the card shows it the way it shows a fresh answer. */
export function planOf(route: RouteRow, attribution: string, feed: PlanOk["feed"]): PlanOk {
  return {
    ok: true,
    options: [route.plan.option],
    walkOnly: null,
    dayType: route.plan.dayType,
    maxTransfers: 1,
    raised: false,
    feed,
    attribution,
  };
}

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];

/** «los martes» / «todos los días». */
export function weekdayLabel(weekday: number | null): string {
  if (weekday === null) return "todos los días";
  const name = WEEKDAYS[weekday - 1];
  return name ? `los ${name}` : "todos los días";
}

const COLUMNS =
  "id,from_place,to_place,weekday,time_minutes,mode,plan,feed_version,computed_at,theoretical";

/** All the user's routes (a handful), or null when they could not be read. */
export async function loadRoutes(client: SupabaseClient): Promise<RouteRow[] | null> {
  const { data, error } = await client.from("bus_routes").select(COLUMNS);
  return error || !data ? null : (data as RouteRow[]);
}

export interface NewRoute {
  from_place: string;
  to_place: string;
  weekday: number | null;
  time_minutes: number;
  mode: "arrive" | "depart";
  plan: SavedPlan;
  feed_version: string;
  theoretical: boolean;
}

/**
 * Saves a route, replacing the one in the same slot (same places, weekday, mode and time)
 * when there is one. Null when the database refused it.
 */
export async function saveRoute(
  client: SupabaseClient,
  route: NewRoute,
  existing: readonly RouteRow[],
): Promise<RouteRow | null> {
  const same = existing.find(
    (r) =>
      r.from_place === route.from_place &&
      r.to_place === route.to_place &&
      r.weekday === route.weekday &&
      r.mode === route.mode &&
      r.time_minutes === route.time_minutes,
  );
  const row = { ...route, computed_at: new Date().toISOString() };
  const { data, error } = same
    ? await client.from("bus_routes").update(row).eq("id", same.id).select(COLUMNS).single()
    : await client.from("bus_routes").insert(row).select(COLUMNS).single();
  return error || !data ? null : (data as RouteRow);
}

export async function deleteRoute(client: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await client.from("bus_routes").delete().eq("id", id);
  return !error;
}

/** The route as a row to save again (what «Deshacer» puts back). */
export const asNew = (r: RouteRow): NewRoute => ({
  from_place: r.from_place,
  to_place: r.to_place,
  weekday: r.weekday,
  time_minutes: r.time_minutes,
  mode: r.mode,
  plan: r.plan,
  feed_version: r.feed_version,
  theoretical: r.theoretical,
});
