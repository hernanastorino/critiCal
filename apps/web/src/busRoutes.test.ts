// @vitest-environment node
// SPEC §15: regular bus routes — which saved route a trip uses, and when it stops holding.
import { describe, expect, it } from "vitest";
import { findRoute, planOf, type RouteRow, savedPlanOf, weekdayLabel } from "./busRoutes.js";
import { ATTRIBUTION, type PlanOk, staleReason, type TransitOption } from "./transit.js";

const option: TransitOption = {
  leaveMin: 490,
  arriveMin: 532,
  totalMinutes: 42,
  walkMinutes: 8,
  waitMinutes: 0,
  rideMinutes: 32,
  transfers: 0,
  theoretical: true,
  legs: [],
};
const feed = { version: "v1", builtAt: "2026-11-20", validTo: "2026-12-31", sources: [] };
const answer: PlanOk = {
  ok: true,
  options: [option],
  walkOnly: null,
  dayType: 1,
  maxTransfers: 1,
  raised: false,
  feed,
  attribution: ATTRIBUTION,
};

const route = (extra: Partial<RouteRow> = {}): RouteRow => ({
  id: "r1",
  from_place: "casa",
  to_place: "facu",
  weekday: 2,
  time_minutes: 540,
  mode: "arrive",
  feed_version: "v1",
  plan: savedPlanOf(option, answer),
  computed_at: "2026-11-21T10:00:00Z",
  theoretical: true,
  ...extra,
});

// 2026-11-24 es martes.
const slot = {
  from: "casa",
  to: "facu",
  mode: "arrive" as const,
  date: "2026-11-24",
  timeMinutes: 540,
};

describe("la ruta habitual de un traslado", () => {
  it("coincide por lugares, modo, hora y día de la semana", () => {
    const r = route();
    expect(findRoute([r], slot)).toBe(r);
    expect(findRoute([r], { ...slot, date: "2026-11-25" })).toBeUndefined();
    expect(findRoute([r], { ...slot, timeMinutes: 541 })).toBeUndefined();
    expect(findRoute([r], { ...slot, mode: "depart" })).toBeUndefined();
    expect(findRoute([r], { ...slot, from: "facu", to: "casa" })).toBeUndefined();
  });

  it("una de todos los días sirve cualquier día, y la del día gana", () => {
    const todos = route({ id: "r2", weekday: null });
    expect(findRoute([todos], { ...slot, date: "2026-11-28" })).toBe(todos);
    const martes = route();
    expect(findRoute([todos, martes], slot)).toBe(martes);
    expect(findRoute([martes, todos], slot)).toBe(martes);
  });

  it("guarda la opción elegida con el día y el fin de los horarios", () => {
    expect(savedPlanOf(option, answer)).toEqual({ option, dayType: 1, validTo: "2026-12-31" });
  });

  it("se muestra como una respuesta del servidor", () => {
    const shown = planOf(route(), ATTRIBUTION, feed);
    expect(shown.options).toEqual([option]);
    expect(shown.attribution).toBe(ATTRIBUTION);
  });

  it("deja de valer si cambian los horarios, el día o terminan", () => {
    const at = { date: "2026-11-24", timeMinutes: 540 };
    expect(staleReason(route(), at, "v1")).toBeNull();
    expect(staleReason(route(), at, "v2")).toBe("feed");
    expect(staleReason(route(), { ...at, dayType: 3 }, "v1")).toBe("day");
    expect(staleReason(route(), { ...at, date: "2026-12-02" }, "v1")).toBe("day");
    expect(staleReason(route({ weekday: null }), { ...at, date: "2027-01-06" }, "v1")).toBe(
      "expired",
    );
  });

  it("nombra el día", () => {
    expect(weekdayLabel(2)).toBe("los martes");
    expect(weekdayLabel(7)).toBe("los domingos");
    expect(weekdayLabel(null)).toBe("todos los días");
  });
});
