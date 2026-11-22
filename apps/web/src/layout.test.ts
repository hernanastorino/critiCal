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

  it("lets day names and hours grow with the text, up to 175 % (SPEC §18.12)", () => {
    expect(css.match(/\n\.day-head \{([^}]*)\}/)?.[1]).toContain(
      "font-size: min(0.6875rem, 19px);",
    );
    expect(css.match(/\n\.day-head b \{([^}]*)\}/)?.[1]).toContain(
      "font-size: min(0.9375rem, 26px);",
    );
    expect(css.match(/\n\.hours span \{([^}]*)\}/)?.[1]).toContain(
      "font-size: min(0.5625rem, 16px);",
    );
  });

  it("lets the days shrink so the last one never leaves the screen", () => {
    const week = css.match(/\n\.week \{([^}]*)\}/)?.[1] ?? "";
    expect(week).toContain("repeat(7, minmax(0, 1fr))");
    expect(week).toMatch(/grid-template-columns: min\(2rem, \d+vw\)/);
    expect(css.match(/\n\.day-head \{([^}]*)\}/)?.[1]).toContain("min-width: 0;");
  });
});

describe("touch targets (SPEC §14)", () => {
  it("the header's narrow icons grow their tappable area to 44 px", () => {
    const rule = css.match(/\n([^{}]*\.sheet-close::before) \{([^}]*)\}/);
    expect(rule?.[1]).toContain(".icon-btn::before");
    expect(rule?.[2]).toContain("width: max(100%, 44px);");
    expect(rule?.[2]).toContain("height: max(100%, 44px);");
  });
});

describe("buttons with large text", () => {
  it("keep their words whole and let a row of them wrap", () => {
    const btn = css.match(/\n\.btn \{([^}]*)\}/)?.[1] ?? "";
    expect(btn).toContain("overflow-wrap: break-word;");
    expect(css).toContain(
      ".sheet .row:not(.fields),\n.card .row:not(.fields) {\n  flex-wrap: wrap;",
    );
  });
});

describe("sheets come in (SPEC §14)", () => {
  it("with a spring, and only fade with «reduce motion»", () => {
    expect(css).toContain("--spring: cubic-bezier(");
    expect(css.match(/\n\.sheet \{([^}]*)\}/)?.[1]).toContain("animation: up 0.3s var(--spring);");
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".action-sheet {\n    animation: fade-in");
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

describe("design scale (SPEC §14)", () => {
  const root = css.match(/^:root \{([^}]*)\}/)?.[1] ?? "";

  it("defines the spacing, radius and text tokens in :root", () => {
    for (const name of [
      "--space-0",
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--space-5",
      "--space-6",
      "--space-7",
      "--radius-xs",
      "--radius-s",
      "--radius-m",
      "--radius-l",
      "--radius-xl",
      "--radius-xxl",
      "--radius-pill",
      "--text-2xs",
      "--text-xs",
      "--text-s",
      "--text-m",
      "--text-l",
      "--text-xl",
      "--text-2xl",
      "--text-3xl",
    ]) {
      expect(root, name).toContain(`${name}:`);
    }
  });

  it("has no loose px border-radius outside :root", () => {
    const rest = css.replace(/^:root \{[^}]*\}/, "");
    const loose = rest.match(/border-radius:[^;]*\d+px[^;]*;/g) ?? [];
    expect(loose).toEqual([]);
  });
});

describe("no zoom on the phone", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "index.html"), "utf8");
  const main = readFileSync(join(import.meta.dirname, "main.tsx"), "utf8");

  it("the viewport forbids scaling", () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? "";
    for (const part of [
      "width=device-width",
      "initial-scale=1",
      "maximum-scale=1",
      "user-scalable=no",
      "viewport-fit=cover",
    ]) {
      expect(viewport).toContain(part);
    }
  });

  it("blocks the pinch gestures of Safari and the pinch of touch-action", () => {
    expect(main).toMatch(/gesturestart/);
    expect(main).toMatch(/gesturechange/);
    expect(main).toMatch(/preventDefault/);
    expect(css).toMatch(/html,\s*body \{[^}]*touch-action: pan-y;/);
  });

  it("every rule that sets the font size of a field keeps it at 16px or more", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const sizes = rules
      .filter(([, sel]) => /(^|[\s,>])(input|select|textarea)\b/.test(sel ?? ""))
      .map(([, sel, body]) => ({
        sel: (sel ?? "").trim(),
        size: body?.match(/font-size:\s*([^;]+);/)?.[1],
      }))
      .filter((r) => r.size);
    expect(sizes.length).toBeGreaterThan(0);
    for (const { sel, size } of sizes) {
      expect(size, sel).toMatch(/^max\(16px, /);
    }
  });
});

describe("forms: alignment and air", () => {
  it("the fields of Materias and Rutinas start on one line, the help hangs below", () => {
    expect(css).toMatch(/\.row\.fields\.top \{[^}]*align-items: flex-start;/);
  });

  it("the settings search has one focus ring, not two", () => {
    expect(css).toMatch(
      /\.settings-search input:focus-visible \{[^}]*outline: none;[^}]*box-shadow: none;/,
    );
  });

  it("the way-to-get-there block of a place has air from the scale of tokens", () => {
    expect(css).toMatch(/\.mode-set \{[^}]*margin-bottom: var\(--space-4\);/);
    expect(css).toMatch(/\.unsaved-note \{[^}]*margin: var\(--space-3\) 0;/);
  });
});
