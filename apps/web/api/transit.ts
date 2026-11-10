// Vercel function (Node): bus trips (SPEC §15).
//
//   POST { action: "plan", from, to, date, time, mode }  → the best bus options
//   POST { action: "status" }                            → which schedule version is stored
//   POST { action: "import", source? }  + X-Cron-Key     → (weekly, from pg_cron) refresh
//
// The schedules come from the Intendencia de Montevideo (STM) and the national
// transport directorate (metropolitan lines); the server keeps them compacted in
// `transit_feed` and searches them in memory. Everything is theoretical until live
// passes exist. The contract is in apps/web/src/transit.ts.
import {
  ATTRIBUTION,
  type Coords,
  type DayType,
  dayTypeOf,
  inArea,
  type PlanOk,
  type PlanRequest,
  parseHhmm,
  type TransitError,
} from "../src/transit.js";
import { limiter } from "./_lib/rate.js";
import { report } from "./_lib/report.js";
import { adminClient, authenticate, type Env, json, missing, readEnv } from "./_lib/server.js";
import type { Source } from "./_lib/transit/feed.js";
import { haversine, WALK_DETOUR, WALK_M_PER_MIN } from "./_lib/transit/geo.js";
import { importSource } from "./_lib/transit/import.js";
import { endpoints, planAuto } from "./_lib/transit/network.js";
import { feedInfo, loadNetwork, scheduleOn } from "./_lib/transit/store.js";

/** The weekly import downloads ~15 MB and parses 2.7 million rows: well under a minute. */
export const maxDuration = 60;
/** How Vercel reads it for a plain Node function in `/api`. */
export const config = { maxDuration };

const ORS_FOOT = "https://api.openrouteservice.org/v2/matrix/foot-walking";
/** Walks up to this many minutes are offered as the alternative to the bus. */
const WALK_ONLY_MAX = 25;
/** Plans per user: the shared routing quota is small (SPEC §6). */
export const plans = limiter(10, 200);

const fail = (error: TransitError, status: number) => json({ ok: false, error }, status);

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

/** The contract's largest request is a few hundred bytes. */
export const MAX_BODY = 4096;

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  // Refuse before reading: a huge body would cost CPU and memory even for a bad request.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail("bad_request", 413);
  if (req.headers.has("x-cron-key")) return runImport(req, env);
  const caller = await authenticate(req, env, []);
  if (caller instanceof Response) return caller;
  const body = await smallBody(req);
  if (body === null) return fail("bad_request", 413);
  try {
    if (body.action === "status") return json({ ok: true, feed: await feedInfo(caller.admin) });
    if (body.action !== "plan") return fail("bad_request", 400);
    const request = parsePlan(body, now);
    if (typeof request === "string") return fail(request, request === "out_of_area" ? 422 : 400);
    if (!plans.take(caller.uid, now)) return fail("rate_limited", 429);
    return await computePlan(caller.admin, env, request);
  } catch (e) {
    console.error(e);
    await report(env, e, "transit");
    return fail("transit_failed", 500);
  }
}

/** The request if it is well formed and inside the service area, else why not. */
export function parsePlan(body: Record<string, unknown>, now: number): PlanRequest | TransitError {
  const point = (v: unknown): Coords | null => {
    const p = v as Partial<Coords> | null;
    return p && typeof p.lat === "number" && typeof p.lon === "number"
      ? { lat: p.lat, lon: p.lon }
      : null;
  };
  const from = point(body.from);
  const to = point(body.to);
  const { date, time, mode, dayType, maxTransfers } = body;
  if (!from || !to || typeof date !== "string" || typeof time !== "string") return "bad_request";
  if (mode !== "arrive" && mode !== "depart") return "bad_request";
  if (dayType !== undefined && ![1, 2, 3].includes(dayType as number)) return "bad_request";
  if (maxTransfers !== undefined && ![1, 2].includes(maxTransfers as number)) return "bad_request";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseHhmm(time) === null) return "bad_request";
  const day = Date.parse(`${date}T12:00:00Z`);
  // A real date within a year ahead and a couple of days back: schedules do not go further.
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date)
    return "bad_request";
  if (day < now - 3 * 86_400_000 || day > now + 366 * 86_400_000) return "bad_request";
  if (!inArea(from) || !inArea(to)) return "out_of_area";
  return {
    action: "plan",
    from,
    to,
    date,
    time,
    mode,
    dayType: dayType as DayType | undefined,
    maxTransfers: maxTransfers as 1 | 2 | undefined,
  };
}

async function computePlan(admin: ReturnType<typeof adminClient>, env: Env, req: PlanRequest) {
  const loaded = await loadNetwork(admin);
  if (!loaded) return fail("feed_unavailable", 503);
  const { net, info } = loaded;
  const meters = haversine(req.from, req.to);
  const walkMinutes = Math.ceil((meters * WALK_DETOUR) / WALK_M_PER_MIN);
  const walkOnly =
    walkMinutes <= WALK_ONLY_MAX ? { minutes: walkMinutes, meters: Math.round(meters) } : null;
  const ends = endpoints(net, req.from, req.to);
  if (!ends.origin.length || !ends.dest.length) {
    // Close enough to walk is an answer, not an error.
    return walkOnly ? json(answer(req, info, [], walkOnly)) : fail("no_stops_near", 422);
  }
  const today = req.dayType ?? dayTypeOf(req.date);
  const previous = new Date(Date.parse(`${req.date}T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const schedule = scheduleOn(loaded, req.date, today, dayTypeOf(previous), previous);
  const routed = env.orsKey ? await walkingTimes(env.orsKey, req.from, req.to, net, ends) : null;
  const found = planAuto(
    net,
    {
      from: req.from,
      to: req.to,
      mode: req.mode,
      at: parseHhmm(req.time) as number,
      schedule,
      maxTransfers: req.maxTransfers,
      routedIn: routed?.in,
      routedOut: routed?.out,
    },
    ends,
  );
  return json(
    answer(req, info, found.options, walkOnly, found.maxTransfers as 1 | 2, found.raised),
  );
}

function answer(
  req: PlanRequest,
  info: PlanOk["feed"],
  options: PlanOk["options"],
  walkOnly: PlanOk["walkOnly"],
  maxTransfers: 1 | 2 = req.maxTransfers ?? 1,
  raised = false,
): PlanOk {
  return {
    ok: true,
    options,
    walkOnly,
    dayType: req.dayType ?? dayTypeOf(req.date),
    maxTransfers,
    raised,
    feed: info,
    attribution: ATTRIBUTION,
  };
}

/**
 * On-foot minutes from the origin to each candidate stop and from each candidate stop to
 * the destination, in one OpenRouteService matrix call (SPEC §15). Null when the service
 * does not answer: the straight-line estimate stands.
 */
async function walkingTimes(
  key: string,
  from: Coords,
  to: Coords,
  net: Parameters<typeof endpoints>[0],
  ends: ReturnType<typeof endpoints>,
): Promise<{ in: Map<number, number>; out: Map<number, number> } | null> {
  const stops = [...ends.origin, ...ends.dest].map((e) => net.stops[e.stop] as Coords);
  const locations = [from, to, ...stops].map((p) => [p.lon, p.lat]);
  const nOrigin = ends.origin.length;
  const sources = [0, ...ends.dest.map((_, i) => 2 + nOrigin + i)];
  const destinations = [...ends.origin.map((_, i) => 2 + i), 1];
  try {
    const res = await fetch(ORS_FOOT, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ locations, sources, destinations, metrics: ["duration"] }),
    });
    if (!res.ok) return null;
    const { durations } = (await res.json()) as { durations?: (number | null)[][] };
    if (!durations) return null;
    const inn = new Map<number, number>();
    const out = new Map<number, number>();
    ends.origin.forEach((e, i) => {
      const s = durations[0]?.[i];
      if (typeof s === "number") inn.set(e.stop, s / 60);
    });
    ends.dest.forEach((e, i) => {
      const s = durations[1 + i]?.[nOrigin];
      if (typeof s === "number") out.set(e.stop, s / 60);
    });
    return { in: inn, out };
  } catch {
    return null;
  }
}

/**
 * The JSON body, {} when it is missing or not JSON, or null when it is over `MAX_BODY`:
 * read as a stream and cut off at the limit, so a body without a content-length is not
 * buffered whole.
 */
async function smallBody(req: Request): Promise<Record<string, unknown> | null> {
  if (!req.headers.get("content-type")?.includes("json") || !req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/** The weekly refresh, called by the database with its cron key (like /api/cron). */
async function runImport(req: Request, env: Env): Promise<Response> {
  if (missing(env).length) return json({ error: "server_not_configured" }, 503);
  const admin = adminClient(env);
  const key = req.headers.get("x-cron-key") ?? "";
  const { data: ok } = await admin.rpc("check_cron_key", { p_key: key });
  if (!key || !ok) return json({ error: "unauthorized" }, 401);
  const body = await smallBody(req);
  if (body === null) return fail("bad_request", 413);
  const only: Source[] =
    body.source === "stm" || body.source === "dnt" ? [body.source] : ["dnt", "stm"];
  const results = [];
  for (const source of only) {
    const r = await importSource(admin, source);
    if (!r.ok) {
      console.error("transit import", source, r.error);
      await report(env, new Error(`transit_import_${source}: ${r.error}`), "transit-import");
    }
    results.push(r);
  }
  return json({ ok: results.every((r) => r.ok), results });
}
