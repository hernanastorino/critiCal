/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom has no layout, so this guards the CSS that keeps the installed app's tab bar
// flush with the bottom of the phone screen.
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

describe("tab bar", () => {
  it("is fixed to the bottom edge and pads for the home indicator", () => {
    const tabs = css.match(/\n\.tabs \{([^}]*)\}/)?.[1] ?? "";
    expect(tabs).toContain("position: fixed;");
    expect(tabs).toContain("bottom: 0;");
    expect(tabs).toContain("padding-bottom: var(--safe-b);");
  });

  it("gets the full screen when installed on iOS 26", () => {
    expect(css).toMatch(
      /@media \(display-mode: standalone\) \{\s*html \{\s*min-height: min\(100lvh, calc\(100% \+ env\(safe-area-inset-top, 0px\)\)\);/,
    );
  });
});
