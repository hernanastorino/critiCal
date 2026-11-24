import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");
const rule = (selector: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .find((b) => b.split("{")[0]?.trim() === selector)
    ?.split("{")[1] ?? "";

describe("bajas de la 32.ª vuelta (estilos)", () => {
  it("una parte hecha se ve como «hecho», no como el botón primario", () => {
    const hecha = rule('.check.part input[type="checkbox"]:checked');
    expect(hecha).toMatch(/var\(--ok-ink\)/);
    expect(hecha).not.toMatch(/background-color:\s*var\(--ink\)/);
  });

  it("los siete días caben en la fila: ninguno se empuja afuera", () => {
    expect(rule(".chip")).toMatch(/min-width:\s*0/);
  });

  it("el aviso no tiene lugar propio arriba (no tapa cabeceras ni títulos)", () => {
    expect(rule(".toasts")).not.toMatch(/position:\s*fixed/);
  });
});
