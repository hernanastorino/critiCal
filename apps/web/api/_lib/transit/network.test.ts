import { describe, expect, it } from "vitest";
import { type BusLeg, hhmm } from "../../../src/transit.js";
import { fakeGtfs } from "../fake-providers.js";
import { FeedBuilder } from "./feed.js";
import { parseGtfs } from "./gtfs.js";
import { buildNetwork, endpoints, plan, scheduleFor, stopsNear } from "./network.js";
import { unzip } from "./zip.js";

/** The invented dev feed: L1 east-west along lat −34.85, L2 north-south along lon −56.11. */
function devNetwork() {
  const zip = unzip(fakeGtfs());
  const t = (n: string) => zip.get(n)?.toString("utf8") ?? "";
  const { feed } = parseGtfs({
    agency: t("agency.txt"),
    routes: t("routes.txt"),
    calendar: t("calendar.txt"),
    trips: t("trips.txt"),
    stops: t("stops.txt"),
    stopTimes: t("stop_times.txt"),
  });
  return buildNetwork([feed]);
}

const net = devNetwork();
const weekday = scheduleFor(net, "2026-11-10", 1, 1, "2026-11-09");
const at = (h: number, m = 0) => h * 60 + m;
// Points a little off the line (≈110 m north of it).
const onL1 = (i: number) => ({ lat: -34.849, lon: -56.17 + i * 0.004 });
const onL2 = (i: number) => ({ lat: -34.91 + i * 0.004, lon: -56.109 });
const buses = (o: { legs: unknown[] }) =>
  o.legs.filter((l) => (l as BusLeg).kind === "bus") as BusLeg[];

describe("finding stops", () => {
  it("lists the nearest stops within walking range, nearest first", () => {
    const near = stopsNear(net, onL1(10));
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(14);
    expect(near.map((n) => n.meters)).toEqual([...near.map((n) => n.meters)].sort((a, b) => a - b));
    expect(near[0]?.meters).toBeLessThan(200);
    expect(stopsNear(net, { lat: -33, lon: -55 })).toEqual([]);
  });
});

describe("a direct bus", () => {
  it("leaves as late as it can and arrives by the deadline", () => {
    const [best] = plan(net, {
      from: onL1(2),
      to: onL1(22),
      mode: "arrive",
      at: at(9),
      schedule: weekday,
    });
    expect(best).toBeDefined();
    if (!best) return;
    expect(best.arriveMin).toBeLessThanOrEqual(at(9));
    expect(at(9) - best.arriveMin).toBeLessThanOrEqual(15 + 5);
    expect(best.transfers).toBe(0);
    const [bus] = buses(best);
    expect(bus?.line).toBe("L1");
    expect(bus?.headsign).toBe("ESTE");
    expect(bus?.stops).toBeGreaterThanOrEqual(19);
    expect(bus?.theoretical).toBe(true);
    // Walk in, ride, walk out; leaving is boarding minus the walk, arrival is alighting plus it.
    const [first, , last] = best.legs;
    expect(first?.kind).toBe("walk");
    expect(last?.kind).toBe("walk");
    expect(best.leaveMin).toBe((bus?.boardMin ?? 0) - (first?.kind === "walk" ? first.minutes : 0));
    expect(best.totalMinutes).toBe(best.arriveMin - best.leaveMin);
    expect(best.walkMinutes + best.rideMinutes + best.waitMinutes).toBe(best.totalMinutes);
    expect(hhmm(best.leaveMin)).toMatch(/^08:/);
  });

  it("takes the first bus that can be caught when leaving at a time", () => {
    const options = plan(net, {
      from: onL1(2),
      to: onL1(22),
      mode: "depart",
      at: at(8, 1),
      schedule: weekday,
    });
    const best = options[0];
    expect(best?.leaveMin).toBeGreaterThanOrEqual(at(8, 1));
    expect(best?.leaveMin).toBeLessThan(at(8, 1) + 20);
    expect(best?.waitMinutes).toBe(0);
  });

  it("uses the on-foot times the routing service gave instead of the estimate", () => {
    const ends = endpoints(net, onL1(2), onL1(22));
    const routedIn = new Map(ends.origin.map((e) => [e.stop, 20]));
    const [best] = plan(
      net,
      { from: onL1(2), to: onL1(22), mode: "depart", at: at(8), schedule: weekday, routedIn },
      ends,
    );
    const first = best?.legs[0];
    expect(first?.kind === "walk" && first.minutes).toBe(20);
    expect(first?.kind === "walk" && first.source).toBe("route");
    const last = best?.legs[best.legs.length - 1];
    expect(last?.kind === "walk" && last.source).toBe("estimate");
  });

  it("runs on the weekend's sparser schedule", () => {
    const sunday = scheduleFor(net, "2026-11-08", 3, 2, "2026-11-07");
    const [best] = plan(net, {
      from: onL1(2),
      to: onL1(22),
      mode: "arrive",
      at: at(9),
      schedule: sunday,
    });
    expect(at(9) - (best?.arriveMin ?? 0)).toBeGreaterThan(-1);
    expect(best?.legs.filter((l) => l.kind === "bus")).toHaveLength(1);
  });
});

describe("a transfer", () => {
  it("changes at the crossing, with the margin and the second bus's wait", () => {
    // L1 west part to the north end of L2.
    const options = plan(net, {
      from: onL1(2),
      to: onL2(28),
      mode: "depart",
      at: at(8),
      schedule: weekday,
    });
    const best = options[0];
    expect(best?.transfers).toBe(1);
    const [a, b] = buses(best as never);
    expect(a?.line).toBe("L1");
    expect(b?.line).toBe("L2");
    expect(b?.waitMinutes).toBeGreaterThanOrEqual(5);
    expect(b ? b.boardMin - (a?.alightMin ?? 0) : 0).toBeGreaterThanOrEqual(5);
    // Every minute is counted once: the walk between stops is not also waiting.
    expect((best?.walkMinutes ?? 0) + (best?.waitMinutes ?? 0) + (best?.rideMinutes ?? 0)).toBe(
      best?.totalMinutes,
    );
    expect(best?.legs.map((l) => l.kind)).toContain("bus");
    expect(best?.theoretical).toBe(true);
  });

  it("is never offered when the same line would do", () => {
    const options = plan(net, {
      from: onL1(2),
      to: onL1(22),
      mode: "depart",
      at: at(8),
      schedule: weekday,
    });
    expect(options.every((o) => o.transfers === 0)).toBe(true);
  });

  it("lists at most three options, one per line combination", () => {
    const options = plan(net, {
      from: onL1(14),
      to: onL2(28),
      mode: "depart",
      at: at(8),
      schedule: weekday,
    });
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(3);
  });
});

describe("no bus", () => {
  it("is empty when nothing runs at that hour or arrives in time", () => {
    expect(
      plan(net, { from: onL1(2), to: onL1(22), mode: "depart", at: at(23, 50), schedule: weekday }),
    ).toEqual([]);
    expect(
      plan(net, { from: onL1(2), to: onL1(22), mode: "arrive", at: at(6, 10), schedule: weekday }),
    ).toEqual([]);
  });

  it("is empty with no stops near an end", () => {
    expect(
      plan(net, {
        from: { lat: -33, lon: -55 },
        to: onL1(22),
        mode: "depart",
        at: at(8),
        schedule: weekday,
      }),
    ).toEqual([]);
  });
});

describe("schedules by date", () => {
  const b = new FeedBuilder();
  const s0 = b.stop({ id: "a", name: "A", lat: -34.9, lon: -56.1 });
  const s1 = b.stop({ id: "b", name: "B", lat: -34.9, lon: -56.09 });
  const r = b.route({ line: "N", head: "B", company: null });
  b.trip(r, [s0, s1], [0, 5], 1, 1500); // weekday service, 01:00 the next morning
  b.trip(r, [s0, s1], [0, 5], 1, 600, { from: 20261201, to: 20261231 });
  b.trip(r, [s0, s1], [0, 5], 1, 700);
  b.trip(r, [s0, s1], [0, 5], 1, 1438); // leaves 23:58, passes the second stop at 00:03
  const small = buildNetwork([b.build("dnt", null)]);
  const deps = (s: ReturnType<typeof scheduleFor>) => [...(s.deps[0] ?? [])];

  it("adds yesterday's trips that run past midnight, 1440 earlier, to today's own", () => {
    expect(deps(scheduleFor(small, "2026-11-10", 1, 1, "2026-11-09"))).toEqual([
      -2, 60, 700, 1438, 1500,
    ]);
  });

  it("leaves out yesterday's when it was another day type, and out-of-range services", () => {
    expect(deps(scheduleFor(small, "2026-11-10", 1, 3, "2026-11-09"))).toEqual([700, 1438, 1500]);
    expect(deps(scheduleFor(small, "2026-12-10", 1, 1, "2026-12-09"))).toEqual([
      -2, 60, 600, 700, 1438, 1500,
    ]);
    expect(deps(scheduleFor(small, "2026-11-10", 2, 2, "2026-11-09"))).toEqual([]);
  });

  it("finds the early-morning bus for a night trip", () => {
    const sched = scheduleFor(small, "2026-11-10", 1, 1, "2026-11-09");
    const from = { lat: -34.9, lon: -56.1 };
    const to = { lat: -34.9, lon: -56.09 };
    const [best] = plan(small, { from, to, mode: "depart", at: 30, schedule: sched });
    expect(best && hhmm(best.arriveMin)).toMatch(/^01:0/);
  });
});
