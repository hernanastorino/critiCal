import { describe, expect, it } from "vitest";
import { at } from "./testing.js";
import { type TravelOptions, travelBuffers } from "./travel.js";
import { type CalendarEvent, MINUTE } from "./types.js";

const ev = (id: string, start: string, end: string, location: string): CalendarEvent => ({
  id,
  title: id,
  start: at("2026-11-02", start),
  end: at("2026-11-02", end),
  busy: true,
  allDay: false,
  location,
});

const options = (extra: Partial<TravelOptions> = {}): TravelOptions => ({
  home: "home",
  resolvePlace: (l) => (l === "Facultad" ? "facu" : l === "Gym" ? "gym" : undefined),
  travelMinutes: () => 20,
  marginMinutes: 10,
  returnHomeAfterMinutes: 120,
  ...extra,
});

describe("travelBuffers by bus", () => {
  const clase = ev("clase", "10:00", "12:00", "Facultad");

  it("blocks the driving minutes when no other figure is given", () => {
    const { busy } = travelBuffers([clase], options());
    expect(busy).toEqual([
      { start: clase.start - 30 * MINUTE, end: clase.start },
      { start: clase.end, end: clase.end + 20 * MINUTE },
    ]);
  });

  it("blocks the door-to-door minutes of the bus, there and back", () => {
    const { busy } = travelBuffers([clase], options({ tripMinutes: () => 55 }));
    expect(busy).toEqual([
      { start: clase.start - 65 * MINUTE, end: clase.start },
      { start: clase.end, end: clase.end + 55 * MINUTE },
    ]);
  });

  it("blocks the way back with its own bus figure when there is one", () => {
    const { busy } = travelBuffers(
      [clase],
      options({ tripMinutes: (_e, leg) => (leg === "there" ? 55 : 80) }),
    );
    expect(busy).toEqual([
      { start: clase.start - 65 * MINUTE, end: clase.start },
      { start: clase.end, end: clase.end + 80 * MINUTE },
    ]);
  });

  it("falls back to driving for an event with no bus figure", () => {
    const other = ev("gym", "15:00", "16:00", "Gym");
    const { busy } = travelBuffers(
      [clase, other],
      options({ tripMinutes: (e) => (e.id === "clase" ? 55 : undefined) }),
    );
    expect(busy).toContainEqual({ start: other.start - 30 * MINUTE, end: other.start });
    expect(busy).toContainEqual({ start: other.end, end: other.end + 20 * MINUTE });
  });

  it("keeps the driving minutes between two events in a row", () => {
    const gym = ev("gym", "12:30", "13:30", "Gym");
    const { busy } = travelBuffers([clase, gym], options({ tripMinutes: () => 55 }));
    // Facultad → Gym is not a trip from home: the bus figure does not apply to it.
    expect(busy).toContainEqual({ start: gym.start - 30 * MINUTE, end: gym.start });
  });
});
