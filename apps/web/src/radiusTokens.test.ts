import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

// SPEC §14 «Consistencia visual»: every corner radius comes from a token of `:root`
// (`--radius-*`); a literal like `8px` or `50%` would drift from the rest. `0` is no radius.
describe("border radii", () => {
  it("only use the tokens of styles.css", () => {
    const values = css
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("border-") && line.includes("radius:"))
      .map((line) => line.slice(line.indexOf(":") + 1).replace(";", ""));
    const literal = values.filter((v) =>
      v
        .split(" ")
        .filter(Boolean)
        .some((p) => p !== "0" && !p.startsWith("var(--radius-")),
    );
    expect(literal).toEqual([]);
    expect(values.length).toBeGreaterThan(20);
  });
});
