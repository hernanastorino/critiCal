// Vercel function (Node): driving times between the caller's saved places.
// 1. geocodes places that have an address but no coordinates (Nominatim, once each),
// 2. asks OpenRouteService for the driving-time matrix between all located places,
// 3. stores the times, never touching pairs the user set by hand.
import { report } from "./_lib/report.js";
import { authenticate, type Env, json, readEnv } from "./_lib/server.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const ORS = "https://api.openrouteservice.org/v2/matrix/driving-car";
/** Nominatim's usage policy: an identifying agent, at most one request per second. */
const AGENT = "critiCal/1.0 (+https://critical-cal.vercel.app)";

interface PlaceRow {
  id: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const q = new URLSearchParams({ q: address, format: "jsonv2", limit: "1" });
  const res = await fetch(`${NOMINATIM}?${q}`, {
    headers: { "User-Agent": AGENT, "Accept-Language": "es" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const [hit] = (await res.json()) as { lat: string; lon: string }[];
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
}

/** Driving minutes between every pair, rounded up; null where there is no route. */
export async function drivingMatrix(
  key: string,
  points: { lat: number; lon: number }[],
): Promise<(number | null)[][]> {
  const res = await fetch(ORS, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ locations: points.map((p) => [p.lon, p.lat]), metrics: ["duration"] }),
  });
  if (!res.ok) throw new Error(`ors_${res.status}`);
  const { durations } = (await res.json()) as { durations: (number | null)[][] };
  return durations.map((row) => row.map((s) => (s == null ? null : Math.ceil(s / 60))));
}

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

export async function handle(req: Request, env: Env, pause = wait): Promise<Response> {
  const caller = await authenticate(req, env, ["orsKey"]);
  if (caller instanceof Response) return caller;
  const { user } = caller;
  try {
    const { data, error } = await user.from("places").select("id, address, lat, lon");
    if (error) throw error;
    const places = (data ?? []) as PlaceRow[];
    let geocoded = 0;
    let first = true;
    for (const p of places) {
      if (p.lat != null || !p.address?.trim()) continue;
      if (!first) await pause(1100);
      first = false;
      const hit = await geocode(p.address);
      if (!hit) continue;
      const { error: updateError } = await user.from("places").update(hit).eq("id", p.id);
      if (updateError) throw updateError;
      Object.assign(p, hit);
      geocoded++;
    }
    const located = places.filter((p) => p.lat != null && p.lon != null);
    if (located.length < 2) return json({ ok: true, geocoded, pairs: 0 });

    const matrix = await drivingMatrix(
      env.orsKey as string,
      located.map((p) => ({ lat: p.lat as number, lon: p.lon as number })),
    );
    const { data: manualRows, error: manualError } = await user
      .from("travel_times")
      .select("from_place, to_place")
      .eq("manual", true);
    // Without this list, manual times would be overwritten.
    if (manualError) throw manualError;
    const manual = new Set((manualRows ?? []).map((r) => `${r.from_place}>${r.to_place}`));
    const rows = located.flatMap((from, i) =>
      located.flatMap((to, j) => {
        const minutes = matrix[i]?.[j];
        if (i === j || minutes == null || manual.has(`${from.id}>${to.id}`)) return [];
        return [{ from_place: from.id, to_place: to.id, minutes, manual: false }];
      }),
    );
    // No route any more: an old computed time would still be planned around. The app
    // asks for these by hand (an unknown time counts as zero minutes).
    const unroutable: { from: string; to: string }[] = [];
    for (const [i, from] of located.entries()) {
      for (const [j, to] of located.entries()) {
        if (i === j || matrix[i]?.[j] != null || manual.has(`${from.id}>${to.id}`)) continue;
        unroutable.push({ from: from.id, to: to.id });
        const { error: deleteError } = await user
          .from("travel_times")
          .delete()
          .eq("from_place", from.id)
          .eq("to_place", to.id)
          .eq("manual", false);
        if (deleteError) throw deleteError;
      }
    }
    if (rows.length) {
      const { error: writeError } = await user.from("travel_times").upsert(rows);
      if (writeError) throw writeError;
    }
    return json({ ok: true, geocoded, pairs: rows.length, unroutable });
  } catch (e) {
    console.error(e);
    await report(env, e, "travel");
    return json({ ok: false, error: "travel_failed" }, 500);
  }
}
