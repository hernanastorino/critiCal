import { describe, expect, it } from "vitest";
import { lanes } from "./lanes.js";

describe("lanes", () => {
  it("keeps the full width when nothing overlaps", () => {
    const l = lanes([
      { key: "a", start: 0, end: 10 },
      { key: "b", start: 10, end: 20 },
    ]);
    expect(l.get("a")).toEqual({ col: 0, cols: 1 });
    expect(l.get("b")).toEqual({ col: 0, cols: 1 });
  });

  it("puts overlapping blocks side by side and reuses a freed column", () => {
    const l = lanes([
      { key: "long", start: 0, end: 60 },
      { key: "first", start: 0, end: 20 },
      { key: "after", start: 30, end: 50 },
      { key: "alone", start: 70, end: 80 },
    ]);
    expect(l.get("long")).toEqual({ col: 0, cols: 2 });
    expect(l.get("first")).toEqual({ col: 1, cols: 2 });
    expect(l.get("after")).toEqual({ col: 1, cols: 2 });
    expect(l.get("alone")).toEqual({ col: 0, cols: 1 });
  });

  it("uses as many columns as blocks overlap at once", () => {
    const l = lanes([
      { key: "a", start: 0, end: 30 },
      { key: "b", start: 10, end: 40 },
      { key: "c", start: 20, end: 50 },
    ]);
    expect([...l.values()].map((v) => v.cols)).toEqual([3, 3, 3]);
    expect(l.get("c")?.col).toBe(2);
  });

  it("ignores empty spans", () => {
    expect(lanes([{ key: "x", start: 5, end: 5 }]).size).toBe(0);
  });
});
