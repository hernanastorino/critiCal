// @vitest-environment node
// The bus minutes the plan reserves (SPEC §15): saved per event, handed to the engine.
import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { diffData } from "./data.js";
import { emptyData } from "./demo.js";
import { travelBuffers, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { busMinutes, busWithoutMinutes, travelOptions } from "./places.js";
import { reducer } from "./store.js";

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-23", 8 * 60);
const MIN = 60_000;

const casa: Place = { id: "casa", name: "Casa", aliases: [], isHome: true };
const facu: Place = { id: "facu", name: "Facultad", aliases: ["FING"], travelMode: "bus" };
const gym: Place = { id: "gym", name: "Gym", aliases: [] };

const clase: AppEvent = {
  id: "e1",
  title: "Cálculo",
  start: zonedInstant(tz, "2026-11-24", 9 * 60),
  end: zonedInstant(tz, "2026-11-24", 10 * 60),
  busy: true,
  location: "FING",
  source: "google",
};
const pesas: AppEvent = { ...clase, id: "e2", title: "Pesas", location: "Gym" };

const base = (extra: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  places: [casa, facu, gym],
  events: [clase, pesas],
  travelTimes: [
    { from: "casa", to: "facu", minutes: 15, manual: true },
    { from: "facu", to: "casa", minutes: 15, manual: true },
    { from: "casa", to: "gym", minutes: 15, manual: true },
    { from: "gym", to: "casa", minutes: 15, manual: true },
  ],
  ...extra,
});

const withMinutes = (d: AppData, eventId: string, minutes: number) =>
  reducer(d, { type: "tripMinutes", eventId, minutes, now: NOW });

describe("los minutos del ómnibus que reserva el plan", () => {
  it("sin dato, el plan sigue con los minutos en auto", () => {
    const d = base();
    expect(busMinutes(d, clase)).toBeUndefined();
    expect(busWithoutMinutes(d, d.events, NOW).map((e) => e.id)).toEqual(["e1"]);
    const trips = travelBuffers([clase], must(travelOptions(d))).busy;
    expect(trips[0]?.end).toBe(clase.start);
    expect(clase.start - must(trips[0]).start).toBe((15 + d.settings.travelMarginMinutes) * MIN);
  });

  it("con el dato, reserva lo que dura el ómnibus de ida y de vuelta", () => {
    const d = withMinutes(base(), "e1", 50);
    expect(busMinutes(d, clase)).toBe(50);
    expect(busWithoutMinutes(d, d.events, NOW)).toEqual([]);
    const [there, back] = travelBuffers([clase], must(travelOptions(d))).busy;
    expect(clase.start - must(there).start).toBe((50 + d.settings.travelMarginMinutes) * MIN);
    expect(must(back).end - clase.end).toBe(50 * MIN);
  });

  it("un evento en auto no usa el dato, ni se avisa por él", () => {
    const d = withMinutes(base(), "e2", 50);
    expect(busMinutes(d, pesas)).toBeUndefined();
    const chosen = reducer(d, { type: "tripMode", eventId: "e1", mode: "car", now: NOW });
    expect(busMinutes(withMinutes(chosen, "e1", 50), clase)).toBeUndefined();
    expect(busWithoutMinutes(chosen, chosen.events, NOW)).toEqual([]);
  });

  it("si el evento se mueve, el dato deja de valer", () => {
    const d = withMinutes(base(), "e1", 50);
    const moved = { ...d, events: [{ ...clase, start: clase.start + 3600_000 }, pesas] };
    expect(busMinutes(moved, must(moved.events[0]))).toBeUndefined();
  });

  it("el modo del evento manda sobre el del lugar", () => {
    const d = reducer(withMinutes(base(), "e2", 40), {
      type: "tripMode",
      eventId: "e2",
      mode: "bus",
      now: NOW,
    });
    expect(busMinutes(d, pesas)).toBe(40);
  });

  it("se guarda en los ajustes, se redondea y se puede soltar", () => {
    const a = base();
    const b = withMinutes(a, "e1", 49.6);
    const row = diffData(a, b).upserts.find((u) => u.table === "settings")?.rows[0] as {
      state: { tripMinutes: unknown };
    };
    expect(row.state.tripMinutes).toEqual({ e1: { minutes: 50, start: clase.start } });
    expect(withMinutes(b, "e1", 50)).toBe(b);
    expect(withMinutes(b, "nadie", 50)).toBe(b);
    const gone = reducer(b, { type: "tripMinutes", eventId: "e1", minutes: null, now: NOW });
    expect(gone.tripMinutes).toBeUndefined();
  });

  it("el respaldo lo conserva", () => {
    const d = withMinutes(base(), "e1", 50);
    const ok = parseBackup(exportJson(d, NOW));
    expect("data" in ok && ok.data.tripMinutes).toEqual({
      e1: { minutes: 50, start: clase.start },
    });
  });
});

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a value");
  return v;
}
