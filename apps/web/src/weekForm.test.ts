import { describe, expect, it } from "vitest";
import { type WeekFormValues, weekProblems } from "./weekForm.js";

const ok: WeekFormValues = {
  wake: "07:00",
  morning: "30",
  breakfast: "07:30",
  breakfastMin: "20",
  lunch: "13:00",
  lunchMin: "60",
  snack: "17:30",
  snackMin: "0",
  dinner: "21:00",
  dinnerMin: "30",
  freeFrom: "22:00",
  bed: "23:00",
};

describe("weekProblems", () => {
  it("is empty for a valid week", () => {
    expect(weekProblems(ok)).toEqual([]);
  });

  it("lists every invalid minutes field, each for its own field", () => {
    const found = weekProblems({ ...ok, morning: "-1", lunchMin: "1,5", dinnerMin: "999" });
    expect(found.map((p) => p.fields)).toEqual([
      ["Arreglarse, traslado (min)"],
      ["Dura (min), almuerzo"],
      ["Dura (min), cena"],
    ]);
    expect(found[1]?.message).toMatch(/solo números enteros/);
  });

  it("adds the hours and clashes next to the minutes", () => {
    const found = weekProblems({
      ...ok,
      morning: "x",
      breakfast: "23:30", // asleep
      freeFrom: "06:00", // before waking up
      lunch: "25:99", // not a time
      dinnerMin: "0",
    });
    expect(found.map((p) => p.fields[0]).sort()).toEqual([
      "Almuerzo",
      "Arreglarse, traslado (min)",
      "Desayuno",
      "Nada de estudio desde",
    ]);
  });

  it("marks both ends of a day that is too short", () => {
    const found = weekProblems({
      ...ok,
      wake: "08:00",
      bed: "10:00",
      freeFrom: "09:00",
      breakfast: "08:00",
      lunchMin: "0",
      dinnerMin: "0",
    });
    expect(found.map((p) => p.fields)).toEqual([["Me levanto", "Me acuesto"]]);
  });
});
