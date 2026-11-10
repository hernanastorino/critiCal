// The metropolitan lines (Canelones, San José, Montevideo) from the national transport
// directorate's GTFS (agency, routes, calendar, trips, stops, stop_times). Times of
// stops without their own (GTFS allows blanks) are interpolated along the trip.
// Licence: Licencia de Datos Abiertos de Uruguay (attribution), see docs/OPERATIONS.md.
import { type DayType, type Feed, FeedBuilder } from "./feed.js";

export interface GtfsFiles {
  agency: string;
  routes: string;
  calendar: string;
  trips: string;
  stops: string;
  stopTimes: string;
}

/** Rows of a GTFS CSV by header name. Handles quoted fields and doubled quotes. */
export function* csvRows(text: string): Generator<Record<string, string>> {
  let at = 0;
  let head: string[] | null = null;
  const n = text.length;
  while (at < n) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = n;
    let line = text.slice(at, end);
    at = end + 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line) continue;
    const cells: string[] = [];
    if (!line.includes('"')) cells.push(...line.split(","));
    else {
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") {
          cells.push(cell);
          cell = "";
        } else cell += ch;
      }
      cells.push(cell);
    }
    if (!head) {
      head = cells.map((h) => h.replace(/^﻿/, "").trim());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < head.length; i++) row[head[i] as string] = (cells[i] ?? "").trim();
    yield row;
  }
}

/** "HH:MM:SS" (hours may pass 24) as minutes, or null when blank. */
function minutes(time: string | undefined): number | null {
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(time ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) + (Number(m[3] ?? 0) >= 30 ? 1 : 0) : null;
}

const date8 = (s: string | undefined) => (/^\d{8}$/.test(s ?? "") ? Number(s) : null);

export interface GtfsStats {
  trips: number;
  skippedTrips: number;
}

export function parseGtfs(files: GtfsFiles): { feed: Feed; stats: GtfsStats } {
  const b = new FeedBuilder();
  const agencies = new Map<string, string>();
  for (const r of csvRows(files.agency)) agencies.set(r.agency_id ?? "", r.agency_name ?? "");

  const routeOf = new Map<string, number>();
  for (const r of csvRows(files.routes)) {
    const long = r.route_long_name ?? "";
    // "MDEO./SAUCE (x 6,33,17m)": the heading is what follows the slash.
    const head = /\/\s*([^(]+?)\s*(?:\(|$)/.exec(long)?.[1] ?? long;
    routeOf.set(
      r.route_id ?? "",
      b.route({
        line: r.route_short_name || r.route_id || "?",
        head,
        company: agencies.get(r.agency_id ?? "") || null,
      }),
    );
  }

  // A service can run on several day types; each gets its own departures.
  const services = new Map<string, { days: DayType[]; from: number | null; to: number | null }>();
  for (const r of csvRows(files.calendar)) {
    const days: DayType[] = [];
    if (["monday", "tuesday", "wednesday", "thursday", "friday"].some((d) => r[d] === "1"))
      days.push(1);
    if (r.saturday === "1") days.push(2);
    if (r.sunday === "1") days.push(3);
    services.set(r.service_id ?? "", {
      days,
      from: date8(r.start_date),
      to: date8(r.end_date),
    });
  }
  let latest = 0;
  for (const s of services.values()) if (s.to && s.to > latest) latest = s.to;

  const tripOf = new Map<string, { route: number; service: string }>();
  for (const r of csvRows(files.trips)) {
    const route = routeOf.get(r.route_id ?? "");
    if (route !== undefined) tripOf.set(r.trip_id ?? "", { route, service: r.service_id ?? "" });
  }

  const stopRows = new Map<string, { name: string; lat: number; lon: number }>();
  for (const r of csvRows(files.stops)) {
    const lat = Number(r.stop_lat);
    const lon = Number(r.stop_lon);
    if (r.stop_lat && r.stop_lon && Number.isFinite(lat) && Number.isFinite(lon))
      stopRows.set(r.stop_id ?? "", { name: r.stop_name ?? "", lat, lon });
  }

  let trips = 0;
  let skipped = 0;
  const finish = (tripId: string, rows: { stop: string; seq: number; time: number | null }[]) => {
    const trip = tripOf.get(tripId);
    const service = trip ? services.get(trip.service) : undefined;
    if (!trip || !service?.days.length) return void skipped++;
    rows.sort((a, c) => a.seq - c.seq);
    // Fill blanks by interpolating between the timed stops around them.
    const times = rows.map((r) => r.time);
    for (let i = 0; i < times.length; i++) {
      if (times[i] != null) continue;
      let lo = i - 1;
      while (lo >= 0 && times[lo] == null) lo--;
      let hi = i + 1;
      while (hi < times.length && times[hi] == null) hi++;
      const a = times[lo];
      const z = times[hi];
      if (a != null && z != null) times[i] = Math.round(a + ((z - a) * (i - lo)) / (hi - lo));
    }
    const seq: number[] = [];
    const rel: number[] = [];
    let start: number | null = null;
    for (const [i, row] of rows.entries()) {
      const at = stopRows.get(row.stop);
      const t = times[i];
      if (!at || t == null) continue;
      start ??= t;
      seq.push(b.stop({ id: row.stop, name: at.name, lat: at.lat, lon: at.lon }));
      rel.push(Math.max(t - start, rel[rel.length - 1] ?? 0));
    }
    if (start == null || seq.length < 2) return void skipped++;
    trips++;
    for (const day of service.days)
      b.trip(trip.route, seq, rel, day, start, { from: service.from, to: service.to });
  };

  let current = "";
  let rows: { stop: string; seq: number; time: number | null }[] = [];
  const seen = new Set<string>();
  for (const r of csvRows(files.stopTimes)) {
    const id = r.trip_id ?? "";
    if (id !== current) {
      if (rows.length) finish(current, rows);
      if (seen.has(id)) throw new Error("gtfs_rows_not_contiguous");
      seen.add(id);
      current = id;
      rows = [];
    }
    rows.push({
      stop: r.stop_id ?? "",
      seq: Number(r.stop_sequence),
      time: minutes(r.departure_time) ?? minutes(r.arrival_time),
    });
  }
  if (rows.length) finish(current, rows);

  const validTo = latest
    ? `${String(latest).slice(0, 4)}-${String(latest).slice(4, 6)}-${String(latest).slice(6)}`
    : null;
  return { feed: b.build("dnt", validTo), stats: { trips, skippedTrips: skipped } };
}
