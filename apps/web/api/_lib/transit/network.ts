// The two feeds as one searchable network, and the search itself: the earliest way to
// get between two points by bus with at most one transfer (SPEC §15, decided: direct or
// one transfer, stops within 900 m on foot, 5 min margin per transfer, 3 options).
import type { BusLeg, BusStop, Coords, DayType, Leg, TransitOption } from "../../../src/transit.js";
import type { Feed, Source } from "./feed.js";
import { haversine, walkMinutes } from "./geo.js";

/** Farthest a stop can be and still be walked to from the origin or to the destination. */
export const MAX_WALK_M = 900;
/** Candidate stops kept at each end (the nearest). */
export const MAX_STOPS_PER_END = 14;
/** Longest walk between two stops to change bus. */
export const MAX_TRANSFER_M = 250;
/** Extra minutes kept at every transfer, on top of the walk. */
export const TRANSFER_MARGIN = 5;
/** Options returned. */
export const MAX_OPTIONS = 3;
/** Each transfer counts as this many minutes when ranking (not when reporting times). */
const TRANSFER_PENALTY = 4;
/** How far ahead of the ready time a journey may end. */
const HORIZON = 300;

interface NetStop extends BusStop {
  src: Source;
}

interface NetPattern {
  src: Source;
  head: string;
  line: string;
  company: string | null;
  seq: Int32Array;
  off: Int32Array;
}

interface Dep {
  p: number;
  d: DayType;
  from: number | null;
  to: number | null;
  t: number[];
}

export interface Network {
  stops: NetStop[];
  patterns: NetPattern[];
  /** CSR: for stop s, entries `[pattern, indexInPattern]` at `atIdx[s]..atIdx[s+1]`. */
  atIdx: Int32Array;
  atList: Int32Array;
  deps: Dep[];
  grid: Map<number, number[]>;
  versions: Record<string, string>;
}

const CELL = 0.005;
const cellKey = (lat: number, lon: number) =>
  Math.floor(lat / CELL) * 100_000 + Math.floor(lon / CELL);

/** Joins feeds (each keeps its own stops: the sources' ids are unrelated). */
export function buildNetwork(feeds: Feed[]): Network {
  const stops: NetStop[] = [];
  const patterns: NetPattern[] = [];
  const deps: Dep[] = [];
  const versions: Record<string, string> = {};
  for (const feed of feeds) {
    versions[feed.source] = feed.version;
    const stopBase = stops.length;
    for (const s of feed.stops) stops.push({ ...s, src: feed.source });
    const patBase = patterns.length;
    for (const p of feed.patterns) {
      const route = feed.routes[p.route];
      patterns.push({
        src: feed.source,
        line: route?.line ?? "?",
        head: route?.head ?? "",
        company: route?.company ?? null,
        seq: Int32Array.from(p.seq, (i) => i + stopBase),
        off: Int32Array.from(p.off),
      });
    }
    for (const d of feed.deps) deps.push({ ...d, p: d.p + patBase });
  }
  const count = new Int32Array(stops.length + 1);
  for (const p of patterns) for (const s of p.seq) count[s + 1] = (count[s + 1] ?? 0) + 1;
  for (let i = 1; i < count.length; i++) count[i] = (count[i] ?? 0) + (count[i - 1] ?? 0);
  const fill = count.slice();
  const atList = new Int32Array((count[stops.length] ?? 0) * 2);
  patterns.forEach((p, pi) => {
    p.seq.forEach((s, i) => {
      const at = (fill[s] ?? 0) * 2;
      fill[s] = (fill[s] ?? 0) + 1;
      atList[at] = pi;
      atList[at + 1] = i;
    });
  });
  const grid = new Map<number, number[]>();
  stops.forEach((s, i) => {
    const k = cellKey(s.lat, s.lon);
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
  });
  return { stops, patterns, atIdx: count, atList, deps, grid, versions };
}

const yyyymmdd = (date: string) => Number(date.replaceAll("-", ""));

/** Departures per pattern for one date, in that date's clock (sorted). */
export interface Schedule {
  deps: Int32Array[];
}

/**
 * The departures that run on `date`: that day's own (service clock as is) and the day
 * before's that run past midnight (1440 earlier). `today` and `yesterday` are the
 * day types the schedules are read for.
 */
export function scheduleFor(
  net: Network,
  date: string,
  today: DayType,
  yesterday: DayType,
  previousDate: string,
): Schedule {
  const day = yyyymmdd(date);
  const before = yyyymmdd(previousDate);
  const lists: number[][] = net.patterns.map(() => []);
  const within = (d: Dep, on: number) =>
    (d.from == null || d.from <= on) && (d.to == null || d.to >= on);
  for (const d of net.deps) {
    const list = lists[d.p];
    if (!list) continue;
    if (d.d === today && within(d, day)) for (const t of d.t) list.push(t);
    // Yesterday's trips that run past midnight; earlier ones are over.
    if (d.d === yesterday && within(d, before))
      for (const t of d.t) if (t >= 1440) list.push(t - 1440);
  }
  return { deps: lists.map((l) => Int32Array.from(l.sort((a, b) => a - b))) };
}

/** Index of the first value ≥ x in a sorted array, or its length. */
function lowerBound(a: Int32Array, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Endpoint {
  stop: number;
  minutes: number;
  meters: number;
  /** True when `minutes` came from a walking route, not the estimate. */
  routed: boolean;
}

/** The stops nearest to a point within `MAX_WALK_M`, nearest first. */
export function stopsNear(
  net: Network,
  at: Coords,
  maxM = MAX_WALK_M,
  limit = MAX_STOPS_PER_END,
): Endpoint[] {
  const dLat = Math.ceil(maxM / 111_000 / CELL);
  const dLon = Math.ceil(maxM / 91_000 / CELL);
  const found: Endpoint[] = [];
  const baseLat = Math.floor(at.lat / CELL);
  const baseLon = Math.floor(at.lon / CELL);
  for (let i = -dLat; i <= dLat; i++) {
    for (let j = -dLon; j <= dLon; j++) {
      for (const s of net.grid.get((baseLat + i) * 100_000 + baseLon + j) ?? []) {
        const stop = net.stops[s] as NetStop;
        const meters = haversine(at, stop);
        if (meters <= maxM)
          found.push({ stop: s, meters, minutes: walkMinutes(meters), routed: false });
      }
    }
  }
  return found.sort((a, b) => a.meters - b.meters).slice(0, limit);
}

interface Candidate {
  arrive: number;
  leave: number;
  chain: string;
  inn: Endpoint;
  out: Endpoint;
  a: { p: number; i: number; j: number; dep: number };
  b?: { p: number; i: number; j: number; dep: number; wait: number; walk: number; meters: number };
}

export interface SearchInput {
  /** Only the earliest arrival matters (the bisection): prunes harder. */
  earliestOnly?: boolean;
  origin: Endpoint[];
  dest: Endpoint[];
  schedule: Schedule;
  /** Earliest minute (of the date's clock) the traveler can set off. */
  ready: number;
}

interface Search {
  best: Candidate[];
  /** Earliest arrival among all journeys, or Infinity. */
  earliest: number;
}

/** First departure of pattern `p` that reaches index `i` at or after `at`, or null. */
function nextDep(net: Network, sched: Schedule, p: number, i: number, at: number): number | null {
  const deps = sched.deps[p] as Int32Array;
  const off = (net.patterns[p] as NetPattern).off[i] as number;
  const k = lowerBound(deps, at - off);
  return k < deps.length ? (deps[k] as number) : null;
}

/** Stops within walking distance of each stop, kept for as long as the network lives. */
const nearCache = new WeakMap<Network, Map<number, { stop: number; meters: number }[]>>();
/** Journeys arriving this much later than the earliest are not worth listing. */
const SLACK = 45;

export function search(net: Network, input: SearchInput): Search {
  const { origin, dest, schedule, ready, earliestOnly } = input;
  const limit = ready + HORIZON;
  const destAt = new Map<number, Endpoint>();
  for (const d of dest) destAt.set(d.stop, d);
  // For each pattern that serves a destination stop: those indexes, in order.
  const destIdx = new Map<number, { i: number; end: Endpoint }[]>();
  for (const d of dest) {
    for (let e = net.atIdx[d.stop] as number; e < (net.atIdx[d.stop + 1] as number); e++) {
      const p = net.atList[e * 2] as number;
      const list = destIdx.get(p) ?? [];
      list.push({ i: net.atList[e * 2 + 1] as number, end: d });
      destIdx.set(p, list);
    }
  }
  let near = nearCache.get(net);
  if (!near) {
    near = new Map();
    nearCache.set(net, near);
  }
  const nearOf = (s: number) => {
    let list = (near as Map<number, { stop: number; meters: number }[]>).get(s);
    if (!list) {
      const here = net.stops[s] as NetStop;
      list = stopsNear(net, here, MAX_TRANSFER_M, 8).map((e) => ({
        stop: e.stop,
        meters: e.meters,
      }));
      if (!list.some((n) => n.stop === s)) list.push({ stop: s, meters: 0 });
      (near as Map<number, { stop: number; meters: number }[]>).set(s, list);
    }
    return list;
  };

  const bestByChain = new Map<string, Candidate>();
  let earliest = Number.POSITIVE_INFINITY;
  const offer = (c: Candidate) => {
    if (c.arrive > limit) return;
    if (c.arrive < earliest) earliest = c.arrive;
    const old = bestByChain.get(c.chain);
    if (!old || c.arrive < old.arrive || (c.arrive === old.arrive && c.leave > old.leave))
      bestByChain.set(c.chain, c);
  };

  for (const inn of origin) {
    const readyAtStop = ready + inn.minutes;
    for (let e = net.atIdx[inn.stop] as number; e < (net.atIdx[inn.stop + 1] as number); e++) {
      const p = net.atList[e * 2] as number;
      const i = net.atList[e * 2 + 1] as number;
      const pat = net.patterns[p] as NetPattern;
      const dep = nextDep(net, schedule, p, i, readyAtStop);
      if (dep == null) continue;
      const boardAt = dep + (pat.off[i] as number);
      for (let j = i + 1; j < pat.seq.length; j++) {
        const stopJ = pat.seq[j] as number;
        const arrJ = dep + (pat.off[j] as number);
        // Nothing from here on can beat what is already found (or come close, in the full search).
        if (arrJ > limit || arrJ >= earliest + (earliestOnly ? 0 : SLACK)) break;
        const direct = destAt.get(stopJ);
        if (direct && stopJ !== inn.stop)
          offer({
            arrive: arrJ + direct.minutes,
            leave: boardAt - inn.minutes,
            chain: `${pat.src}${pat.line}`,
            inn,
            out: direct,
            a: { p, i, j, dep },
          });
        for (const n of nearOf(stopJ)) {
          const walk = n.meters === 0 ? 0 : walkMinutes(n.meters);
          const r2 = arrJ + walk + TRANSFER_MARGIN;
          for (let f = net.atIdx[n.stop] as number; f < (net.atIdx[n.stop + 1] as number); f++) {
            const q = net.atList[f * 2] as number;
            const targets = destIdx.get(q);
            if (!targets) continue;
            const qat = net.patterns[q] as NetPattern;
            // Same line again is not a transfer.
            if (qat.line === pat.line && qat.src === pat.src) continue;
            const m = net.atList[f * 2 + 1] as number;
            const dep2 = nextDep(net, schedule, q, m, r2);
            if (dep2 == null) continue;
            for (const t of targets) {
              if (t.i <= m) continue;
              const arrive = dep2 + (qat.off[t.i] as number) + t.end.minutes;
              if (arrive <= arrJ) continue;
              offer({
                arrive,
                leave: boardAt - inn.minutes,
                chain: `${pat.src}${pat.line}>${qat.src}${qat.line}`,
                inn,
                out: t.end,
                a: { p, i, j, dep },
                b: {
                  p: q,
                  i: m,
                  j: t.i,
                  dep: dep2,
                  wait: dep2 + (qat.off[m] as number) - (arrJ + walk),
                  walk,
                  meters: n.meters,
                },
              });
            }
          }
        }
      }
    }
  }
  const best = [...bestByChain.values()].sort((x, y) => score(x) - score(y) || y.leave - x.leave);
  return { best, earliest };
}

const score = (c: Candidate) => c.arrive + (c.b ? TRANSFER_PENALTY : 0);

function stopOf(net: Network, i: number): BusStop {
  const s = net.stops[i] as NetStop;
  return { id: `${s.src}:${s.id}`, name: s.name, lat: s.lat, lon: s.lon };
}

/** A found journey as the legs the app shows. */
export function toOption(net: Network, c: Candidate): TransitOption {
  const legs: Leg[] = [];
  const ride = (r: { p: number; i: number; j: number; dep: number }, wait: number): BusLeg => {
    const pat = net.patterns[r.p] as NetPattern;
    return {
      kind: "bus",
      line: pat.line,
      headsign: pat.head,
      company: pat.company,
      source: pat.src,
      board: stopOf(net, pat.seq[r.i] as number),
      alight: stopOf(net, pat.seq[r.j] as number),
      boardMin: r.dep + (pat.off[r.i] as number),
      alightMin: r.dep + (pat.off[r.j] as number),
      stops: r.j - r.i,
      waitMinutes: wait,
      theoretical: true,
    };
  };
  const first = ride(c.a, 0);
  legs.push({
    kind: "walk",
    minutes: c.inn.minutes,
    meters: Math.round(c.inn.meters),
    source: c.inn.routed ? "route" : "estimate",
    to: first.board,
  });
  legs.push(first);
  let last = first;
  if (c.b) {
    const second = ride(c.b, c.b.wait + c.b.walk);
    if (c.b.walk > 0)
      legs.push({
        kind: "walk",
        minutes: c.b.walk,
        meters: Math.round(c.b.meters),
        source: "estimate",
        from: first.alight,
        to: second.board,
      });
    legs.push(second);
    last = second;
  }
  legs.push({
    kind: "walk",
    minutes: c.out.minutes,
    meters: Math.round(c.out.meters),
    source: c.out.routed ? "route" : "estimate",
    from: last.alight,
  });
  const buses = legs.filter((l): l is BusLeg => l.kind === "bus");
  const walk = legs.reduce((n, l) => n + (l.kind === "walk" ? l.minutes : 0), 0);
  const ridden = buses.reduce((n, l) => n + (l.alightMin - l.boardMin), 0);
  const wait = buses.reduce((n, l) => n + l.waitMinutes, 0);
  return {
    leaveMin: c.leave,
    arriveMin: c.arrive,
    totalMinutes: c.arrive - c.leave,
    walkMinutes: walk,
    waitMinutes: wait,
    rideMinutes: ridden,
    transfers: buses.length - 1,
    legs,
    theoretical: buses.some((l) => l.theoretical),
  };
}

export interface PlanInput {
  from: Coords;
  to: Coords;
  mode: "arrive" | "depart";
  /** Minutes of the date's clock: the arrival deadline or the departure time. */
  at: number;
  schedule: Schedule;
  /** Walking times from the routing service, by stop index, replacing the estimate. */
  routedIn?: Map<number, number>;
  routedOut?: Map<number, number>;
}

/** Candidate stops at both ends (so the caller can ask for their real walking times). */
export function endpoints(net: Network, from: Coords, to: Coords) {
  return { origin: stopsNear(net, from), dest: stopsNear(net, to) };
}

const withRouted = (list: Endpoint[], routed?: Map<number, number>): Endpoint[] =>
  routed
    ? list.map((e) => {
        const minutes = routed.get(e.stop);
        return minutes == null
          ? e
          : { ...e, minutes: Math.max(1, Math.ceil(minutes)), routed: true };
      })
    : list;

/** The best options between two points, or none if no bus gets there. */
export function plan(
  net: Network,
  input: PlanInput,
  ends = endpoints(net, input.from, input.to),
): TransitOption[] {
  const origin = withRouted(ends.origin, input.routedIn);
  const dest = withRouted(ends.dest, input.routedOut);
  if (!origin.length || !dest.length) return [];
  const run = (ready: number, earliestOnly = false) =>
    search(net, { origin, dest, schedule: input.schedule, ready, earliestOnly });
  let found: Candidate[];
  if (input.mode === "depart") {
    found = run(input.at).best;
  } else {
    // The earliest arrival never gets better by leaving later, so the latest ready time
    // that still arrives in time can be found by bisection.
    let lo = input.at - HORIZON;
    let hi = input.at;
    if (run(lo, true).earliest > input.at) return [];
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (run(mid, true).earliest <= input.at) lo = mid;
      else hi = mid - 1;
    }
    found = run(lo).best.filter((c) => c.arrive <= input.at);
  }
  return found.slice(0, MAX_OPTIONS).map((c) => toOption(net, c));
}
