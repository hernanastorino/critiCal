import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A fixed path inside the repo, not user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

// The rule that follows `marker`, up to its closing brace.
function rule(marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  return css.slice(start, css.indexOf("\n}", start));
}

// SPEC §14 «Transiciones con resorte»: one spring and two durations in `:root`, used by sheets,
// Bandeja cards, notices and block popovers; with «reducir movimiento», only a short fade.
describe("spring transitions", () => {
  it("defines the tokens in :root", () => {
    const root = rule(":root {");
    expect(root).toContain("--spring:");
    expect(root).toContain("--dur-spring:");
    expect(root).toContain("--dur-fade:");
  });

  it("uses them on sheets, cards, notices and popovers", () => {
    expect(rule(".card,\n.snack,\n.bubble-card {")).toContain("var(--dur-spring) var(--spring)");
    expect(rule(".sheet {")).toContain("var(--dur-spring) var(--spring)");
    expect(css).not.toMatch(/animation: up 0\.3s/);
  });

  it("only moves with transform and opacity", () => {
    const rise = rule("@keyframes rise");
    expect(rise).toContain("transform");
    expect(rise).toContain("opacity");
    expect(rise).not.toMatch(/\b(top|left|height|width|margin)\b/);
  });

  it("with reduced motion only fades, with no transform", () => {
    const start = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    const block = css.slice(start, css.indexOf("\n}\n", css.indexOf("\n}\n", start) + 1));
    for (const sel of [".sheet", ".action-sheet", ".card", ".snack", ".bubble-card"]) {
      expect(block).toContain(sel);
    }
    expect(block).toContain("fade-in var(--dur-fade)");
    expect(block).not.toContain("transform");
    expect(rule("@keyframes fade-in")).not.toContain("transform");
  });
});
