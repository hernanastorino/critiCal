/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom has no layout, so this guards the CSS that keeps the installed app's tab bar
// flush with the bottom of the phone screen.
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

describe("week bar with large text (200 %)", () => {
  it("lets the range title break in two lines instead of running over the arrows", () => {
    const h1 = css.match(/\n\.week-nav h1\.range \{([^}]*)\}/)?.[1] ?? "";
    expect(h1).toContain("white-space: normal;");
    expect(h1).toContain("overflow-wrap: anywhere;");
  });

  it("lets the days shrink so the last one never leaves the screen", () => {
    const week = css.match(/\n\.week \{([^}]*)\}/)?.[1] ?? "";
    expect(week).toContain("repeat(7, minmax(0, 1fr))");
    expect(week).toMatch(/grid-template-columns: min\(2rem, \d+vw\)/);
    expect(css.match(/\n\.day-head \{([^}]*)\}/)?.[1]).toContain("min-width: 0;");
  });
});

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

describe("blocks of the week", () => {
  it("have a tappable area of at least 44 px, without resizing what is drawn", () => {
    const hit = css.match(/\n\.pill::before \{([^}]*)\}/)?.[1] ?? "";
    expect(hit).toContain('content: "";');
    expect(hit).toContain("height: max(calc(100% + 6px), 44px);");
    // Centred on the block, so a 15 px meal grows up and down alike.
    expect(hit).toContain("top: 50%;");
    expect(hit).toContain("translateY(-50%)");
    // The drawing itself (and its minimum) stays as it was.
    expect(css.match(/\n\.pill \{([^}]*)\}/)?.[1]).toContain("min-height: 6px;");
  });
});
