// Asks for the bus minutes of the coming events by itself (SPEC §15), one at a time and in
// the background, as if each card were opened, so the plan reserves the bus from the start.
// The engine never touches the network: this is the app saving the answers it would get.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
  type BusRoute,
  findRoute,
  type RouteSlot,
  routeAnswer,
  routeStale,
  slotOf,
} from "../busRoutes.js";
import {
  askKey,
  busTripsToAsk,
  type EventTrip,
  planRequestFor,
  tripOf,
  type Way,
  wayMinutes,
} from "../busTrip.js";
import { useSync } from "../Connected.js";
import { isTestDemo } from "../demoPruebas.js";
import { demoPlan } from "../demoTransit.js";
import type { AppEvent } from "../model.js";
import { busFeedVersion, planBus } from "../remote.js";
import { useStore } from "../store.js";
import type { PlanRequest, PlanResponse } from "../transit.js";
import { useBusRoutes } from "../useBusRoutes.js";

/** Time between two questions to the server, so a week of classes never trips its limit. */
export const PREFETCH_GAP_MS = 1000;
/** An event that was asked is not asked again for this long (answered or not). */
const RETRY_MS = 10 * 60_000;
/** After the server says «too many», or cannot be reached, nothing is asked for this long. */
const PAUSE_MS = 60_000;

const stops = (res: PlanResponse) =>
  !res.ok && ["rate_limited", "unreachable", "unauthorized"].includes(res.error);

interface Found {
  way: Way;
  minutes: number;
}

/** The plan of one way: the saved route if it still holds, else the server (or the demo's). */
async function planOf(
  request: PlanRequest,
  slot: RouteSlot | null,
  routes: readonly BusRoute[],
  feed: { version?: string | null },
  client?: SupabaseClient,
): Promise<PlanResponse> {
  const route = client && slot ? findRoute(routes, slot) : undefined;
  if (route && client) feed.version ??= await busFeedVersion(client);
  if (route && !routeStale(route, request, feed.version ?? null)) return routeAnswer(route);
  return client ? await planBus(client, request) : demoPlan(request);
}

/** The minutes of each way of an event's bus trip that got an answer, and whether to stop asking. */
async function ask(
  event: AppEvent,
  trip: EventTrip,
  tz: string,
  routes: readonly BusRoute[],
  client?: SupabaseClient,
): Promise<{ found: Found[]; stop: boolean }> {
  const found: Found[] = [];
  const feed: { version?: string | null } = {};
  for (const way of ["there", "back"] as const) {
    const request = planRequestFor(trip, event, tz, way);
    if (!request) continue;
    const res = await planOf(request, slotOf(trip, event, tz, way, request), routes, feed, client);
    if (stops(res)) return { found, stop: true };
    const best = res.ok ? res.options.at(0) : undefined;
    if (best) found.push({ way, minutes: wayMinutes(best, way, request) });
  }
  return { found, stop: false };
}

/** Renders nothing: keeps the bus minutes of the next days up to date while the app is open. */
export function BusPrefetch() {
  const { data, now, dispatch } = useStore();
  const sync = useSync();
  const client = sync?.client ?? undefined;
  // The test demo has no server: its bus plans are invented (demoTransit.ts). Any other demo
  // has none, and the plan keeps the car's minutes.
  const demo = !client && isTestDemo();
  const routes = useBusRoutes();
  const asked = useRef(new Map<string, number>());
  const pausedUntil = useRef(0);
  const [round, setRound] = useState(0);

  const skip = new Set<string>();
  const clock = Date.now();
  for (const [key, at] of asked.current) if (clock - at < RETRY_MS) skip.add(key);
  const next = client || demo ? busTripsToAsk(data, now, skip).at(0) : undefined;
  const key = next ? askKey(next) : "";

  const latest = useRef({ data, routes });
  latest.current = { data, routes };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` only re-reads the list
  useEffect(() => {
    if (!key) return;
    let live = true;
    const wait = Math.max(client ? PREFETCH_GAP_MS : 0, pausedUntil.current - Date.now());
    const run = async () => {
      const { data: current, routes: saved } = latest.current;
      const event = current.events.find((e) => askKey(e) === key);
      const trip = event && tripOf(current, event);
      asked.current.set(key, Date.now());
      if (event && trip) {
        const { found, stop } = await ask(event, trip, current.settings.timezone, saved, client);
        if (!live) return;
        for (const f of found) {
          dispatch({
            type: "tripMinutes",
            eventId: event.id,
            minutes: f.minutes,
            way: f.way,
            start: event.start,
          });
        }
        if (stop) pausedUntil.current = Date.now() + PAUSE_MS;
      }
      if (live) setRound((r) => r + 1);
    };
    const timer = setTimeout(() => {
      void run();
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, client, dispatch, round]);

  return null;
}
