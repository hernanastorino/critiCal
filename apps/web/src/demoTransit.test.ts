// @vitest-environment node
import { describe, expect, it } from "vitest";
import { wayMinutes } from "./busTrip.js";
import { DEMO_MINUTES, demoPlan } from "./demoTransit.js";
import type { PlanRequest } from "./transit.js";

const req = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  action: "plan",
  from: { lat: -34.9055, lon: -56.1905 },
  to: { lat: -34.918, lon: -56.166 },
  date: "2026-11-24",
  time: "14:00",
  mode: "arrive",
  ...over,
});

describe("los ómnibus inventados de la demo", () => {
  it("de ida llega a la hora del evento, con un transbordo y los minutos de la demo", () => {
    const r = demoPlan(req());
    if (!r.ok) throw new Error("debía haber plan");
    const best = r.options[0];
    expect(best?.arriveMin).toBe(14 * 60);
    expect(best?.transfers).toBe(1);
    expect(best && wayMinutes(best, "there", req())).toBe(DEMO_MINUTES.there);
  });

  it("de vuelta cuenta la espera desde que termina el evento", () => {
    const back = req({ mode: "depart", time: "16:00" });
    const r = demoPlan(back);
    if (!r.ok) throw new Error("debía haber plan");
    expect(r.options[0] && wayMinutes(r.options[0], "back", back)).toBe(DEMO_MINUTES.back);
  });

  it("no hay datos en el Cerro", () => {
    expect(demoPlan(req({ to: { lat: -34.89, lon: -56.26 } }))).toEqual({
      ok: false,
      error: "no_stops_near",
    });
  });
});
