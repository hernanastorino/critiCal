import { describe, expect, it } from "vitest";

// SPEC §14 «Formularios y botones»: a button says what it does («Guardar hora»), never a bare
// «OK», «Listo» or «Aceptar».
const sources = Object.entries(
  import.meta.glob<string>("./components/*.tsx", { query: "?raw", import: "default", eager: true }),
);

describe("button labels", () => {
  it("are never a bare OK, Listo or Aceptar", () => {
    const bare = />\s*(OK|Ok|Listo|Aceptar)\s*</;
    expect(sources.filter(([, s]) => bare.test(s)).map(([f]) => f)).toEqual([]);
  });
});
