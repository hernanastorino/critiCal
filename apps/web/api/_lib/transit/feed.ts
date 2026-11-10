// The compact schedule both sources are turned into, and how it is stored.
//
// A raw feed lists every stop pass of every trip (2.3 million rows for Montevideo).
// Almost all trips of a line repeat the same times shifted by their departure, so a
// feed keeps each distinct "pattern" (stop sequence + minutes from departure) once
// and, per day type, only the departure times that run it.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { DayType } from "../../../src/transit.js";

export type { DayType };
export type Source = "stm" | "dnt";

export interface FeedStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface FeedRoute {
  /** What the bus shows ("402", "6R6"). */
  line: string;
  /** Where it is heading. */
  head: string;
  company: string | null;
}

export interface FeedPattern {
  /** Index into `routes`. */
  route: number;
  /** Stop indexes in riding order. */
  seq: number[];
  /** Minutes from the departure to the pass at each stop (same length as `seq`). */
  off: number[];
}

export interface FeedDeps {
  /** Index into `patterns`. */
  p: number;
  d: DayType;
  /** First and last day (YYYYMMDD) the schedule runs, when the source says. */
  from: number | null;
  to: number | null;
  /** Departures as minutes since 00:00 of the service day (may pass 1440), ascending. */
  t: number[];
}

export interface Feed {
  source: Source;
  /** Hash of the schedules: the app compares it to tell when they changed. */
  version: string;
  /** Last day the schedules cover (YYYY-MM-DD), when known. */
  validTo: string | null;
  stops: FeedStop[];
  routes: FeedRoute[];
  patterns: FeedPattern[];
  deps: FeedDeps[];
}

/** Collects patterns and departures while a parser reads its source. */
export class FeedBuilder {
  readonly stops: FeedStop[] = [];
  readonly routes: FeedRoute[] = [];
  readonly patterns: FeedPattern[] = [];
  private readonly stopAt = new Map<string, number>();
  private readonly routeAt = new Map<string, number>();
  private readonly patternAt = new Map<string, number>();
  private readonly depsAt = new Map<string, FeedDeps>();
  readonly deps: FeedDeps[] = [];

  stop(s: FeedStop): number {
    let i = this.stopAt.get(s.id);
    if (i === undefined) {
      i = this.stops.length;
      this.stops.push({ ...s, lat: round5(s.lat), lon: round5(s.lon) });
      this.stopAt.set(s.id, i);
    }
    return i;
  }

  hasStop(id: string): boolean {
    return this.stopAt.has(id);
  }

  route(r: FeedRoute): number {
    const key = `${r.line}|${r.head}|${r.company ?? ""}`;
    let i = this.routeAt.get(key);
    if (i === undefined) {
      i = this.routes.length;
      this.routes.push(r);
      this.routeAt.set(key, i);
    }
    return i;
  }

  /** Records one trip: its pattern (deduplicated) and its departure. */
  trip(
    route: number,
    seq: number[],
    off: number[],
    day: DayType,
    depart: number,
    range: { from: number | null; to: number | null } = { from: null, to: null },
  ): void {
    const key = `${route}|${seq.join(",")}|${off.join(",")}`;
    let p = this.patternAt.get(key);
    if (p === undefined) {
      p = this.patterns.length;
      this.patterns.push({ route, seq, off });
      this.patternAt.set(key, p);
    }
    const dkey = `${p}|${day}|${range.from}|${range.to}`;
    let d = this.depsAt.get(dkey);
    if (!d) {
      d = { p, d: day, from: range.from, to: range.to, t: [] };
      this.depsAt.set(dkey, d);
      this.deps.push(d);
    }
    d.t.push(depart);
  }

  /** The feed; its version is a hash of the schedules, so it changes only when they do. */
  build(source: Source, validTo: string | null): Feed {
    for (const d of this.deps) {
      d.t.sort((a, b) => a - b);
      // The same departure listed twice (two services) would show as two buses.
      d.t = d.t.filter((t, i) => i === 0 || t !== d.t[i - 1]);
    }
    const feed: Feed = {
      source,
      version: "",
      validTo,
      stops: this.stops,
      routes: this.routes,
      patterns: this.patterns,
      deps: this.deps,
    };
    feed.version = createHash("sha256")
      .update(JSON.stringify(pack(feed)))
      .digest("hex")
      .slice(0, 12);
    return feed;
  }
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Rows as arrays, not objects: the stored feed is a few MB instead of tens. */
interface Packed {
  v: 1;
  source: Source;
  version?: string;
  validTo: string | null;
  stops: [string, string, number, number][];
  routes: [string, string, string | null][];
  patterns: [number, number[], number[]][];
  deps: [number, number, number | null, number | null, number[]][];
}

function pack(feed: Feed): Packed {
  return {
    v: 1,
    source: feed.source,
    validTo: feed.validTo,
    stops: feed.stops.map((s) => [s.id, s.name, s.lat, s.lon]),
    routes: feed.routes.map((r) => [r.line, r.head, r.company]),
    patterns: feed.patterns.map((p) => [p.route, p.seq, p.off]),
    deps: feed.deps.map((d) => [d.p, d.d, d.from, d.to, d.t]),
  };
}

/** The feed as gzip+base64 text, the form it is stored in. */
export function encodeFeed(feed: Feed): string {
  const body = JSON.stringify({ ...pack(feed), version: feed.version });
  return gzipSync(body, { level: 9 }).toString("base64");
}

export function decodeFeed(payload: string): Feed {
  const packed = JSON.parse(gunzipSync(Buffer.from(payload, "base64")).toString("utf8")) as Packed;
  if (packed.v !== 1) throw new Error("feed_version_unsupported");
  return {
    source: packed.source,
    version: packed.version ?? "",
    validTo: packed.validTo,
    stops: packed.stops.map(([id, name, lat, lon]) => ({ id, name, lat, lon })),
    routes: packed.routes.map(([line, head, company]) => ({ line, head, company })),
    patterns: packed.patterns.map(([route, seq, off]) => ({ route, seq, off })),
    deps: packed.deps.map(([p, d, from, to, t]) => ({ p, d: d as DayType, from, to, t })),
  };
}
