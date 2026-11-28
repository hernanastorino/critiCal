import { describe, expect, it } from "vitest";
import { parseHoursText } from "./format.js";
import { estimateProblem, hoursProblem, parseUnit, typedHours } from "./taskForm.js";

// 47.ª vuelta, puntos 2 y 3: un solo lector de horas y el de partes.
describe("2. todos los campos de horas aceptan las formas que la app muestra", () => {
  it.each([
    ["3", 3],
    ["3,5", 3.5],
    ["3.5", 3.5],
    ["3h", 3],
    ["3h15", 3.25],
    ["3h 15", 3.25],
    ["3:15", 3.25],
    ["3h15m", 3.25],
    ["3 h 15 min", 3.25],
    ["３ｈ１５", 3.25],
    ["0h30", 0.5],
  ])("«%s» son %d h", (text, h) => {
    expect(parseHoursText(text)).toBeCloseTo(h, 6);
    expect(typedHours(text)).toBeCloseTo(h, 6);
    expect(hoursProblem(text)).toBeNull();
    expect(estimateProblem(text, 0)).toBeNull();
  });

  it.each(["", "h", "3h75", "3:60", "3:", "-3h", "1e2", "0x10", "3hh", "3h15x", "abc"])(
    "«%s» no son horas",
    (text) => {
      expect(parseHoursText(text)).toBeNaN();
      expect(hoursProblem(text)).not.toBeNull();
    },
  );
});

describe("3. el tiempo de una parte", () => {
  it.each([
    ["Práctico (1:30)", 90],
    ["Práctico (90')", 90],
    ["Práctico (２h)", 120],
    ["Práctico (１h３０)", 90],
    ["Práctico (1h59)", 119],
  ])("«%s» son %i min", (text, minutes) => {
    expect(parseUnit(text)).toEqual({ title: "Práctico", minutes });
  });

  it.each(["Práctico (1h75)", "Práctico (2h 99)", "Práctico (1:75)", "Práctico (1:)"])(
    "«%s» avisa en el campo",
    (text) => {
      expect(parseUnit(text)).toHaveProperty("error");
    },
  );
});
