import { afterEach, describe, expect, it, vi } from "vitest";
import { capRootFontSize, MAX_ROOT_PX } from "./fontCap.js";
import { weekdayLong } from "./format.js";

const withSystemSize = (px: number) =>
  vi
    .spyOn(window, "getComputedStyle")
    .mockReturnValue({ fontSize: `${px}px` } as CSSStyleDeclaration);

describe("tope de la letra", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("font-size");
  });

  it("deja la letra normal como está", () => {
    withSystemSize(17);
    capRootFontSize();
    expect(document.documentElement.style.fontSize).toBe("");
  });

  it("deja pasar justo el tope", () => {
    withSystemSize(MAX_ROOT_PX);
    capRootFontSize();
    expect(document.documentElement.style.fontSize).toBe("");
  });

  it("corta lo que pide el sistema por encima del tope", () => {
    withSystemSize(32);
    capRootFontSize();
    expect(document.documentElement.style.fontSize).toBe(`${MAX_ROOT_PX}px`);
  });

  it("vuelve a leer: si el sistema baja la letra, el tope se levanta", () => {
    withSystemSize(32);
    capRootFontSize();
    vi.restoreAllMocks();
    withSystemSize(18);
    capRootFontSize();
    expect(document.documentElement.style.fontSize).toBe("");
  });
});

describe("weekdayLong", () => {
  it("da el día entero, en la zona de la app", () => {
    expect(weekdayLong("America/Montevideo", Date.UTC(2026, 10, 23, 15))).toBe("lunes");
  });
});
