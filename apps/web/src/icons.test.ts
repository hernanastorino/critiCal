import { describe, expect, it } from "vitest";

// SPEC §14 «Consistencia visual»: interface icons are 2px line SVGs from icons.tsx, never
// emoji or ✓ ✗ ✕ ◐ glyphs. Emoji stay in the data («📚 Plan», `📝`) and inside sentences.
const sources = Object.entries(
  import.meta.glob<string>("./components/*.tsx", { query: "?raw", import: "default", eager: true }),
);

describe("interface icons", () => {
  it("no button or marker is drawn with a glyph", () => {
    // A glyph alone as a JSX child, or leading a button's label («✓ Hecho»).
    const glyph = />\s*[✓✗✕◐][\s\p{L}]*</u;
    expect(sources.filter(([, s]) => glyph.test(s)).map(([f]) => f)).toEqual([]);
  });

  it("pinned blocks and the home place are marked with icons, not emoji", () => {
    expect(sources.filter(([, s]) => /📌|🏠/u.test(s)).map(([f]) => f)).toEqual([]);
  });
});
