import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

// SPEC §14 «Consistencia visual»: every corner radius comes from a token of `:root`
// (`--radius-*`); a literal like `8px` or `50%` would drift from the rest. `0` is no radius.
describe("border radii", () => {
  it("only use the tokens of styles.css", () => {
    const values = [...css.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g)].map(
      (m) => m[1] ?? "",
    );
    const literal = values.filter((v) =>
      v.split(/\s+/).some((p) => !(p === "0" || p.startsWith("var(--radius-"))),
    );
    expect(literal).toEqual([]);
    expect(values.length).toBeGreaterThan(20);
  });
});
