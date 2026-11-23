import { describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { weekTypeCounts, weekTypeLine } from "./weekType.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);
const empty = (): AppData => ({ ...demoData(NOW), activities: [], places: [] });
const act = (id: string, kind?: "materia" | "rutina") =>
  ({ ...demoData(NOW).activities[0], id, kind }) as AppData["activities"][number];
const place = (id: string) =>
  ({ id, name: id }) as unknown as NonNullable<AppData["places"]>[number];

describe("«Tu semana tipo» (SPEC §18.1)", () => {
  it("sin nada armado no dice nada", () => {
    expect(weekTypeLine(empty())).toBeNull();
  });

  it("cuenta lo real: materias, rutinas y lugares", () => {
    const d = {
      ...empty(),
      activities: [act("a", "materia"), act("b"), act("c", "rutina")],
      places: [place("p"), place("q")],
    };
    expect(weekTypeCounts(d)).toEqual({ materias: 2, rutinas: 1, lugares: 2 });
    expect(weekTypeLine(d)).toBe("Tu semana tipo: 2 materias, 1 rutina, 2 lugares");
  });

  it("deja afuera lo que está en cero y crece con el uso", () => {
    const one = { ...empty(), activities: [act("a", "materia")] };
    expect(weekTypeLine(one)).toBe("Tu semana tipo: 1 materia");
    const more = { ...one, places: [place("p")] };
    expect(weekTypeLine(more)).toBe("Tu semana tipo: 1 materia, 1 lugar");
  });
});
