// Fake bus plans for the «Demo de pruebas»: the card of an event by bus can be tried with
// no account and no network (SPEC §15). The answer has the shape of `/api/transit` and is
// made from the request alone, so it is the same every time.
import {
  ATTRIBUTION,
  type BusStop,
  type PlanRequest,
  type PlanResponse,
  parseHhmm,
} from "./transit.js";

/** West of this longitude there is no service in the demo: «Club del Cerro» has no data. */
export const DEMO_NO_SERVICE_WEST = -56.24;

const stop = (id: string, name: string, lat: number, lon: number): BusStop => ({
  id,
  name,
  lat,
  lon,
});

const RIVERA = stop("d1", "Rivera y Ellauri", -34.9, -56.15);
const TRES_CRUCES = stop("d2", "Tres Cruces", -34.894, -56.166);
const FING = stop("d3", "Herrera y Reissig", -34.918, -56.166);

/** Minutes a way takes in the demo, door to door. */
export const DEMO_MINUTES = { there: 42, back: 48 } as const;

/**
 * Two buses with one transfer: 128 to Tres Cruces and 710 from there. «Arrive» ends at
 * the time asked; «depart» leaves five minutes after it (the wait for the bus).
 */
export function demoPlan(request: PlanRequest): PlanResponse {
  if (request.from.lon < DEMO_NO_SERVICE_WEST || request.to.lon < DEMO_NO_SERVICE_WEST) {
    return { ok: false, error: "no_stops_near" };
  }
  const asked = parseHhmm(request.time) ?? 0;
  const arrives = request.mode === "arrive";
  const total = arrives ? DEMO_MINUTES.there : DEMO_MINUTES.back - 5;
  const leaveMin = arrives ? asked - total : asked + 5;
  const arriveMin = leaveMin + total;
  const board1 = leaveMin + 5;
  const alight1 = board1 + 14;
  const board2 = alight1 + 4;
  const alight2 = board2 + 12;
  return {
    ok: true,
    walkOnly: null,
    dayType: request.dayType ?? 1,
    maxTransfers: 1,
    raised: false,
    attribution: ATTRIBUTION,
    feed: { version: "demo", builtAt: "2026-11-01", validTo: null, sources: [] },
    options: [
      {
        leaveMin,
        arriveMin,
        totalMinutes: total,
        walkMinutes: 5 + (arriveMin - alight2),
        waitMinutes: 4,
        rideMinutes: 26,
        transfers: 1,
        theoretical: true,
        legs: [
          { kind: "walk", minutes: 5, meters: 380, source: "estimate", to: RIVERA },
          {
            kind: "bus",
            line: "128",
            headsign: "Tres Cruces",
            company: null,
            source: "stm",
            board: RIVERA,
            alight: TRES_CRUCES,
            boardMin: board1,
            alightMin: alight1,
            stops: 9,
            waitMinutes: 0,
            theoretical: true,
          },
          {
            kind: "bus",
            line: "710",
            headsign: "Facultad",
            company: null,
            source: "stm",
            board: TRES_CRUCES,
            alight: FING,
            boardMin: board2,
            alightMin: alight2,
            stops: 7,
            waitMinutes: 4,
            theoretical: true,
          },
          {
            kind: "walk",
            minutes: arriveMin - alight2,
            meters: 300,
            source: "estimate",
            from: FING,
          },
        ],
      },
    ],
  };
}
