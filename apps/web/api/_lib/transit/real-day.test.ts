// The real schedules of Tuesday 10 November 2026 (Montevideo's STM and the metropolitan
// lines), frozen as the immutable base for routing tests: a weekday, so the most lines and
// times. The files in __fixtures__ never change (they are the feeds `importSource` builds
// from the Intendencia's and the MTOP's downloads of that day, compacted); the tests pin
// what the search must say. A new snapshot goes in new files, never over these.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type BusLeg, hhmm, type TransitOption } from "../../../src/transit.js";
import { decodeFeed } from "./feed.js";
import { buildNetwork, plan, planAuto, scheduleFor } from "./network.js";

const load = (name: string) =>
  decodeFeed(readFileSync(new URL(`./__fixtures__/${name}.b64`, import.meta.url), "utf8"));

const net = buildNetwork([load("stm-2026-11-10"), load("dnt-2026-11-10")]);
const tuesday = scheduleFor(net, "2026-11-10", 1, 1, "2026-11-09");
const at = (h: number, m = 0) => h * 60 + m;

const PLACES = {
  plazaIndependencia: { lat: -34.9065, lon: -56.2013 },
  malvin: { lat: -34.8886, lon: -56.1004 },
  pocitos: { lat: -34.9135, lon: -56.151 },
  cerro: { lat: -34.883, lon: -56.257 },
  tresCruces: { lat: -34.894, lon: -56.167 },
  ciudadDeLaCosta: { lat: -34.813, lon: -55.953 },
  lasPiedras: { lat: -34.73, lon: -56.22 },
};

const lines = (o: TransitOption) =>
  o.legs.filter((l): l is BusLeg => l.kind === "bus").map((l) => l.line);
const summary = (o: TransitOption | undefined) =>
  o &&
  `${hhmm(o.leaveMin)}→${hhmm(o.arriveMin)} ${o.totalMinutes}min x${o.transfers} ${lines(o).join("+")}`;

const summaries = (
  from: keyof typeof PLACES | { lat: number; lon: number },
  to: keyof typeof PLACES | { lat: number; lon: number },
  mode: "arrive" | "depart",
  extra = {},
) => {
  const point = (p: typeof from) => (typeof p === "string" ? PLACES[p] : p);
  return plan(net, {
    from: point(from),
    to: point(to),
    mode,
    at: at(9),
    schedule: tuesday,
    ...extra,
  }).map(summary);
};

describe("the frozen day", () => {
  it("has both sources", () => {
    expect(net.versions).toEqual({ stm: "538d5b21efc2", dnt: "d1c4f8f4a16a" });
    expect(net.stops.length).toBe(10426);
    expect(net.patterns.length).toBe(12905);
  });

  it("gets to Malvín from Plaza Independencia by 09:00", () => {
    expect(summaries("plazaIndependencia", "malvin", "arrive")).toEqual([
      "08:18→09:00 42min x0 142",
      "08:19→09:00 41min x1 21+724",
    ]);
    expect(summaries("plazaIndependencia", "malvin", "depart")).toEqual([
      "09:04→09:43 39min x0 D10",
      "09:02→09:45 43min x1 6R6+701",
      "09:09→09:53 44min x0 142",
    ]);
  });

  it("gets to the Cerro from Pocitos, always by changing", () => {
    expect(summaries("pocitos", "cerro", "arrive")).toEqual([
      "07:45→08:57 72min x1 128+370",
      "07:45→08:58 73min x1 128+306",
    ]);
    expect(summaries("pocitos", "cerro", "depart")).toEqual([
      "09:00→10:11 71min x1 128+76",
      "09:00→10:15 75min x1 128+306",
      "09:17→10:32 75min x0 76",
    ]);
  });

  it("gets to Ciudad de la Costa from Tres Cruces on the metropolitan lines", () => {
    expect(summaries("tresCruces", "ciudadDeLaCosta", "arrive")).toEqual([
      "07:58→08:57 59min x0 710",
    ]);
    expect(summaries("tresCruces", "ciudadDeLaCosta", "depart")).toEqual([
      "09:02→10:03 61min x0 221",
      "09:03→10:06 63min x0 7E8R",
      "09:07→10:12 65min x0 214",
    ]);
  });

  it("gets to Las Piedras from Plaza Independencia", () => {
    expect(summaries("plazaIndependencia", "lasPiedras", "arrive")).toEqual([
      "07:54→08:55 61min x1 752+4AD",
    ]);
    expect(summaries("plazaIndependencia", "lasPiedras", "depart")).toEqual([
      "09:01→10:14 73min x1 125+809",
      "09:01→10:45 104min x1 125+175",
    ]);
  });

  it("is deterministic: asking twice says the same", () => {
    const again = () => summaries("pocitos", "cerro", "arrive");
    expect(again()).toEqual(again());
  });
});

describe("two transfers (the far-off university)", () => {
  // Pairs that no bus joins with one change on this day (nor directly).
  const far = [
    [
      { lat: -34.82306, lon: -56.31538 },
      { lat: -34.76636, lon: -56.22107 },
      "06:49→08:21 92min x2 494+468+276",
    ],
    [
      { lat: -34.8387, lon: -56.29922 },
      { lat: -34.87538, lon: -56.11708 },
      "07:27→08:56 89min x2 L1+1M11+370",
    ],
    [
      { lat: -34.90694, lon: -56.17876 },
      { lat: -34.81625, lon: -55.96213 },
      "07:28→08:46 78min x2 137+707+8E8R",
    ],
  ] as const;

  it.each(far)(
    "is not reachable with one change, and is with two (%j → %j)",
    (from, to, expected) => {
      expect(summaries(from, to, "arrive", { maxTransfers: 1 })).toEqual([]);
      expect(summaries(from, to, "arrive", { maxTransfers: 2 })[0]).toBe(expected);
    },
  );

  it("raises the limit by itself when nothing else gets there, and says so", () => {
    const [from, to, expected] = far[0];
    const input = { from, to, mode: "arrive" as const, at: at(9), schedule: tuesday };
    const auto = planAuto(net, input);
    expect(auto).toMatchObject({ maxTransfers: 2, raised: true });
    expect(summary(auto.options[0])).toBe(expected);
    // Nothing even with two: not marked as raised.
    const none = planAuto(net, {
      ...input,
      from: { lat: -35.15, lon: -56.9 },
      to: { lat: -35.15, lon: -56.88 },
    });
    expect(none).toMatchObject({ options: [], maxTransfers: 2, raised: false });
    // Asked for one on purpose: kept, nothing raised.
    expect(planAuto(net, { ...input, maxTransfers: 1 })).toMatchObject({
      options: [],
      maxTransfers: 1,
      raised: false,
    });
    // A trip that has options with one change is not raised.
    const near = planAuto(net, { ...input, from: PLACES.pocitos, to: PLACES.cerro });
    expect(near).toMatchObject({ maxTransfers: 1, raised: false });
  });

  it("counts every minute once on a three-bus trip", () => {
    const [from, to] = far[2];
    const [best] = plan(net, {
      from,
      to,
      mode: "depart",
      at: at(6),
      schedule: tuesday,
      maxTransfers: 2,
    });
    expect(best?.legs.filter((l) => l.kind === "bus")).toHaveLength(3);
    expect((best?.walkMinutes ?? 0) + (best?.waitMinutes ?? 0) + (best?.rideMinutes ?? 0)).toBe(
      best?.totalMinutes,
    );
    const buses = (best?.legs ?? []).filter((l): l is BusLeg => l.kind === "bus");
    for (let i = 1; i < buses.length; i++)
      expect(
        (buses[i] as BusLeg).boardMin - (buses[i - 1] as BusLeg).alightMin,
      ).toBeGreaterThanOrEqual(5);
  });

  it("finds trips with two changes in a reasonable time", () => {
    const [from, to] = far[1];
    const started = Date.now();
    plan(net, { from, to, mode: "arrive", at: at(9), schedule: tuesday, maxTransfers: 2 });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
