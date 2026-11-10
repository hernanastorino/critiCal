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
    // Yesterday's trips still running after midnight: they leave late, or reach their last
    // stop after it. A negative departure still works: stop passes add the offset.
    if (d.d === yesterday && within(d, before)) {
      const last = net.patterns[d.p]?.off.at(-1) ?? 0;
      for (const t of d.t) if (t + last >= 1440) list.push(t - 1440);
    }
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

/** One bus ride of a journey: pattern `p` from index `i` to `j`, on the trip leaving at `dep`. */
interface Ride {
  p: number;
  i: number;
  j: number;
  dep: number;
}

interface Candidate {
  arrive: number;
  leave: number;
  /** The lines taken, in order (journeys with the same lines are the same option). */
  chain: string;
  inn: Endpoint;
  out: Endpoint;
  rides: Ride[];
  /** Walk between rides `n` and `n + 1`. */
  changes: { walk: number; meters: number }[];
}

export interface SearchInput {
  /** Only the earliest arrival matters (the bisection): prunes harder. */
  earliestOnly?: boolean;
  origin: Endpoint[];
  dest: Endpoint[];
  schedule: Schedule;
  /** Earliest minute (of the date's clock) the traveler can set off. */
  ready: number;
  /** Most transfers allowed: 0, 1 or 2 (one search round per bus taken). */
  maxTransfers: number;
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
const INF = 1 << 30;

/**
 * Earliest arrival by rounds, one per bus taken (RAPTOR): round k holds, for every stop,
 * the earliest a traveler can get off at it on their k-th bus. Allowing one more transfer
 * is one more round, not another nested loop.
 */
export function search(net: Network, input: SearchInput): Search {
  const { origin, dest, schedule, ready, earliestOnly, maxTransfers } = input;
  const nStops = net.stops.length;
  const limit = ready + HORIZON;
  let near = nearCache.get(net);
  if (!near) {
    near = new Map();
    nearCache.set(net, near);
  }
  const cache = near;
  const nearOf = (s: number) => {
    let list = cache.get(s);
    if (!list) {
      const here = net.stops[s] as NetStop;
      list = stopsNear(net, here, MAX_TRANSFER_M, 8).map((e) => ({
        stop: e.stop,
        meters: e.meters,
      }));
      if (!list.some((n) => n.stop === s)) list.push({ stop: s, meters: 0 });
      cache.set(s, list);
    }
    return list;
  };
  const destAt = new Map<number, Endpoint>();
  for (const d of dest) destAt.set(d.stop, d);

  const rounds = maxTransfers + 1;
  // Per round: arrival at each stop by that round's ride, and how (the ride and the stop
  // the traveler boarded it at, which says how they got there).
  const arrive: Int32Array[] = [];
  const rideOf: (Ride | undefined)[][] = [];
  // Per round: when the traveler can board at each stop, and where from.
  const boardAt: Int32Array[] = [];
  const boardFrom: { stop: number; walk: number; meters: number }[][] = [];

  let readyAt = new Int32Array(nStops).fill(INF);
  let from: { stop: number; walk: number; meters: number }[] = [];
  let marked: number[] = [];
  for (const o of origin) {
    const t = ready + o.minutes;
    if (t < (readyAt[o.stop] as number)) {
      if (readyAt[o.stop] === INF) marked.push(o.stop);
      readyAt[o.stop] = t;
      from[o.stop] = { stop: -1, walk: o.minutes, meters: o.meters };
    }
  }

  let bestDest = INF;
  const best = new Int32Array(nStops).fill(INF);
  const found: { round: number; stop: number }[] = [];
  for (let k = 0; k < rounds && marked.length; k++) {
    boardAt.push(readyAt);
    boardFrom.push(from);
    // Patterns to scan: each from the earliest of the marked stops it serves.
    const scan = new Map<number, number>();
    for (const s of marked) {
      for (let e = net.atIdx[s] as number; e < (net.atIdx[s + 1] as number); e++) {
        const p = net.atList[e * 2] as number;
        const i = net.atList[e * 2 + 1] as number;
        const seen = scan.get(p);
        if (seen === undefined || i < seen) scan.set(p, i);
      }
    }
    const here = new Int32Array(nStops).fill(INF);
    const rides: (Ride | undefined)[] = [];
    const reached: number[] = [];
    const cutoff = earliestOnly ? bestDest : bestDest + SLACK;
    for (const [p, i0] of scan) {
      const pat = net.patterns[p] as NetPattern;
      let dep = -1;
      let boarded = 0;
      for (let j = i0; j < pat.seq.length; j++) {
        const s = pat.seq[j] as number;
        if (dep >= 0) {
          const a = dep + (pat.off[j] as number);
          if (a > limit || a >= cutoff) break;
          if (a < (best[s] as number)) {
            best[s] = a;
            if (here[s] === INF) reached.push(s);
            here[s] = a;
            rides[s] = { p, i: boarded, j, dep };
          }
        }
        const r = readyAt[s] as number;
        if (r < INF) {
          const d = nextDep(net, schedule, p, j, r);
          if (d != null && (dep < 0 || d < dep)) {
            dep = d;
            boarded = j;
          }
        }
      }
    }
    arrive.push(here);
    rideOf.push(rides);
    for (const s of reached) {
      const d = destAt.get(s);
      if (!d) continue;
      const total = (here[s] as number) + d.minutes;
      if (total < bestDest) bestDest = total;
      found.push({ round: k, stop: s });
    }
    // Walk to stops where the next bus can be boarded, with the transfer margin.
    readyAt = new Int32Array(nStops).fill(INF);
    from = [];
    marked = [];
    if (k + 1 < rounds) {
      for (const s of reached) {
        for (const n of nearOf(s)) {
          const walk = n.meters === 0 ? 0 : walkMinutes(n.meters);
          const t = (here[s] as number) + walk + TRANSFER_MARGIN;
          if (t < (readyAt[n.stop] as number)) {
            if (readyAt[n.stop] === INF) marked.push(n.stop);
            readyAt[n.stop] = t;
            from[n.stop] = { stop: s, walk, meters: n.meters };
          }
        }
      }
    }
  }

  // Rebuild each journey that ends at a destination stop, back through the rounds.
  const bestByChain = new Map<string, Candidate>();
  let earliest = Number.POSITIVE_INFINITY;
  for (const { round, stop } of found) {
    const out = destAt.get(stop) as Endpoint;
    const rides: Ride[] = [];
    const changes: { walk: number; meters: number }[] = [];
    let s = stop;
    let inn: Endpoint | undefined;
    for (let k = round; k >= 0; k--) {
      const ride = (rideOf[k] as (Ride | undefined)[])[s] as Ride;
      rides.unshift(ride);
      const boarded = (net.patterns[ride.p] as NetPattern).seq[ride.i] as number;
      const via = (boardFrom[k] as { stop: number; walk: number; meters: number }[])[boarded];
      if (!via) break;
      if (via.stop < 0) inn = origin.find((o) => o.stop === boarded);
      else {
        changes.unshift({ walk: via.walk, meters: via.meters });
        s = via.stop;
      }
    }
    const last = rides[rides.length - 1] as Ride;
    const arrive =
      last.dep + ((net.patterns[last.p] as NetPattern).off[last.j] as number) + out.minutes;
    const firstRide = rides[0] as Ride;
    const first = net.patterns[firstRide.p] as NetPattern;
    if (!inn || arrive > limit) continue;
    // Changing onto the same line again is not a transfer worth making.
    const ls = rides.map(
      (r) => `${(net.patterns[r.p] as NetPattern).src}${(net.patterns[r.p] as NetPattern).line}`,
    );
    if (ls.some((l, i) => i > 0 && l === ls[i - 1])) continue;
    if (arrive < earliest) earliest = arrive;
    const c: Candidate = {
      arrive,
      leave: firstRide.dep + (first.off[firstRide.i] as number) - inn.minutes,
      chain: ls.join(">"),
      inn,
      out,
      rides,
      changes,
    };
    const old = bestByChain.get(c.chain);
    if (!old || c.arrive < old.arrive || (c.arrive === old.arrive && c.leave > old.leave))
      bestByChain.set(c.chain, c);
  }
  const list = [...bestByChain.values()].sort((x, y) => score(x) - score(y) || y.leave - x.leave);
  return { best: list, earliest };
}

const score = (c: Candidate) => c.arrive + (c.rides.length - 1) * TRANSFER_PENALTY;

function stopOf(net: Network, i: number): BusStop {
  const s = net.stops[i] as NetStop;
  return { id: `${s.src}:${s.id}`, name: s.name, lat: s.lat, lon: s.lon };
}

/** A found journey as the legs the app shows. */
export function toOption(net: Network, c: Candidate): TransitOption {
  const legs: Leg[] = [];
  const ride = (r: Ride, wait: number): BusLeg => {
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
  let previous: BusLeg | undefined;
  c.rides.forEach((r, n) => {
    const change = c.changes[n - 1];
    const leg = ride(r, 0);
    if (previous && change) {
      // Waiting is what is left of the gap once the walk is taken out.
      leg.waitMinutes = leg.boardMin - previous.alightMin - change.walk;
      if (change.walk > 0)
        legs.push({
          kind: "walk",
          minutes: change.walk,
          meters: Math.round(change.meters),
          source: "estimate",
          from: previous.alight,
          to: leg.board,
        });
    } else {
      legs.push({
        kind: "walk",
        minutes: c.inn.minutes,
        meters: Math.round(c.inn.meters),
        source: c.inn.routed ? "route" : "estimate",
        to: leg.board,
      });
    }
    legs.push(leg);
    previous = leg;
  });
  legs.push({
    kind: "walk",
    minutes: c.out.minutes,
    meters: Math.round(c.out.meters),
    source: c.out.routed ? "route" : "estimate",
    from: previous?.alight,
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
  /** Most transfers (0–2). Default 1. */
  maxTransfers?: number;
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

/** The best options between two points allowing `maxTransfers` (default 1), or none. */
export function plan(
  net: Network,
  input: PlanInput,
  ends = endpoints(net, input.from, input.to),
): TransitOption[] {
  const origin = withRouted(ends.origin, input.routedIn);
  const dest = withRouted(ends.dest, input.routedOut);
  if (!origin.length || !dest.length) return [];
  const maxTransfers = Math.min(2, Math.max(0, input.maxTransfers ?? 1));
  const run = (ready: number, earliestOnly = false) =>
    search(net, { origin, dest, schedule: input.schedule, ready, earliestOnly, maxTransfers });
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

export interface AutoPlan {
  options: TransitOption[];
  /** Transfers the options were searched with. */
  maxTransfers: number;
  /** True when nothing was found with the one asked for and a second transfer was allowed. */
  raised: boolean;
}

/**
 * `plan`, raising the limit on its own: with `maxTransfers` omitted it starts at 1 and,
 * if no bus gets there, tries again with 2 (the far-off university). An explicit limit is
 * kept as asked.
 */
export function planAuto(
  net: Network,
  input: PlanInput,
  ends = endpoints(net, input.from, input.to),
): AutoPlan {
  const explicit = input.maxTransfers;
  const first = Math.min(2, Math.max(0, explicit ?? 1));
  const options = plan(net, { ...input, maxTransfers: first }, ends);
  if (options.length || explicit !== undefined || first >= 2)
    return { options, maxTransfers: first, raised: false };
  return { options: plan(net, { ...input, maxTransfers: 2 }, ends), maxTransfers: 2, raised: true };
}
